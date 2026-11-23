package com.prowosma.backend.uma.core;

import com.prowosma.backend.integration.GoogleApiException;
import com.prowosma.backend.integration.GoogleMeetApi;
import com.prowosma.backend.meetingassistant.ConferenceSelector;
import com.prowosma.backend.model.MeetingUserConnection;
import com.prowosma.backend.service.GoogleOAuthService;
import com.prowosma.backend.service.MeetingAssistantException;
import com.prowosma.backend.uma.model.UmaMeeting;
import com.prowosma.backend.uma.model.UmaSegment;
import com.prowosma.backend.uma.model.UmaStatus;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Google Meet for the AI Meeting Assistant: after a Meet meeting, read Google's own transcript (Meet REST API) through the Google account the
 * person connected. Reuses the existing sign-in service, Meet API client and conference selector unchanged. Google only has a transcript when
 * someone turned on transcription in the meeting (Workspace editions that include it).
 */
@Component
public class UmaGoogleMeet {
    private static final Pattern CODE = Pattern.compile("meet\\.google\\.com/([a-z]{3}-[a-z]{4}-[a-z]{3})(?:[/?#]|$)");
    static final Duration ENDED_PATIENCE = Duration.ofMinutes(10);
    static final Duration NO_TRANSCRIPT_GRACE = Duration.ofHours(2);
    /** A call Google still lists as open this long after it began is treated as over (someone's device never left, or the attendee list is empty). */
    static final Duration STUCK_OPEN_LIMIT = Duration.ofHours(8);
    /** After the last person leaves, wait this long before calling the meeting over, in case they rejoin (a dropped connection). */
    static final Duration REJOIN_GRACE = Duration.ofMinutes(2);
    /** Notetaker bots: they keep Google's call open but are not people, so they never keep a meeting "in progress". */
    static final Pattern NOTETAKER = Pattern.compile("(?i)(fireflies|notetaker|note[- ]?taker|otter\\.?ai|\\botter\\b|read\\.ai|fathom|tl;?dv|meetgeek|avoma|"
            + "fellow\\.app|grain|krisp|circleback|bluedot|jamie|tactiq|recorder|\\bbot\\b)");

    /** A notetaker bot's name ("Fireflies.ai Notetaker", "Read.ai", ...). */
    public static boolean isNotetakerName(String name) { return name != null && NOTETAKER.matcher(name).find(); }

    static boolean isNotetaker(GoogleMeetApi.Attendee a) { return a.displayName() != null && NOTETAKER.matcher(a.displayName()).find(); }

    private final GoogleOAuthService oauth;          // the existing assistant's sign-in: used only as a fallback for reading transcripts
    private final UmaGoogleAuth auth;                // this module's own sign-in (Meet + Calendar)
    private final GoogleMeetApi api;
    private final MongoTemplate mongo;
    private final UmaStore store;

    public UmaGoogleMeet(GoogleOAuthService oauth, UmaGoogleAuth auth, GoogleMeetApi api, MongoTemplate mongo, UmaStore store) {
        this.oauth = oauth; this.auth = auth; this.api = api; this.mongo = mongo; this.store = store;
    }

    public static String meetingCode(String url) {
        if (url == null) return null;
        Matcher m = CODE.matcher(url.toLowerCase(Locale.ROOT));
        return m.find() ? m.group(1) : null;
    }

    public Map<String, Object> status(String org, String email) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("configured", auth.configured());
        r.put("canStoreTokens", auth.canStoreTokens());
        r.put("redirectUri", auth.redirectUri());
        Optional<com.prowosma.backend.uma.model.UmaGoogleConnection> c = auth.connection(org, email);
        boolean legacy = c.isEmpty() && oauth.hasActiveConnection(org, email);
        r.put("connected", c.filter(x -> "ACTIVE".equals(x.getStatus())).isPresent() || legacy);
        r.put("status", c.map(com.prowosma.backend.uma.model.UmaGoogleConnection::getStatus).orElse(legacy ? "ACTIVE" : "NOT_CONNECTED"));
        r.put("account", c.map(com.prowosma.backend.uma.model.UmaGoogleConnection::getAccount)
                .orElse(legacy ? oauth.connection(org, email).map(MeetingUserConnection::getAccount).orElse(null) : null));
        r.put("calendar", c.map(x -> x.getScopes().contains(UmaGoogleAuth.CALENDAR_SCOPE)).orElse(false));
        r.put("legacyConnection", legacy);                    // connected only through the existing assistant: transcripts yes, scheduling no
        r.put("autoImportCalendar", c.map(com.prowosma.backend.uma.model.UmaGoogleConnection::isAutoImportCalendar).orElse(false));
        r.put("autoFireflies", c.map(com.prowosma.backend.uma.model.UmaGoogleConnection::isAutoFireflies).orElse(false));
        r.put("lastCalendarSyncAt", c.map(com.prowosma.backend.uma.model.UmaGoogleConnection::getLastCalendarSyncAt).orElse(null));
        r.put("lastCalendarSyncNote", c.map(com.prowosma.backend.uma.model.UmaGoogleConnection::getLastCalendarSyncNote).orElse(null));
        return r;
    }

    public boolean connected(String org, String email) { return auth.active(org, email) || oauth.hasActiveConnection(org, email); }

    public String authorizeUrl(String org, String email) { return auth.authorizeUrl(org, email); }

    public void complete(String org, String email, String code, String state) { auth.complete(org, email, code, state); }

    public void disconnect(String org, String email) { auth.disconnect(org, email); }

    /** This module's connection first; the existing assistant's connection (Meet read access only) as a fallback. */
    private String token(String org, String who) {
        if (auth.connection(org, who).isPresent()) return auth.accessToken(org, who);
        try { return oauth.accessToken(org, who); } catch (MeetingAssistantException e) { throw toUma(e); }
    }

    /** What one look at Google found. WAIT = look again later; DONE = transcript stored; FAIL = give up with a reason. */
    /** live = what Google says about the call itself: NOT_STARTED | IN_PROGRESS | ENDED (null when unknown). */
    public record Check(String outcome, String note, Duration again, String code, String recovery, String live, Instant startedAt, Instant endedAt) {
        static Check waitFor(String note, Duration again) { return new Check("WAIT", note, again, null, null, null, null, null); }
        static Check waitLive(String note, Duration again, String live, Instant started, Instant ended) {
            return new Check("WAIT", note, again, null, null, live, started, ended);
        }
        static Check done(String note) { return new Check("DONE", note, null, null, null, "ENDED", null, null); }
        static Check fail(String code, String note, String recovery) { return new Check("FAIL", note, null, code, recovery, null, null, null); }
    }

    /**
     * Is anyone in this Meet call right now? Empty when it can't be told (not connected, Google unreachable) - then callers don't wait on it.
     * Used to send the notetaker the moment the first person joins, so it never waits in an empty call and nobody waits for it.
     */
    public Optional<Boolean> someoneInTheCall(UmaMeeting m) {
        String code = meetingCode(m.getMeetingUrl());
        if (code == null) return Optional.empty();
        String who = m.getGoogle() != null && m.getGoogle().getRequestedBy() != null ? m.getGoogle().getRequestedBy() : m.getCreatedBy();
        if (!connected(m.getOrganizationId(), who)) return Optional.empty();
        try {
            String token = token(m.getOrganizationId(), who);
            Instant anchor = m.getMeetingAt() == null ? m.getCreatedAt() : m.getMeetingAt();
            Optional<ConferenceSelector.Conference> pick = ConferenceSelector.select(api.listConferenceRecords(token, code), anchor, false,
                    name -> claimed(m.getOrganizationId(), m.getId(), name));
            return Optional.of(pick.isPresent() && pick.get().end() == null);
        } catch (RuntimeException e) {
            return Optional.empty();
        }
    }

    public Check fetch(UmaMeeting m) {
        String org = m.getOrganizationId();
        String code = meetingCode(m.getMeetingUrl());
        if (code == null) return Check.fail("NOT_A_MEET_LINK", "This isn't a Google Meet link with a meeting code (like abc-defg-hij).",
                "Use the meeting's meet.google.com link, or upload the recording.");
        String who = m.getGoogle() != null && m.getGoogle().getRequestedBy() != null ? m.getGoogle().getRequestedBy() : m.getCreatedBy();
        String token = token(org, who);
        Instant now = Instant.now();
        Instant anchor = m.getMeetingAt() == null ? m.getCreatedAt() : m.getMeetingAt();
        try {
            List<ConferenceSelector.Conference> records = api.listConferenceRecords(token, code);
            Optional<ConferenceSelector.Conference> pick = ConferenceSelector.select(records, anchor, false, name -> claimed(org, m.getId(), name));
            if (pick.isEmpty()) {
                if (now.isAfter(anchor.plus(Duration.ofHours(24))))
                    return Check.fail("NO_MEET_SESSION", "Google has no record of this meeting taking place around its time.",
                            "Check the meeting time and link, or upload the recording.");
                // Not started yet: look every minute around the planned time, less often later.
                boolean nearStart = now.isBefore(anchor.plus(Duration.ofHours(2)));
                return Check.waitLive("Nobody has joined the meeting yet.", Duration.ofMinutes(nearStart ? 1 : 10), "NOT_STARTED", null, null);
            }
            ConferenceSelector.Conference conf = pick.get();
            // Google keeps the call "in progress" until everyone leaves or the host ends it for everyone - and a notetaker bot counts as someone.
            // So look at the people: when every real person has left, the meeting is over even if a notetaker is still connected.
            boolean stuckOpen = conf.end() == null && conf.start() != null && now.isAfter(conf.start().plus(STUCK_OPEN_LIMIT));
            Instant endRef = conf.end() != null ? conf.end() : stuckOpen ? conf.start().plus(STUCK_OPEN_LIMIT) : now;
            if (conf.end() == null && !stuckOpen) {
                List<GoogleMeetApi.Attendee> everyone = api.listAttendance(token, conf.name());
                List<GoogleMeetApi.Attendee> people = everyone.stream().filter(a -> !isNotetaker(a)).toList();
                boolean allLeft = !people.isEmpty() && people.stream().allMatch(a -> a.lastLeft() != null);
                if (!allLeft) return Check.waitLive("The meeting is in progress.", Duration.ofMinutes(1), "IN_PROGRESS", conf.start(), null);
                Instant lastLeft = people.stream().map(GoogleMeetApi.Attendee::lastLeft).max(Instant::compareTo).orElse(now);
                if (now.isBefore(lastLeft.plus(REJOIN_GRACE)))
                    return Check.waitLive("Everyone has left - checking for a minute in case someone rejoins.", Duration.ofMinutes(1), "IN_PROGRESS", conf.start(), null);
                List<String> bots = everyone.stream().filter(a -> isNotetaker(a) && a.lastLeft() == null).map(GoogleMeetApi.Attendee::displayName).toList();
                String note = bots.isEmpty() ? "Everyone has left the meeting. Waiting for the transcript."
                        : "Everyone has left the meeting (only " + String.join(", ", bots) + " is still connected). Its transcript arrives once it leaves - "
                          + "notetakers normally leave by themselves a few minutes after everyone else.";
                return Check.waitLive(note, Duration.ofMinutes(2), "ENDED", conf.start(), lastLeft);
            }
            List<GoogleMeetApi.TranscriptInfo> all = api.listTranscripts(token, conf.name());
            List<GoogleMeetApi.TranscriptInfo> ready = all.stream()
                    .filter(t -> "FILE_GENERATED".equals(t.state()) || ("ENDED".equals(t.state()) && t.end() != null && t.end().isBefore(now.minus(ENDED_PATIENCE))))
                    .sorted(Comparator.comparing(t -> t.start() == null ? Instant.MAX : t.start())).toList();
            if (ready.size() < all.size()) return Check.waitLive("The meeting ended. Google is preparing its transcript.", Duration.ofMinutes(1), "ENDED", conf.start(), endRef);
            if (ready.isEmpty()) {
                if (now.isAfter(endRef.plus(NO_TRANSCRIPT_GRACE)))
                    return Check.fail("NO_TRANSCRIPT", "Google Meet has no transcript for this meeting. Transcription has to be turned on during the meeting.",
                            "Upload the recording, or send the Fireflies notetaker next time.");
                return Check.waitLive("The meeting ended; waiting for a transcript.", Duration.ofMinutes(2), "ENDED", conf.start(), endRef);
            }
            Map<String, String> names = api.listParticipants(token, conf.name());
            List<UmaSegment> segs = new ArrayList<>();
            int seq = 0;
            for (GoogleMeetApi.TranscriptInfo t : ready) {
                for (GoogleMeetApi.Entry e : api.listEntries(token, t.name())) {
                    String text = e.text() == null ? "" : e.text().replaceAll("\\s+", " ").strip();
                    if (text.isEmpty()) continue;
                    UmaSegment u = new UmaSegment();
                    u.setOrganizationId(org); u.setMeetingId(m.getId()); u.setSeq(++seq);
                    u.setSpeaker(e.participant() == null ? null : names.get(e.participant()));     // unknown stays unknown
                    u.setStartMs(e.start() == null || conf.start() == null ? null : Math.max(0, Duration.between(conf.start(), e.start()).toMillis()));
                    u.setEndMs(e.end() == null || conf.start() == null ? null : Math.max(0, Duration.between(conf.start(), e.end()).toMillis()));
                    u.setText(text.length() > 4000 ? text.substring(0, 4000) : text);
                    segs.add(u);
                    if (segs.size() > 20000) return Check.fail("TRANSCRIPT_TOO_LONG", "This transcript is too long to import.", "Upload it in parts.");
                }
            }
            if (segs.isEmpty()) return Check.fail("NO_TRANSCRIPT", "Google's transcript for this meeting has no spoken text.", "Upload the recording instead.");
            store.replaceSegments(org, m.getId(), segs);
            UmaMeeting.GoogleLink g = m.getGoogle() == null ? new UmaMeeting.GoogleLink() : m.getGoogle();
            g.setConferenceRecord(conf.name());
            m.setGoogle(g);
            m.setLiveState("ENDED"); m.setLiveSource("Google Meet");
            if (m.getStartedAt() == null) m.setStartedAt(conf.start());
            if (m.getEndedAt() == null) m.setEndedAt(endRef);
            UmaMeeting.TranscriptInfo info = new UmaMeeting.TranscriptInfo();
            info.setOrigin("GOOGLE_MEET"); info.setEngine("Google Meet"); info.setSegmentCount(segs.size());
            info.setSpeakersKnown(segs.stream().anyMatch(x -> x.getSpeaker() != null)); info.setUpdatedAt(Instant.now());
            m.setTranscript(info);
            m.setProgressPercent(80);
            store.save(m);
            store.transition(org, m.getId(), UmaStatus.ANALYZING, "system", "Writing the summary and finding decisions and actions…", "Google Meet transcript");
            store.audit(org, m.getId(), "system", "GOOGLE_TRANSCRIPT_IMPORTED", segs.size() + " lines");
            return Check.done(segs.size() + " lines from Google Meet.");
        } catch (GoogleApiException e) {
            throw toUma(e);
        }
    }

    private boolean claimed(String org, String meetingId, String conferenceRecord) {
        return mongo.exists(new Query(Criteria.where("organizationId").is(org).and("google.conferenceRecord").is(conferenceRecord)
                .and("_id").ne(meetingId)), UmaMeeting.class);
    }

    static UmaException toUma(MeetingAssistantException e) {
        String hint = switch (e.getCode()) {
            case "GOOGLE_NOT_CONFIGURED" -> "An admin needs to add the Google OAuth client to the server (see the setup guide).";
            case "ENCRYPTION_NOT_CONFIGURED" -> "An admin needs to set ENCRYPTION_KEY on the server.";
            default -> "Connect your Google account again from Connections, then press Retry.";
        };
        return new UmaException(e.getStatus(), e.getCode(), e.getMessage(), hint);
    }

    static UmaException toUma(GoogleApiException e) {
        return switch (e.getKind()) {
            case UNAUTHORIZED -> new UmaException(HttpStatus.BAD_REQUEST, "GOOGLE_REAUTH_REQUIRED", "Google no longer accepts the saved sign-in.",
                    "Connect your Google account again from Connections, then press Retry.");
            case FORBIDDEN -> new UmaException(HttpStatus.FORBIDDEN, "GOOGLE_FORBIDDEN", "Google didn't allow reading this meeting.",
                    "The connected account must have been in the meeting (or own it), and the Workspace must allow Meet transcripts.");
            case NOT_FOUND -> new UmaException(HttpStatus.NOT_FOUND, "GOOGLE_NOT_FOUND", "Google couldn't find this meeting.", "Check the link.");
            case RATE_LIMITED, SERVER, NETWORK -> new UmaException(HttpStatus.SERVICE_UNAVAILABLE, "GOOGLE_UNAVAILABLE", "Google didn't answer right now.", "It will be tried again.");
            default -> new UmaException(HttpStatus.BAD_GATEWAY, "GOOGLE_BAD_RESPONSE", "Google's reply couldn't be read.", "Press Retry.");
        };
    }
}

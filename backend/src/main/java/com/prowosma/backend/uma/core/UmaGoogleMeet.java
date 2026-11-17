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

    private final GoogleOAuthService oauth;
    private final GoogleMeetApi api;
    private final MongoTemplate mongo;
    private final UmaStore store;

    public UmaGoogleMeet(GoogleOAuthService oauth, GoogleMeetApi api, MongoTemplate mongo, UmaStore store) {
        this.oauth = oauth; this.api = api; this.mongo = mongo; this.store = store;
    }

    public static String meetingCode(String url) {
        if (url == null) return null;
        Matcher m = CODE.matcher(url.toLowerCase(Locale.ROOT));
        return m.find() ? m.group(1) : null;
    }

    public Map<String, Object> status(String org, String email) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("configured", oauth.isConfigured());
        r.put("canStoreTokens", oauth.canStoreTokens());
        Optional<MeetingUserConnection> c = oauth.connection(org, email);
        r.put("connected", c.filter(x -> "ACTIVE".equals(x.getStatus())).isPresent());
        r.put("status", c.map(MeetingUserConnection::getStatus).orElse("NOT_CONNECTED"));
        r.put("account", c.map(MeetingUserConnection::getAccount).orElse(null));
        return r;
    }

    public boolean connected(String org, String email) { return oauth.hasActiveConnection(org, email); }

    public String authorizeUrl(String org, String email) {
        try { return oauth.authorizeUrl(org, email); } catch (MeetingAssistantException e) { throw toUma(e); }
    }

    public void disconnect(String org, String email) { oauth.disconnect(org, email); }

    /** What one look at Google found. WAIT = look again later; DONE = transcript stored; FAIL = give up with a reason. */
    public record Check(String outcome, String note, Duration again, String code, String recovery) {
        static Check waitFor(String note, Duration again) { return new Check("WAIT", note, again, null, null); }
        static Check done(String note) { return new Check("DONE", note, null, null, null); }
        static Check fail(String code, String note, String recovery) { return new Check("FAIL", note, null, code, recovery); }
    }

    public Check fetch(UmaMeeting m) {
        String org = m.getOrganizationId();
        String code = meetingCode(m.getMeetingUrl());
        if (code == null) return Check.fail("NOT_A_MEET_LINK", "This isn't a Google Meet link with a meeting code (like abc-defg-hij).",
                "Use the meeting's meet.google.com link, or upload the recording.");
        String who = m.getGoogle() != null && m.getGoogle().getRequestedBy() != null ? m.getGoogle().getRequestedBy() : m.getCreatedBy();
        String token;
        try { token = oauth.accessToken(org, who); } catch (MeetingAssistantException e) { throw toUma(e); }
        Instant now = Instant.now();
        Instant anchor = m.getMeetingAt() == null ? m.getCreatedAt() : m.getMeetingAt();
        try {
            List<ConferenceSelector.Conference> records = api.listConferenceRecords(token, code);
            Optional<ConferenceSelector.Conference> pick = ConferenceSelector.select(records, anchor, false, name -> claimed(org, m.getId(), name));
            if (pick.isEmpty()) {
                if (now.isAfter(anchor.plus(Duration.ofHours(24))))
                    return Check.fail("NO_MEET_SESSION", "Google has no record of this meeting taking place around its time.",
                            "Check the meeting time and link, or upload the recording.");
                return Check.waitFor("Waiting for the meeting to happen.", Duration.ofMinutes(10));
            }
            ConferenceSelector.Conference conf = pick.get();
            if (conf.end() == null) return Check.waitFor("The meeting is in progress. Google's transcript is read after it ends.", Duration.ofMinutes(3));
            List<GoogleMeetApi.TranscriptInfo> all = api.listTranscripts(token, conf.name());
            List<GoogleMeetApi.TranscriptInfo> ready = all.stream()
                    .filter(t -> "FILE_GENERATED".equals(t.state()) || ("ENDED".equals(t.state()) && t.end() != null && t.end().isBefore(now.minus(ENDED_PATIENCE))))
                    .sorted(Comparator.comparing(t -> t.start() == null ? Instant.MAX : t.start())).toList();
            if (ready.size() < all.size()) return Check.waitFor("Google is still preparing the transcript.", Duration.ofMinutes(2));
            if (ready.isEmpty()) {
                if (now.isAfter(conf.end().plus(NO_TRANSCRIPT_GRACE)))
                    return Check.fail("NO_TRANSCRIPT", "Google Meet has no transcript for this meeting. Transcription has to be turned on during the meeting.",
                            "Upload the recording, or send the Fireflies notetaker next time.");
                return Check.waitFor("The meeting ended; waiting for Google's transcript.", Duration.ofMinutes(5));
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

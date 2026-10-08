package com.prowosma.backend.service;

import com.prowosma.backend.integration.GoogleApiException;
import com.prowosma.backend.integration.GoogleMeetApi;
import com.prowosma.backend.integration.GoogleMeetApi.Entry;
import com.prowosma.backend.integration.GoogleMeetApi.TranscriptInfo;
import com.prowosma.backend.meetingassistant.ConferenceSelector;
import com.prowosma.backend.meetingassistant.GoogleCheckReport;
import com.prowosma.backend.meetingassistant.ConferenceSelector.Conference;
import com.prowosma.backend.meetingassistant.ConferenceSelector.Coverage;
import com.prowosma.backend.meetingassistant.ConferenceSelector.Span;
import com.prowosma.backend.meetingassistant.SessionStatus;
import com.prowosma.backend.meetingassistant.TranscriptParser;
import com.prowosma.backend.model.MeetingJob;
import com.prowosma.backend.model.MeetingSession;
import com.prowosma.backend.model.MeetingUserConnection;
import com.prowosma.backend.model.TranscriptSegment;
import lombok.RequiredArgsConstructor;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.*;

/**
 * Imports the transcript of a finished Google Meet conference using the requesting person's own Google access.
 * Polls (without counting as errors) until the meeting has ended and Google has finalized the transcript;
 * never truncates a long transcript silently; labels partial coverage; leaves speakers as Google names them.
 */
@Component
@RequiredArgsConstructor
public class GoogleTranscriptFetchHandler implements MeetingJobHandler {

    public static final String TYPE = "FETCH_GOOGLE_TRANSCRIPT";
    static final Duration TRANSCRIPT_GRACE = Duration.ofMinutes(30);
    /** Google's state ENDED means "the session ended but the transcript FILE hasn't been generated yet". We wait for FILE_GENERATED; if a file never appears we try anyway after this long. */
    static final Duration ENDED_PATIENCE = Duration.ofMinutes(10);

    private final MeetingSessionStore store;
    private final GoogleOAuthService oauth;
    private final GoogleMeetApi api;
    private final MeetingTranscriptService transcripts;
    private final MeetingOutputService outputs;
    private final MongoTemplate mongo;

    @Override
    public String type() { return TYPE; }

    @Override
    public JobOutcome handle(MeetingJob job) {
        final String org = job.getOrganizationId();
        MeetingSession s = store.find(org, job.getSessionId()).orElse(null);
        if (s == null) return JobOutcome.done();
        SessionStatus st = SessionStatus.valueOf(s.getStatus());
        // Cancelled, failed, or a transcript already arrived (e.g. uploaded by hand): nothing left to do.
        if (st != SessionStatus.SCHEDULED && st != SessionStatus.AWAITING_TRANSCRIPT) return JobOutcome.done();
        if (!GoogleOAuthService.PROVIDER.equals(s.getProvider())) return JobOutcome.done();

        String code = s.getMeetingKey();
        if (code == null || code.startsWith("lookup:")) {
            return JobOutcome.fail("UNSUPPORTED_LINK",
                    "This kind of Meet link can't be matched to a meeting record automatically.",
                    "Upload or paste the transcript instead.");
        }

        final String account = oauth.connection(org, job.getRequestedBy()).map(MeetingUserConnection::getAccount).orElse(null);
        try {
            return check(job, s, code, account);
        } catch (GoogleApiException e) {
            store.recordCheck(org, s.getId(), GoogleCheckReport.googleProblem(e.getKind().name(), account));
            throw e;
        } catch (MeetingAssistantException e) {
            store.recordCheck(org, s.getId(), "GOOGLE_REAUTH_REQUIRED".equals(e.getCode()) ? GoogleCheckReport.googleProblem("UNAUTHORIZED", account) : GoogleCheckReport.notConnected(account));
            throw e;
        }
    }

    /** One look at Google. Every outcome — including "nothing yet" — is written down so the page can tell the person what Google said. */
    private JobOutcome check(MeetingJob job, MeetingSession s, String code, String account) {
        final String org = job.getOrganizationId();
        String token = oauth.accessToken(org, job.getRequestedBy());   // throws a user-facing error if not connected / expired
        Instant now = Instant.now();
        boolean registeredAfterStart = s.getScheduledFor() == null;
        Instant anchor = registeredAfterStart ? s.getCreatedAt() : s.getScheduledFor();

        List<Conference> records = api.listConferenceRecords(token, code);
        Optional<Conference> pick = ConferenceSelector.select(records, anchor, registeredAfterStart,
                name -> claimedByAnother(org, s.getId(), name));
        if (pick.isEmpty()) {
            store.recordCheck(org, s.getId(), GoogleCheckReport.noConference(
                    ConferenceSelector.diagnose(records, anchor, registeredAfterStart, name -> claimedByAnother(org, s.getId(), name)), account, now));
            return JobOutcome.poll(now.plus(Duration.ofMinutes(5)), "NO_CONFERENCE_YET");
        }
        Conference conf = pick.get();
        if (conf.end() == null) {
            store.recordCheck(org, s.getId(), GoogleCheckReport.inProgress(conf, account, now));
            return JobOutcome.poll(now.plus(Duration.ofMinutes(3)), "MEETING_IN_PROGRESS");
        }

        List<TranscriptInfo> all = api.listTranscripts(token, conf.name());
        List<TranscriptInfo> ready = all.stream()
                .filter(t -> "FILE_GENERATED".equals(t.state())
                        || ("ENDED".equals(t.state()) && t.end() != null && t.end().isBefore(now.minus(ENDED_PATIENCE))))
                .sorted(Comparator.comparing(t -> t.start() == null ? Instant.MAX : t.start()))
                .toList();
        if (ready.size() < all.size()) {
            store.recordCheck(org, s.getId(), GoogleCheckReport.transcriptNotReady(conf,
                    all.stream().map(t -> new GoogleCheckReport.TranscriptFact(t.state(), t.start(), t.end())).toList(), account, now));
            return JobOutcome.poll(now.plus(Duration.ofMinutes(2)), "TRANSCRIPT_NOT_READY");
        }
        if (ready.isEmpty()) {
            Instant giveUpAt = conf.end().plus(TRANSCRIPT_GRACE);
            store.recordCheck(org, s.getId(), GoogleCheckReport.noTranscript(conf, now, giveUpAt, account));
            if (now.isBefore(giveUpAt)) return JobOutcome.poll(now.plus(Duration.ofMinutes(3)), "NO_TRANSCRIPT_YET");
            return JobOutcome.fail("NO_TRANSCRIPT",
                    "Google Meet has no transcript for this meeting. Transcription has to be turned on during the meeting.",
                    "Upload or paste the transcript instead.");
        }

        Map<String, String> names = api.listParticipants(token, conf.name());
        List<TranscriptSegment> segments = new ArrayList<>();
        List<Span> spans = new ArrayList<>();
        for (TranscriptInfo t : ready) {
            spans.add(new Span(t.start(), t.end()));
            for (Entry e : api.listEntries(token, t.name())) {
                for (String piece : split(clean(e.text()))) {      // one spoken line may become several segments; nothing is cut off
                    TranscriptSegment seg = new TranscriptSegment();
                    seg.setText(piece);
                    seg.setLanguageCode(e.languageCode());
                    seg.setSpeakerRef(e.participant());
                    seg.setSpeakerLabel(e.participant() == null ? null : names.get(e.participant()));   // unknown stays unknown
                    seg.setStartTime(e.start());
                    seg.setStartMs(e.start() == null ? null : Math.max(0, Duration.between(conf.start(), e.start()).toMillis()));
                    seg.setEndMs(e.end() == null ? null : Math.max(0, Duration.between(conf.start(), e.end()).toMillis()));
                    seg.setSource("GOOGLE_MEET");
                    segments.add(seg);
                }
                if (segments.size() > TranscriptParser.MAX_SEGMENTS) {
                    return JobOutcome.fail("TRANSCRIPT_TOO_LONG",
                            "This meeting's transcript is too long to import automatically (limit " + TranscriptParser.MAX_SEGMENTS
                                    + " lines). Nothing was imported.", "Split the transcript and upload it in parts, or ask an admin about the limit.");
                }
            }
        }
        if (segments.isEmpty()) {
            return JobOutcome.fail("NO_TRANSCRIPT", "The transcript Google produced has no spoken text.", "Upload or paste a transcript instead.");
        }
        segments.sort(Comparator.comparing((TranscriptSegment x) -> x.getStartTime() == null ? Instant.MAX : x.getStartTime()));

        Coverage cov = ConferenceSelector.coverage(conf, spans);
        s.setConferenceRecord(conf.name());
        s.setStartedAt(conf.start());
        String detail = "Transcript imported from Google Meet (" + segments.size() + " lines)."
                + (cov.partial() ? " It may be incomplete. " + cov.note() : "")
                + " " + outputs.hint(org);
        MeetingSession saved = transcripts.receive(s, segments, "GOOGLE_MEET", cov.partial() ? "PARTIAL" : "FULL", cov.note(), "system", detail);
        store.recordCheck(org, s.getId(), GoogleCheckReport.imported(segments.size(), account));
        outputs.startIfEnabled(saved, "system");      // generates the documents straight away when the organization allows it and AI is ready
        return JobOutcome.done();
    }

    private boolean claimedByAnother(String org, String sessionId, String conferenceRecord) {
        return mongo.exists(new Query(Criteria.where("organizationId").is(org).and("conferenceRecord").is(conferenceRecord)
                .and("_id").ne(sessionId)), MeetingSession.class);
    }

    private static String clean(String t) {
        return t.replaceAll("[\\p{Cntrl}&&[^\n\t]]", "").strip();
    }

    private static List<String> split(String t) {
        List<String> out = new ArrayList<>();
        for (int i = 0; i < t.length(); i += TranscriptParser.MAX_TEXT) {
            out.add(t.substring(i, Math.min(t.length(), i + TranscriptParser.MAX_TEXT)));
        }
        return out;
    }
}

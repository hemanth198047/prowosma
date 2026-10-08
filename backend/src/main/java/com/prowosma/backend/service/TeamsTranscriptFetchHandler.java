package com.prowosma.backend.service;

import com.prowosma.backend.integration.TeamsGraphApi;
import com.prowosma.backend.integration.TeamsGraphApi.Transcript;
import com.prowosma.backend.meetingassistant.SessionStatus;
import com.prowosma.backend.meetingassistant.TranscriptParser;
import com.prowosma.backend.model.MeetingIntegration;
import com.prowosma.backend.model.MeetingJob;
import com.prowosma.backend.model.MeetingSession;
import com.prowosma.backend.model.TranscriptSegment;
import lombok.RequiredArgsConstructor;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.*;

/**
 * Imports the transcript of a finished Microsoft Teams meeting using the tenant's app-only access. The meeting is found from the organizer id
 * Teams puts in the invitation link and the Teams thread id (which is encoded inside every transcript's meeting id), so no extra Microsoft
 * permission beyond transcript access is needed. Polls without counting as errors; never truncates; leaves speakers as Teams names them.
 */
@Component
@RequiredArgsConstructor
public class TeamsTranscriptFetchHandler implements MeetingJobHandler {

    public static final String TYPE = "FETCH_TEAMS_TRANSCRIPT";
    static final Duration IN_PROGRESS_GRACE = Duration.ofMinutes(15);

    private final MeetingSessionStore store;
    private final TeamsAuthService auth;
    private final TeamsGraphApi api;
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
        if (st != SessionStatus.SCHEDULED && st != SessionStatus.AWAITING_TRANSCRIPT) return JobOutcome.done();     // cancelled, failed, or already has a transcript
        if (!"MS_TEAMS".equals(s.getProvider())) return JobOutcome.done();

        String thread = s.getMeetingKey();
        if (thread == null || !thread.startsWith("19:meeting_") || s.getOrganizerId() == null) {
            return JobOutcome.fail("UNSUPPORTED_LINK", "This Teams link doesn't say who organized the meeting, so its transcript can't be found automatically.",
                    "Use the \"Join the meeting\" link from the invitation, or upload or paste the transcript.");
        }
        MeetingIntegration integ = mongo.findOne(new Query(Criteria.where("organizationId").is(org).and("provider").is("MS_TEAMS")), MeetingIntegration.class);
        if (integ == null || !integ.isEnabled() || integ.getTenantId() == null)
            return JobOutcome.fail("TEAMS_NOT_CONNECTED", "Microsoft Teams isn't connected for your organization.", "Ask an admin to connect it under Meeting Platforms, or upload the transcript.");
        if (s.getTenantHint() != null && !s.getTenantHint().equalsIgnoreCase(integ.getTenantId()))
            return JobOutcome.fail("TENANT_MISMATCH", "This meeting belongs to a different Microsoft organization than the one connected.",
                    "Upload or paste the transcript instead.");

        TeamsAuthService.Token token = auth.token(integ.getTenantId());                                   // GraphApiException handled by the runner
        Instant now = Instant.now();
        boolean registeredAfterStart = s.getScheduledFor() == null;
        Instant anchor = registeredAfterStart ? s.getCreatedAt() : s.getScheduledFor();
        Instant from = anchor.minus(registeredAfterStart ? Duration.ofHours(3) : Duration.ofMinutes(60));

        List<Transcript> mine = api.listOrganizerTranscripts(token.value(), s.getOrganizerId(), from, anchor.plus(Duration.ofHours(12))).stream()
                .filter(t -> meetingIdContains(t.meetingId(), thread))
                .filter(t -> !claimedByAnother(org, s.getId(), t.id()))
                .sorted(Comparator.comparing(t -> t.createdAt() == null ? Instant.MAX : t.createdAt()))
                .toList();
        if (mine.isEmpty()) return JobOutcome.poll(now.plus(Duration.ofMinutes(5)), "NO_TRANSCRIPT_YET");
        for (Transcript t : mine)
            if (t.endedAt() == null && t.createdAt() != null && t.createdAt().isAfter(now.minus(IN_PROGRESS_GRACE)))
                return JobOutcome.poll(now.plus(Duration.ofMinutes(3)), "TRANSCRIPT_IN_PROGRESS");          // transcription is (probably) still running

        List<TranscriptSegment> segments = new ArrayList<>();
        Instant base = mine.get(0).createdAt();
        for (Transcript t : mine) {
            String vtt = api.transcriptVtt(token.value(), s.getOrganizerId(), t.meetingId(), t.id());
            TranscriptParser.Parsed parsed;
            try {
                parsed = TranscriptParser.parse(vtt, "VTT");
            } catch (TranscriptParser.TranscriptFormatException e) {
                return JobOutcome.fail("TRANSCRIPT_UNREADABLE", "Microsoft returned a transcript Prowosma couldn't read.", "Upload or paste the transcript instead.");
            }
            long offset = base != null && t.createdAt() != null ? Math.max(0, Duration.between(base, t.createdAt()).toMillis()) : 0;
            for (TranscriptParser.Segment p : parsed.segments()) {
                TranscriptSegment seg = new TranscriptSegment();
                seg.setText(p.text());
                seg.setSpeakerLabel(p.speaker());                                                           // as Teams named them; unknown stays unknown
                seg.setStartMs(p.startMs() == null ? null : p.startMs() + offset);
                seg.setEndMs(p.endMs() == null ? null : p.endMs() + offset);
                seg.setStartTime(base != null && seg.getStartMs() != null ? base.plusMillis(seg.getStartMs()) : null);
                seg.setSource("MS_TEAMS");
                segments.add(seg);
            }
            if (segments.size() > TranscriptParser.MAX_SEGMENTS)
                return JobOutcome.fail("TRANSCRIPT_TOO_LONG", "This meeting's transcript is too long to import automatically (limit " + TranscriptParser.MAX_SEGMENTS + " lines). Nothing was imported.",
                        "Split the transcript and upload it in parts.");
        }
        if (segments.isEmpty()) return JobOutcome.fail("NO_TRANSCRIPT", "The transcript Microsoft produced has no spoken text.", "Upload or paste a transcript instead.");

        s.setConferenceRecord(mine.get(0).id());
        String note = "Imported from Microsoft Teams" + (mine.size() > 1 ? " (" + mine.size() + " transcripts joined)" : "") + ". Whether it covers the whole meeting can't be verified.";
        String detail = "Transcript imported from Microsoft Teams (" + segments.size() + " lines). It may not cover the whole meeting. " + outputs.hint(org);
        MeetingSession saved = transcripts.receive(s, segments, "MS_TEAMS", "IMPORTED", note, "system", detail);
        outputs.startIfEnabled(saved, "system");
        return JobOutcome.done();
    }

    /** A transcript's meeting id is base64 of text that contains the Teams thread id — that is how it is tied to this meeting. */
    public static boolean meetingIdContains(String meetingId, String thread) {
        if (meetingId == null || thread == null) return false;
        try {
            String padded = meetingId.replace('-', '+').replace('_', '/');
            while (padded.length() % 4 != 0) padded += "=";
            return new String(Base64.getDecoder().decode(padded), StandardCharsets.UTF_8).contains(thread);
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    private boolean claimedByAnother(String org, String sessionId, String transcriptId) {
        return mongo.exists(new Query(Criteria.where("organizationId").is(org).and("conferenceRecord").is(transcriptId).and("_id").ne(sessionId)), MeetingSession.class);
    }
}

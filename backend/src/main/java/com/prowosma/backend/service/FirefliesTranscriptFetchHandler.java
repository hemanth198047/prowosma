package com.prowosma.backend.service;

import com.prowosma.backend.integration.FirefliesApi;
import com.prowosma.backend.integration.FirefliesException;
import com.prowosma.backend.meetingassistant.ConferenceLink;
import com.prowosma.backend.meetingassistant.FirefliesMapper;
import com.prowosma.backend.meetingassistant.FirefliesMatcher;
import com.prowosma.backend.meetingassistant.FirefliesMatcher.Decision;
import com.prowosma.backend.meetingassistant.FirefliesMatcher.Summary;
import com.prowosma.backend.meetingassistant.FirefliesReport;
import com.prowosma.backend.meetingassistant.SessionStatus;
import com.prowosma.backend.meetingassistant.TranscriptParser;
import com.prowosma.backend.model.MeetingAssistantSettings;
import com.prowosma.backend.model.MeetingJob;
import com.prowosma.backend.model.MeetingSession;
import com.prowosma.backend.model.TranscriptSegment;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * After the Fireflies notetaker was sent: looks for the meeting's transcript and brings it in. One Fireflies request serves every waiting meeting of a
 * workspace (cached for a few minutes), a rate limit means "try again when Fireflies says", and every check writes what it found on the meeting.
 */
@Component
@RequiredArgsConstructor
public class FirefliesTranscriptFetchHandler implements MeetingJobHandler {

    public static final String TYPE = "FETCH_FIREFLIES";

    private final MeetingSessionStore store;
    private final MeetingFirefliesService fireflies;
    private final MeetingTranscriptService transcripts;
    private final MeetingOutputService outputs;

    @Override
    public String type() { return TYPE; }

    /** Look often at first, then less often — and never more often than the shared cache refreshes. */
    public static Duration nextCheck(Instant sentAt, Instant now) {
        return Duration.between(sentAt, now).compareTo(Duration.ofHours(2)) < 0 ? Duration.ofMinutes(5) : Duration.ofMinutes(15);
    }

    @Override
    public JobOutcome handle(MeetingJob job) {
        final String org = job.getOrganizationId();
        MeetingSession s = store.find(org, job.getSessionId()).orElse(null);
        if (s == null) return JobOutcome.done();
        SessionStatus status = SessionStatus.valueOf(s.getStatus());
        if (!"SENT".equals(s.getFirefliesState())) return JobOutcome.done();                       // imported already, or the notetaker was never sent
        if (status != SessionStatus.AWAITING_TRANSCRIPT && status != SessionStatus.SCHEDULED) return JobOutcome.done();

        MeetingAssistantSettings st = fireflies.settings(org);
        String notReady = fireflies.fetchNotReadyReason(st);
        if (notReady != null)
            return JobOutcome.fail("FIREFLIES_NOT_CONFIGURED", notReady, "An admin needs to fix the Fireflies settings, then press Retry.");
        String apiKey = fireflies.apiKey(st);
        Instant now = Instant.now();
        Instant sentAt = s.getNotetakerSentAt() != null ? s.getNotetakerSentAt() : s.getCreatedAt() != null ? s.getCreatedAt() : now;

        try {
            return check(job, s, apiKey, sentAt, now);
        } catch (FirefliesException e) {
            return onProblem(org, s, e, now);
        }
    }

    private JobOutcome check(MeetingJob job, MeetingSession s, String apiKey, Instant sentAt, Instant now) {
        final String org = s.getOrganizationId();
        String key = ConferenceLink.keyOf(s.getMeetingUrl());
        List<Summary> recent = fireflies.recentCached(org, apiKey);
        Decision d = FirefliesMatcher.pick(recent, key, sentAt, id -> fireflies.isClaimed(org, id));

        if (d.kind() == FirefliesMatcher.Kind.NONE) {
            if (now.isAfter(sentAt.plus(MeetingFirefliesService.GIVE_UP_AFTER)))
                return JobOutcome.fail("NOTETAKER_NO_TRANSCRIPT", "Fireflies never produced a transcript for this meeting. The notetaker may not have been admitted, or the meeting didn't take place.",
                        "Import it from your recent Fireflies meetings if it is there, upload a transcript, or send the notetaker again at the next meeting.");
            record(org, s, FirefliesReport.waiting(d));
            return JobOutcome.poll(now.plus(nextCheck(sentAt, now)), "FIREFLIES_WAITING");
        }
        if (d.kind() == FirefliesMatcher.Kind.LIVE) {
            record(org, s, FirefliesReport.live());
            return JobOutcome.poll(now.plus(Duration.ofMinutes(3)), "FIREFLIES_LIVE");
        }

        Optional<FirefliesApi.Transcript> t = fireflies.transcript(apiKey, d.id());
        List<FirefliesMapper.Line> lines = t.isEmpty() ? List.of() : FirefliesMapper.toLines(t.get().sentences(), t.get().durationMinutes());
        if (t.isEmpty() || t.get().live() || lines.isEmpty()) {
            record(org, s, FirefliesReport.processing());
            return JobOutcome.poll(now.plus(Duration.ofMinutes(3)), "FIREFLIES_PROCESSING");
        }
        if (lines.size() > TranscriptParser.MAX_SEGMENTS)
            return JobOutcome.fail("TRANSCRIPT_TOO_LONG", "This Fireflies transcript is too long to import in one go.", "Upload it in parts instead.");
        if (!fireflies.claim(org, s.getId(), d.id())) {                       // another meeting took it a moment ago
            return JobOutcome.poll(now.plus(Duration.ofMinutes(1)), "FIREFLIES_CLAIMED");
        }

        List<TranscriptSegment> segments = new ArrayList<>();
        for (FirefliesMapper.Line l : lines) {
            TranscriptSegment seg = new TranscriptSegment();
            seg.setText(l.text());
            seg.setSpeakerLabel(l.speaker());
            seg.setStartMs(l.startMs());
            seg.setEndMs(l.endMs());
            seg.setSource("FIREFLIES");
            segments.add(seg);
        }
        String by = job.getRequestedBy() == null ? "system" : job.getRequestedBy();
        MeetingSession saved = transcripts.receive(s, segments, "FIREFLIES", "NOTETAKER",
                "Transcribed by the Fireflies notetaker. Speaker names come from Fireflies, and its speech recognition can make mistakes.", by, outputs.receivedDetail(org, segments.size()));
        fireflies.markImported(org, s.getId());
        record(org, s, FirefliesReport.imported(segments.size()));
        outputs.startIfEnabled(saved, by);
        return JobOutcome.done();
    }

    private JobOutcome onProblem(String org, MeetingSession s, FirefliesException e, Instant now) {
        String kind = e.getKind().name();
        record(org, s, FirefliesReport.problem(kind));
        return switch (e.getKind()) {
            case RATE_LIMITED -> JobOutcome.poll(e.getRetryAfter() != null ? e.getRetryAfter() : now.plus(Duration.ofMinutes(5)), "FIREFLIES_RATE_LIMITED");      // wait as asked — not a failure
            case AUTH -> JobOutcome.fail("FIREFLIES_KEY_REJECTED", "Fireflies rejected the saved API key.", "An admin needs to enter a new key in the Fireflies settings, then press Retry.");
            case PLAN -> JobOutcome.fail("FIREFLIES_PLAN", e.getMessage(), "Check the Fireflies plan and account, then press Retry.");
            case NOT_FOUND -> JobOutcome.poll(now.plus(Duration.ofMinutes(5)), "FIREFLIES_NOT_FOUND");
            default -> JobOutcome.retryError(now.plus(Duration.ofSeconds(60)), "FIREFLIES_TRANSIENT");
        };
    }

    private void record(String org, MeetingSession s, FirefliesReport.Report r) {
        store.recordCheck(org, s.getId(), r.code(), r.message(), r.facts());
    }
}

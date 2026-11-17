package com.prowosma.backend.uma.app;

import com.prowosma.backend.uma.ai.MeetingIntelligence;
import com.prowosma.backend.uma.core.*;
import com.prowosma.backend.uma.model.*;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Runs the Universal Meeting Assistant's background work: TRANSCRIBE (recording → transcript) then ANALYZE (transcript → insights).
 * Safe on several instances (jobs are leased). Failures that are worth retrying back off and retry; others — or a job that keeps
 * failing — end the meeting as FAILED with a plain reason and a recovery step, and the job as DEAD. A sweep re-queues meetings whose
 * job went missing (e.g. a crash between saving the meeting and queueing its job). Logs carry ids and codes only, never content.
 */
@Component
@Slf4j
public class UmaPipeline {
    public static final String TRANSCRIBE = "TRANSCRIBE";
    public static final String ANALYZE = "ANALYZE";
    public static final String FETCH_FIREFLIES = "FETCH_FIREFLIES";
    public static final String FETCH_GOOGLE = "FETCH_GOOGLE";
    static final java.time.Duration FIREFLIES_GIVE_UP = java.time.Duration.ofHours(24);

    private final UmaJobQueue queue;
    private final UmaStore store;
    private final UmaTranscriber transcriber;
    private final MeetingIntelligence intelligence;
    private final MongoTemplate mongo;
    private final com.prowosma.backend.uma.core.UmaFireflies fireflies;
    private final com.prowosma.backend.uma.core.UmaGoogleMeet googleMeet;
    private final String workerId = "uma-" + UUID.randomUUID();
    private volatile Instant lastSweep = Instant.EPOCH;

    @Value("${app.uma.jobs-enabled:true}") private boolean enabled = true;

    public UmaPipeline(UmaJobQueue queue, UmaStore store, UmaTranscriber transcriber, MeetingIntelligence intelligence, MongoTemplate mongo,
                       com.prowosma.backend.uma.core.UmaFireflies fireflies, com.prowosma.backend.uma.core.UmaGoogleMeet googleMeet) {
        this.queue = queue; this.store = store; this.transcriber = transcriber; this.intelligence = intelligence; this.mongo = mongo;
        this.fireflies = fireflies; this.googleMeet = googleMeet;
    }

    @Scheduled(fixedDelayString = "${app.uma.job-poll-ms:5000}", initialDelayString = "${app.uma.job-initial-delay-ms:20000}")
    public void tick() {
        if (!enabled) return;
        try {
            if (Duration.between(lastSweep, Instant.now()).toMinutes() >= 1) { sweep(); lastSweep = Instant.now(); }
            for (int i = 0; i < 5; i++) if (!runOne()) break;
        } catch (Exception e) {
            log.warn("uma pipeline tick failed: {}", e.getClass().getSimpleName());
        }
    }

    /** Runs due jobs until none are left (used by tests and by "run now"). Returns how many ran. */
    public int drain() {
        int n = 0;
        while (n < 50 && runOne()) n++;
        return n;
    }

    boolean runOne() {
        UmaJob job = queue.claimNext(workerId).orElse(null);
        if (job == null) return false;
        UmaMeeting m = store.meeting(job.getOrganizationId(), job.getMeetingId()).orElse(null);
        if (m == null || m.getStatus() == UmaStatus.CANCELLED) { queue.succeed(job); return true; }
        try {
            switch (job.getType()) {
                case TRANSCRIBE -> transcribe(job, m);
                case ANALYZE -> analyze(job, m);
                case FETCH_FIREFLIES -> fetchFireflies(job, m);
                case FETCH_GOOGLE -> fetchGoogle(job, m);
                default -> queue.dead(job, "UNKNOWN_TYPE");
            }
        } catch (UmaException e) {
            fail(job, m, e.getCode(), e.getMessage(), e.getRecovery(), retryable(e));
        } catch (RuntimeException e) {
            log.warn("uma job {} ({}) for meeting {} failed: {}", job.getId(), job.getType(), job.getMeetingId(), e.getClass().getSimpleName());
            fail(job, m, "UNEXPECTED", "Something unexpected stopped this step.", "Press Retry. If it keeps happening, contact support with the meeting's id.", true);
        }
        return true;
    }

    private void transcribe(UmaJob job, UmaMeeting m) {
        String org = m.getOrganizationId();
        if (m.getStatus() != UmaStatus.TRANSCRIBING)
            m = store.transition(org, m.getId(), UmaStatus.TRANSCRIBING, "system", "Turning speech into text…", "transcription started");
        UmaTranscriber.Outcome o = transcriber.transcribe(m, piece -> {
            queue.extendLease(job);
        });
        m = store.meeting(org, m.getId()).orElseThrow();
        UmaMeeting.TranscriptInfo info = m.getTranscript() == null ? new UmaMeeting.TranscriptInfo() : m.getTranscript();
        info.setOrigin("STT"); info.setLanguage(o.language()); info.setSegmentCount(o.segments());
        info.setEngine(o.engine()); info.setModel(o.model()); info.setProcessingMs(o.processingMs());
        info.setSpeakersKnown(m.getRecording() != null && !m.getRecording().getPieces().isEmpty()); info.setUpdatedAt(Instant.now());
        m.setTranscript(info);
        m.setProgressPercent(80);
        store.save(m);
        store.transition(org, m.getId(), UmaStatus.ANALYZING, "system", "Writing the summary and finding decisions and actions…", "transcribed " + o.segments() + " lines");
        queue.succeed(job);
        queue.enqueue(org, m.getId(), ANALYZE, job.getRequestedBy());
        store.audit(org, m.getId(), "system", "TRANSCRIBED", o.segments() + " lines, " + o.processingMs() + " ms");
    }

    /**
     * After the Fireflies notetaker was sent: look for its transcript every few minutes. Fireflies needs a while after the meeting ends;
     * after 24 hours without one the meeting says so and points to "Import from Fireflies".
     */
    private void fetchFireflies(UmaJob job, UmaMeeting m) {
        String org = m.getOrganizationId();
        if (m.getStatus() != UmaStatus.CREATED || m.getFireflies() == null) { queue.succeed(job); return; }   // content came another way
        UmaMeeting.FirefliesLink f = m.getFireflies();
        f.setChecks(f.getChecks() + 1);
        f.setLastCheckAt(Instant.now());
        com.prowosma.backend.meetingassistant.FirefliesMatcher.Decision d = fireflies.findForMeeting(m);
        if (d.kind() == com.prowosma.backend.meetingassistant.FirefliesMatcher.Kind.MATCH) {
            var t = fireflies.transcript(org, d.id());
            if (t.isPresent() && t.get().sentences() != null && !t.get().sentences().isEmpty()) {
                fireflies.apply(m, t.get(), "system");
                queue.succeed(job);
                queue.enqueue(org, m.getId(), ANALYZE, job.getRequestedBy());
                return;
            }
        }
        Instant sent = f.getNotetakerSentAt() == null ? m.getCreatedAt() : f.getNotetakerSentAt();
        if (sent != null && Duration.between(sent, Instant.now()).compareTo(FIREFLIES_GIVE_UP) > 0) {
            store.save(m);
            fail(job, m, "FIREFLIES_NO_TRANSCRIPT", "Fireflies' transcript for this meeting didn't arrive within 24 hours.",
                    "If Fireflies recorded it, open Import from Fireflies and pick it. Otherwise add the recording.", false);
            return;
        }
        boolean live = d.kind() == com.prowosma.backend.meetingassistant.FirefliesMatcher.Kind.LIVE;
        m.setStatusDetail(live ? "Fireflies is in the meeting. The transcript is fetched automatically when it ends."
                : "Waiting for Fireflies' transcript. It usually arrives a few minutes after the meeting ends.");
        store.save(m);
        queue.pollAgain(job, Duration.ofMinutes(live ? 5 : 10));
    }

    /** After a Google Meet meeting: read Google's own transcript through the connected account. */
    private void fetchGoogle(UmaJob job, UmaMeeting m) {
        String org = m.getOrganizationId();
        if (m.getStatus() != UmaStatus.CREATED) { queue.succeed(job); return; }      // content came another way
        UmaMeeting.GoogleLink g = m.getGoogle() == null ? new UmaMeeting.GoogleLink() : m.getGoogle();
        g.setChecks(g.getChecks() + 1);
        g.setLastCheckAt(Instant.now());
        m.setGoogle(g);
        store.save(m);
        com.prowosma.backend.uma.core.UmaGoogleMeet.Check c = googleMeet.fetch(m);
        switch (c.outcome()) {
            case "DONE" -> { queue.succeed(job); queue.enqueue(org, m.getId(), ANALYZE, job.getRequestedBy()); }
            case "FAIL" -> fail(job, m, c.code(), c.note(), c.recovery(), false);
            default -> {
                UmaMeeting fresh = store.meeting(org, m.getId()).orElse(m);
                fresh.setStatusDetail(c.note());
                if (fresh.getGoogle() != null) fresh.getGoogle().setLastNote(c.note());
                store.save(fresh);
                queue.pollAgain(job, c.again());
            }
        }
    }

    private void analyze(UmaJob job, UmaMeeting m) {
        String org = m.getOrganizationId();
        if (m.getStatus() != UmaStatus.ANALYZING)
            m = store.transition(org, m.getId(), UmaStatus.ANALYZING, "system", "Writing the summary and finding decisions and actions…", "analysis started");
        UmaInsights ins = intelligence.analyze(m, part -> queue.extendLease(job));
        m = store.meeting(org, m.getId()).orElseThrow();
        m.setInsightsVersion(ins.getVersion());
        m.setProgressPercent(100);
        store.save(m);
        long pending = ins.getActions().stream().filter(a -> "PENDING".equals(a.getStatus())).count();
        String detail = "Your meeting summary is ready." + (pending > 0 ? " " + pending + " action item" + (pending == 1 ? "" : "s") + " to review." : "");
        store.transition(org, m.getId(), UmaStatus.REVIEW_READY, "system", detail, "insights v" + ins.getVersion());
        queue.succeed(job);
        store.audit(org, m.getId(), "system", "ANALYZED", "v" + ins.getVersion() + ", " + ins.getActions().size() + " actions");
    }

    private static boolean retryable(UmaException e) {
        return e.getStatus() == HttpStatus.SERVICE_UNAVAILABLE || "UNEXPECTED".equals(e.getCode());
    }

    private void fail(UmaJob job, UmaMeeting m, String code, String message, String recovery, boolean retryable) {
        String org = m.getOrganizationId();
        if (retryable && job.getAttempts() < job.getMaxAttempts()) {
            queue.retryLater(job, code);
            UmaMeeting fresh = store.meeting(org, m.getId()).orElse(m);
            fresh.setStatusDetail(message + " Trying again automatically (attempt " + (job.getAttempts() + 1) + " of " + job.getMaxAttempts() + ").");
            store.save(fresh);
            return;
        }
        queue.dead(job, code);
        UmaMeeting fresh = store.meeting(org, m.getId()).orElse(m);
        if (fresh.getStatus() == UmaStatus.CANCELLED || !fresh.getStatus().canMoveTo(UmaStatus.FAILED)) return;
        UmaStatus stage = TRANSCRIBE.equals(job.getType()) ? UmaStatus.TRANSCRIBING
                : FETCH_FIREFLIES.equals(job.getType()) || FETCH_GOOGLE.equals(job.getType()) ? UmaStatus.CREATED : UmaStatus.ANALYZING;
        fresh = store.transition(org, fresh.getId(), UmaStatus.FAILED, "system", message, code);
        fresh.setErrorCode(code);
        fresh.setRecoveryHint(recovery);
        fresh.setFailedStage(stage);
        store.save(fresh);
        store.audit(org, fresh.getId(), "system", "FAILED", code);
    }

    /** Meetings that are QUEUED / TRANSCRIBING / ANALYZING but have no live job for a while get their job back. */
    void sweep() {
        Instant cutoff = Instant.now().minus(Duration.ofMinutes(5));
        List<UmaMeeting> stuck = mongo.find(new Query(Criteria.where("status").in(UmaStatus.QUEUED, UmaStatus.TRANSCRIBING, UmaStatus.ANALYZING)
                .and("updatedAt").lt(cutoff)).limit(50), UmaMeeting.class);
        for (UmaMeeting m : stuck) {
            boolean live = queue.forMeeting(m.getOrganizationId(), m.getId()).stream()
                    .anyMatch(j -> "QUEUED".equals(j.getStatus()) || "RUNNING".equals(j.getStatus()));
            if (live) continue;
            String type = m.getStatus() == UmaStatus.ANALYZING ? ANALYZE : TRANSCRIBE;
            queue.enqueue(m.getOrganizationId(), m.getId(), type, m.getCreatedBy());
            log.info("uma sweep: re-queued {} for meeting {}", type, m.getId());
        }
        // Browser recordings whose page was closed without pressing Stop: finish them with what arrived, after 10 quiet minutes.
        Instant quiet = Instant.now().minus(Duration.ofMinutes(10));
        List<UmaMeeting> abandoned = mongo.find(new Query(Criteria.where("status").is(UmaStatus.CAPTURING)
                .and("updatedAt").lt(quiet)).limit(50), UmaMeeting.class);
        for (UmaMeeting m : abandoned) {
            boolean any = m.getRecording() != null && !m.getRecording().getPieces().isEmpty();
            if (any) {
                store.transition(m.getOrganizationId(), m.getId(), UmaStatus.QUEUED, "system", "The recording stopped arriving, so it was finished with what was received.", "capture abandoned");
                queue.enqueue(m.getOrganizationId(), m.getId(), TRANSCRIBE, m.getCreatedBy());
            } else {
                UmaMeeting f = store.transition(m.getOrganizationId(), m.getId(), UmaStatus.FAILED, "system", "No audio arrived from the browser.", "capture abandoned, empty");
                f.setErrorCode("NO_AUDIO"); f.setFailedStage(UmaStatus.CAPTURING);
                f.setRecoveryHint("Start the recording again and keep this page open until you press Stop.");
                store.save(f);
            }
            log.info("uma sweep: finished abandoned capture {}", m.getId());
        }
    }
}

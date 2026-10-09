package com.prowosma.backend.service;

import com.prowosma.backend.integration.GoogleApiException;
import com.prowosma.backend.integration.GraphApiException;
import com.prowosma.backend.integration.LlmException;
import com.prowosma.backend.meetingassistant.SessionStatus;
import com.prowosma.backend.model.MeetingJob;
import com.prowosma.backend.model.MeetingSession;
import com.prowosma.backend.repository.MeetingAssistantSettingsRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Polls the job queue. Runs on every instance; the atomic claim in MeetingJobService makes that safe.
 * Failures are bounded: a job gives up after too many consecutive errors, too many runs overall, or its
 * deadline — and the meeting is then marked FAILED with a message and a recovery step a person can act on.
 * Logs carry job/session ids and error TYPES only; never transcript text, tokens or response bodies.
 */
@Component
@Slf4j
public class MeetingJobRunner {

    static final int MAX_ERROR_STREAK = 8;
    private static final int MAX_JOBS_PER_TICK = 10;
    private static final Duration PURGE_EVERY = Duration.ofHours(6);
    /** A failed IMPORT may only fail a meeting that is still waiting; a failed GENERATION may only fail one that is processing. */
    private static Set<SessionStatus> failable(MeetingJob job) {
        return MeetingOutputService.JOB_TYPE.equals(job.getType())
                ? EnumSet.of(SessionStatus.PROCESSING)
                : EnumSet.of(SessionStatus.SCHEDULED, SessionStatus.AWAITING_TRANSCRIPT);
    }

    private final MeetingJobService jobs;
    private final MeetingSessionStore store;
    private final MeetingTranscriptService transcripts;
    private final MeetingOutputService outputs;
    private final MeetingActionService actionService;
    private final MeetingMetrics metrics;
    private final MeetingRecoveryService recovery;
    private final MeetingAssistantSettingsRepository settingsRepo;
    private final MeetingRecordingService recordings;
    private final Map<String, MeetingJobHandler> handlers = new HashMap<>();
    private final String workerId = UUID.randomUUID().toString();
    private volatile Instant lastPurge = Instant.EPOCH;
    private volatile Instant lastSweep = Instant.EPOCH;

    @Value("${app.meeting-assistant.jobs-enabled:true}")
    private boolean enabled;

    public MeetingJobRunner(MeetingJobService jobs, MeetingSessionStore store, MeetingTranscriptService transcripts,
                            MeetingOutputService outputs, MeetingActionService actionService, MeetingMetrics metrics, MeetingRecoveryService recovery,
                            MeetingAssistantSettingsRepository settingsRepo, MeetingRecordingService recordings,
                            List<MeetingJobHandler> handlerList) {
        this.jobs = jobs;
        this.store = store;
        this.transcripts = transcripts;
        this.outputs = outputs;
        this.actionService = actionService;
        this.metrics = metrics;
        this.recovery = recovery;
        this.settingsRepo = settingsRepo;
        this.recordings = recordings;
        for (MeetingJobHandler h : handlerList) handlers.put(h.type(), h);
    }

    @Scheduled(fixedDelayString = "${app.meeting-assistant.job-poll-ms:15000}",
               initialDelayString = "${app.meeting-assistant.job-initial-delay-ms:30000}")
    public void tick() {
        if (!enabled) return;
        try {
            runOnce();
            if (Instant.now().isAfter(lastSweep.plus(Duration.ofMinutes(5)))) {
                lastSweep = Instant.now();
                recovery.sweepStuck();
                recordings.sweep();                  // delete audio whose time is up, finish abandoned recordings
            }
            if (Instant.now().isAfter(lastPurge.plus(PURGE_EVERY))) {
                lastPurge = Instant.now();
                int n = transcripts.purgeExpired(this::retentionDays);
                int g = outputs.purgeExpired(this::generatedRetentionDays);
                recovery.purgeOperational(this::generatedRetentionDays);
                if (n > 0 || g > 0) log.info("Meeting retention removed {} transcript(s) and {} generated document version(s)", n, g);
            }
        } catch (RuntimeException e) {
            log.error("Meeting job tick failed: {}", e.getClass().getSimpleName());
        }
    }

    private int retentionDays(String org) {
        try {
            return settingsRepo.findByOrganizationId(org).map(s -> s.getTranscriptRetentionDays()).orElse(90);
        } catch (RuntimeException e) {
            return 90;
        }
    }

    private int generatedRetentionDays(String org) {
        try {
            return settingsRepo.findByOrganizationId(org).map(s -> s.getGeneratedContentRetentionDays()).orElse(365);
        } catch (RuntimeException e) {
            return 365;
        }
    }

    /** Runs due jobs now. Public so tests (and operators via a future admin action) can drive the queue deterministically. */
    /** Runs one meeting's job immediately (the "Check now" button) instead of waiting for the next poll. False if someone else is already running it. */
    public boolean runNow(String org, String type, String sessionId) {
        MeetingJob job = jobs.claimFor(org, type, sessionId, workerId);
        if (job == null) return false;
        execute(job);
        return true;
    }

    public int runOnce() {
        int n = 0;
        for (int i = 0; i < MAX_JOBS_PER_TICK; i++) {
            MeetingJob job = jobs.claimNext(workerId);
            if (job == null) break;
            execute(job);
            n++;
        }
        return n;
    }

    private void execute(MeetingJob job) {
        MeetingJobHandler handler = handlers.get(job.getType());
        if (handler == null) {
            jobs.failJob(job, "NO_HANDLER");
            return;
        }
        JobOutcome o;
        long t0 = System.currentTimeMillis();
        try {
            o = handler.handle(job);
        } catch (MeetingAssistantException e) {
            // "Not connected" / "sign-in expired" can't fix themselves; a concurrent edit can.
            o = "CONFLICT".equals(e.getCode()) ? JobOutcome.retryError(Instant.now().plusSeconds(30), "CONFLICT")
                    : JobOutcome.fail(e.getCode(), e.getMessage(), recoveryFor(e.getCode()));
        } catch (GoogleApiException e) {
            o = fromGoogle(e);
        } catch (GraphApiException e) {
            o = fromGraph(e);
        } catch (LlmException e) {
            o = fromLlm(e);
        } catch (RuntimeException e) {
            log.warn("Meeting job {} ({}) crashed: {}", job.getId(), job.getType(), e.getClass().getSimpleName());
            o = JobOutcome.retryError(Instant.now().plusSeconds(60), "UNEXPECTED");
        }
        apply(job, o);
        metrics.job(job.getType(), o.kind().name().toLowerCase(java.util.Locale.ROOT), System.currentTimeMillis() - t0);
    }

    private static JobOutcome fromGoogle(GoogleApiException e) {
        return switch (e.getKind()) {
            case UNAUTHORIZED -> JobOutcome.fail("GOOGLE_REAUTH_REQUIRED",
                    "Google rejected the saved sign-in.", "Reconnect your Google account, then retry.");
            case FORBIDDEN -> JobOutcome.fail("GOOGLE_ACCESS_DENIED",
                    "Google didn't allow access to this meeting's records. The connected account may need to have organized or attended the meeting, "
                            + "or your organization's Google settings may block it.",
                    "Connect the Google account of the meeting organizer, or upload the transcript instead.");
            case TOO_LARGE -> JobOutcome.fail("TRANSCRIPT_TOO_LONG",
                    "This meeting's records are too large to import automatically.", "Upload the transcript in parts instead.");
            case BAD_RESPONSE -> JobOutcome.retryError(Instant.now().plusSeconds(120), "BAD_RESPONSE");
            case NOT_FOUND -> JobOutcome.poll(Instant.now().plus(Duration.ofMinutes(5)), "NOT_FOUND_YET");
            default -> JobOutcome.retryError(Instant.now().plusSeconds(60), e.getKind().name());   // RATE_LIMITED, SERVER, NETWORK
        };
    }

    private static JobOutcome fromGraph(GraphApiException e) {
        return switch (e.getKind()) {
            case UNAUTHORIZED -> switch (e.getCode()) {
                case "CONSENT_MISSING" -> JobOutcome.fail("TEAMS_CONSENT_MISSING", e.getMessage(), "Ask your Microsoft 365 admin to grant admin consent to the app, then Retry. Or upload the transcript.");
                case "BAD_SECRET" -> JobOutcome.fail("TEAMS_BAD_SECRET", e.getMessage(), "Ask an admin to update the app's client secret on the server, then Retry. Or upload the transcript.");
                case "NOT_CONFIGURED" -> JobOutcome.fail("TEAMS_NOT_CONFIGURED", e.getMessage(), "Ask an admin to finish the Microsoft setup, or upload the transcript.");
                case "TENANT_NOT_FOUND" -> JobOutcome.fail("TEAMS_TENANT_NOT_FOUND", e.getMessage(), "Ask an admin to correct the Microsoft tenant id, or upload the transcript.");
                default -> JobOutcome.fail("TEAMS_AUTH", "Microsoft didn't accept the app's sign-in.", "Ask an admin to check the Microsoft setup, then Retry. Or upload the transcript.");
            };
            case FORBIDDEN -> JobOutcome.fail("TEAMS_ACCESS_DENIED",
                    "Microsoft didn't allow the app to read this organizer's transcripts. An administrator must create an application access policy for the app and grant it to the meeting organizer (it can take a while to apply).",
                    "Fix the policy and Retry, or upload the transcript.");
            case TRANSCRIPTS_DISABLED -> JobOutcome.fail("TEAMS_TRANSCRIPTS_DISABLED",
                    "Your Microsoft 365 administrator has disabled Graph API access to meeting transcripts.", "Ask them to allow it, or upload the transcript.");
            case TOO_LARGE -> JobOutcome.fail("TRANSCRIPT_TOO_LONG", "This meeting's transcript is too large to import automatically.", "Upload the transcript in parts instead.");
            case NOT_FOUND -> JobOutcome.poll(Instant.now().plus(Duration.ofMinutes(5)), "NOT_FOUND_YET");
            case BAD_RESPONSE -> JobOutcome.retryError(Instant.now().plusSeconds(120), "BAD_RESPONSE");
            default -> JobOutcome.retryError(Instant.now().plusSeconds(60), e.getKind().name());                  // rate limit, outage, network
        };
    }

    private static JobOutcome fromLlm(LlmException e) {
        return switch (e.getKind()) {
            case NOT_CONFIGURED -> JobOutcome.fail("AI_NOT_CONFIGURED", e.getMessage(), "Ask an admin to finish AI Settings, then press Generate again.");
            case AUTH -> JobOutcome.fail("AI_AUTH", "The AI provider rejected the saved API key.",
                    "An admin should check the key in AI Settings, then press Generate again.");
            case BAD_RESPONSE -> JobOutcome.fail("AI_BAD_OUTPUT", e.getMessage(),
                    "Press Generate again. If it keeps happening, an admin can try a different model in AI Settings.");
            case INPUT_TOO_LARGE -> JobOutcome.fail("AI_INPUT_TOO_LARGE", "The configured AI model couldn't take this much text.",
                    "An admin can choose a model with a larger context window in AI Settings.");
            default -> JobOutcome.retryError(Instant.now().plusSeconds(90), e.getKind().name());   // rate limit, outage, network
        };
    }

    private static String recoveryFor(String code) {
        return switch (code) {
            case "GOOGLE_NOT_CONNECTED", "GOOGLE_REAUTH_REQUIRED" -> "Connect your Google account in Meeting Platforms, then retry. Or upload the transcript.";
            case "GOOGLE_NOT_CONFIGURED", "ENCRYPTION_NOT_CONFIGURED" -> "Ask an admin to finish the Google setup, or upload the transcript.";
            default -> "Retry, or upload the transcript instead.";
        };
    }

    private void apply(MeetingJob job, JobOutcome o) {
        switch (o.kind()) {
            case DONE -> jobs.succeed(job);
            case FAIL -> {
                failSession(job, o.code(), o.message(), o.recovery());
                jobs.failJob(job, o.code());
            }
            case RETRY -> {
                int streak = o.isError() ? job.getErrorStreak() + 1 : 0;
                boolean pastDeadline = job.getDeadline() != null && Instant.now().isAfter(job.getDeadline());
                boolean generation = MeetingOutputService.JOB_TYPE.equals(job.getType()) || MeetingActionService.JOB_TYPE.equals(job.getType());
                if (streak >= MAX_ERROR_STREAK || (generation && job.getAttempts() >= job.getMaxAttempts())) {
                    if (generation) failSession(job, "AI_UNAVAILABLE", "The AI service didn't respond after several tries.",
                            "Try again in a few minutes by pressing Generate again.");
                    else if (TranscribeRecordingHandler.TYPE.equals(job.getType())) failSession(job, "STT_UNAVAILABLE",
                            "The speech-to-text server didn't respond after several tries.",
                            "Check that the server is running, then press Retry. The recording is kept for the time set in the recording settings.");
                    else failSession(job, "TEMPORARY_PROBLEM", "Prowosma couldn't reach the meeting platform after several tries.",
                            "Retry in a little while, or upload the transcript.");
                    jobs.failJob(job, "TOO_MANY_ERRORS");
                } else if (pastDeadline || job.getAttempts() >= job.getMaxAttempts()) {
                    failSession(job, "TRANSCRIPT_TIMEOUT",
                            "No transcript appeared in time. A transcript only exists if transcription was turned on during the meeting.",
                            "Upload or paste the transcript instead.");
                    jobs.failJob(job, "TIMEOUT");
                } else {
                    jobs.reschedule(job, o.retryAt(), o.code(), o.isError());
                }
            }
        }
    }

    private void failSession(MeetingJob job, String code, String message, String recovery) {
        if (MeetingActionService.JOB_TYPE.equals(job.getType())) {          // action extraction failing never fails the meeting itself
            actionService.markFailed(job, code, message, recovery);
            return;
        }
        if (MeetingCreationService.JOB_TYPE.equals(job.getType())) {        // automatic creation failing leaves everything in review
            store.audit(job.getOrganizationId(), job.getSessionId(), "system", "AUTO_CREATE_FAILED", code);
            return;
        }
        try {
            store.find(job.getOrganizationId(), job.getSessionId()).ifPresent((MeetingSession s) -> {
                if (failable(job).contains(SessionStatus.valueOf(s.getStatus()))) {
                    store.transition(s, SessionStatus.FAILED, "system", (MeetingOutputService.JOB_TYPE.equals(job.getType()) ? "Generation failed (" : TranscribeRecordingHandler.TYPE.equals(job.getType()) ? "Turning the recording into text failed (" : "Transcript import failed (") + code + ")", message, code, recovery);
                }
            });
        } catch (MeetingAssistantException e) {
            log.debug("Could not mark meeting failed ({}); it changed concurrently", e.getCode());
        }
    }
}

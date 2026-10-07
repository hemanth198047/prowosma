package com.prowosma.backend.service;

import com.prowosma.backend.integration.LlmClient;
import com.prowosma.backend.meetingassistant.SessionStatus;
import com.prowosma.backend.model.MeetingJob;
import com.prowosma.backend.model.MeetingSession;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.time.Instant;

/** Background job: produce Summary, MOM and Notes for a meeting that is in PROCESSING, then move it to review. */
@Component
@RequiredArgsConstructor
public class GenerateOutputsHandler implements MeetingJobHandler {

    private final MeetingSessionStore store;
    private final MeetingOutputService outputs;
    private final LlmClient llm;
    private final MeetingJobService jobs;
    private final MeetingActionService actions;

    @Override
    public String type() { return MeetingOutputService.JOB_TYPE; }

    @Override
    public JobOutcome handle(MeetingJob job) {
        MeetingSession s = store.find(job.getOrganizationId(), job.getSessionId()).orElse(null);
        // Cancelled, or already handled by another worker: nothing to do.
        if (s == null || !SessionStatus.PROCESSING.name().equals(s.getStatus())) return JobOutcome.done();

        String reason = llm.notReadyReason(s.getOrganizationId());
        if (reason != null) return JobOutcome.fail("AI_NOT_CONFIGURED", reason, "Ask an admin to finish AI Settings, then press Generate again.");

        MeetingOutputService.Outcome o = outputs.generate(job, s, job.getPayload(), () -> jobs.extendLease(job));   // keeps the lease alive between model calls
        s.setOutputsGeneratedAt(Instant.now());
        StringBuilder detail = new StringBuilder("Summary, minutes and notes are ready for review.");
        if (o.dropped() > 0) detail.append(' ').append(o.dropped()).append(" statement(s) were removed because they didn't point to the transcript.");
        for (String w : o.warnings()) if (!w.contains("removed because")) detail.append(' ').append(w);
        MeetingSession ready = store.transition(s, SessionStatus.READY_FOR_REVIEW, "system", "Outputs generated", detail.toString(), null, null);
        actions.startIfEnabled(ready, "system");      // structured actions follow the documents (same switch and limits)
        return JobOutcome.done();
    }
}

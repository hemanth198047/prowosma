package com.prowosma.backend.service;

import com.prowosma.backend.integration.LlmClient;
import com.prowosma.backend.model.MeetingJob;
import com.prowosma.backend.model.MeetingSession;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/** Background job: extract structured actions from a meeting's transcript. A failure marks the ACTIONS as failed — it never fails the meeting. */
@Component
@RequiredArgsConstructor
public class ExtractActionsHandler implements MeetingJobHandler {

    private final MeetingSessionStore store;
    private final MeetingActionService actions;
    private final LlmClient llm;
    private final MeetingJobService jobs;
    private final MeetingCreationService creation;

    @Override
    public String type() { return MeetingActionService.JOB_TYPE; }

    @Override
    public JobOutcome handle(MeetingJob job) {
        MeetingSession s = store.find(job.getOrganizationId(), job.getSessionId()).orElse(null);
        if (s == null || s.getSegmentCount() <= 0 || s.getTranscriptPurgedAt() != null) return JobOutcome.done();
        String reason = llm.notReadyReason(s.getOrganizationId());
        if (reason != null) return JobOutcome.fail("AI_NOT_CONFIGURED", reason, "Ask an admin to finish AI Settings, then press Extract actions again.");
        actions.run(job, s, job.getPayload(), () -> jobs.extendLease(job));
        store.find(s.getOrganizationId(), s.getId()).ifPresent(fresh -> creation.scheduleAutoIfEnabled(fresh, job.getRequestedBy()));   // only queues work if an admin enabled it
        return JobOutcome.done();
    }
}

package com.prowosma.backend.service;

import com.prowosma.backend.model.MeetingJob;
import com.prowosma.backend.model.MeetingSession;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/** Background job for Automatic Creation. Per-item failures are recorded on the items; the job itself only retries on unexpected errors. */
@Component
@RequiredArgsConstructor
public class CreateFromMeetingHandler implements MeetingJobHandler {

    private final MeetingSessionStore store;
    private final MeetingCreationService creation;

    @Override
    public String type() { return MeetingCreationService.JOB_TYPE; }

    @Override
    public JobOutcome handle(MeetingJob job) {
        MeetingSession s = store.find(job.getOrganizationId(), job.getSessionId()).orElse(null);
        if (s == null || "CANCELLED".equals(s.getStatus())) return JobOutcome.done();
        creation.runAuto(job, s);
        return JobOutcome.done();
    }
}

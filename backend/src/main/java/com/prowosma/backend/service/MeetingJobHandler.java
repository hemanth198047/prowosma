package com.prowosma.backend.service;

import com.prowosma.backend.model.MeetingJob;

/** One kind of background work. Handlers must be idempotent: a job can run again after a crash or lease expiry. */
public interface MeetingJobHandler {
    String type();

    JobOutcome handle(MeetingJob job);
}

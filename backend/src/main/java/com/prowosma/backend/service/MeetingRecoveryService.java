package com.prowosma.backend.service;

import com.prowosma.backend.meetingassistant.SessionStatus;
import com.prowosma.backend.model.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.function.ToIntFunction;

/**
 * Self-healing and housekeeping, safe on every instance (all operations are idempotent).
 *  - A meeting left in PROCESSING, or an action extraction left RUNNING, with NO live job behind it (the job was lost, e.g. after a
 *    crash or a manual database change) would otherwise spin forever. It is moved to FAILED with a message and a Retry.
 *  - Old operational records are removed so the collections don't grow without bound.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class MeetingRecoveryService {

    private static final int BATCH = 200;
    private final MongoTemplate mongo;
    private final MeetingSessionStore store;

    @Value("${app.meeting-assistant.stuck-after-minutes:10}")
    private int stuckAfterMinutes;
    @Value("${app.meeting-assistant.audit-retention-days:730}")
    private int auditRetentionDays;

    private boolean liveJob(String org, String sessionId, String type) {
        MeetingJob j = mongo.findOne(new Query(Criteria.where("organizationId").is(org).and("jobKey").is(MeetingJobService.keyOf(type, sessionId))), MeetingJob.class);
        return j != null && ("QUEUED".equals(j.getStatus()) || "RUNNING".equals(j.getStatus()));   // an expired RUNNING lease is still reclaimed by the runner
    }

    /** @return how many items were repaired */
    public int sweepStuck() {
        Instant cutoff = Instant.now().minus(Math.max(1, stuckAfterMinutes), ChronoUnit.MINUTES);
        int fixed = 0;
        List<MeetingSession> processing = mongo.find(new Query(Criteria.where("status").is("PROCESSING").and("updatedAt").lt(cutoff)).limit(BATCH), MeetingSession.class);
        for (MeetingSession s : processing) {
            if (liveJob(s.getOrganizationId(), s.getId(), MeetingOutputService.JOB_TYPE)) continue;
            try {
                store.transition(s, SessionStatus.FAILED, "system", "Processing stopped unexpectedly", "Processing stopped unexpectedly (the server may have restarted).",
                        "PROCESSING_STOPPED", "Press Retry to generate again.");
                fixed++;
            } catch (MeetingAssistantException conflict) {
                log.debug("Recovery skipped a meeting that changed concurrently");
            }
        }
        List<MeetingSession> extracting = mongo.find(new Query(Criteria.where("actionsStatus").is("RUNNING").and("updatedAt").lt(cutoff)).limit(BATCH), MeetingSession.class);
        for (MeetingSession s : extracting) {
            if (liveJob(s.getOrganizationId(), s.getId(), MeetingActionService.JOB_TYPE)) continue;
            mongo.updateFirst(new Query(Criteria.where("_id").is(s.getId()).and("actionsStatus").is("RUNNING")),
                    new Update().set("actionsStatus", "FAILED").set("actionsMessage", "Action extraction stopped unexpectedly. Try again.").set("updatedAt", Instant.now()), MeetingSession.class);
            store.audit(s.getOrganizationId(), s.getId(), "system", "EXTRACTION_RECOVERED", null);
            fixed++;
        }
        if (fixed > 0) log.warn("Meeting recovery repaired {} stranded item(s)", fixed);
        return fixed;
    }

    /** Removes finished jobs (30 days), old audit events (audit-retention-days) and settled batch/extraction history (the org's generated-content retention). */
    public int purgeOperational(ToIntFunction<String> generatedRetentionDaysForOrg) {
        int n = 0;
        n += (int) mongo.remove(new Query(Criteria.where("status").in("SUCCEEDED", "FAILED", "CANCELLED").and("updatedAt").lt(Instant.now().minus(30, ChronoUnit.DAYS))), MeetingJob.class).getDeletedCount();
        n += (int) mongo.remove(new Query(Criteria.where("at").lt(Instant.now().minus(Math.max(30, auditRetentionDays), ChronoUnit.DAYS))), MeetingAuditEvent.class).getDeletedCount();
        java.util.Map<String, Integer> cache = new java.util.HashMap<>();
        for (MeetingCreationBatch b : mongo.find(new Query(Criteria.where("createdAt").lt(Instant.now().minus(1, ChronoUnit.DAYS))).limit(BATCH), MeetingCreationBatch.class)) {
            int days = cache.computeIfAbsent(b.getOrganizationId(), generatedRetentionDaysForOrg::applyAsInt);
            if (b.getCreatedAt().isBefore(Instant.now().minus(days, ChronoUnit.DAYS))) { mongo.remove(b); n++; }
        }
        for (MeetingExtraction x : mongo.find(new Query(Criteria.where("status").ne("PENDING_REVIEW").and("createdAt").lt(Instant.now().minus(1, ChronoUnit.DAYS))).limit(BATCH), MeetingExtraction.class)) {
            int days = cache.computeIfAbsent(x.getOrganizationId(), generatedRetentionDaysForOrg::applyAsInt);
            if (x.getCreatedAt().isBefore(Instant.now().minus(days, ChronoUnit.DAYS))) { mongo.remove(x); n++; }
        }
        return n;
    }
}

package com.prowosma.backend.service;

import com.prowosma.backend.model.MeetingJob;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.FindAndModifyOptions;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * MongoDB-backed job queue — no extra infrastructure. A job is claimed with one atomic findAndModify that sets a
 * lease, so two instances can never run the same job at once, and a job whose worker died (lease expired) is
 * simply claimed again. All operations use explicit organization ids; nothing depends on a request.
 */
@Service
@RequiredArgsConstructor
public class MeetingJobService {

    static final Duration LEASE = Duration.ofMinutes(5);

    private final MongoTemplate mongo;

    public static String keyOf(String type, String sessionId) { return type + ":" + sessionId; }

    public MeetingJob enqueue(String org, String sessionId, String type, String requestedBy, Instant runAfter, Instant deadline) {
        return enqueue(org, sessionId, type, requestedBy, runAfter, deadline, null, 400);
    }

    /** Idempotent: an already queued/running job is returned untouched; a finished one is re-armed. */
    public MeetingJob enqueue(String org, String sessionId, String type, String requestedBy, Instant runAfter, Instant deadline,
                              String payload, int maxAttempts) {
        String key = keyOf(type, sessionId);
        for (int attempt = 0; attempt < 2; attempt++) {
            MeetingJob existing = mongo.findOne(new Query(Criteria.where("jobKey").is(key)), MeetingJob.class);
            if (existing != null) {
                if ("QUEUED".equals(existing.getStatus()) || "RUNNING".equals(existing.getStatus())) {
                    if ("QUEUED".equals(existing.getStatus()) && runAfter.isBefore(existing.getRunAfter())) {
                        mongo.updateFirst(new Query(Criteria.where("id").is(existing.getId()).and("status").is("QUEUED")),
                                new Update().set("runAfter", runAfter).set("updatedAt", Instant.now()), MeetingJob.class);
                        existing.setRunAfter(runAfter);
                    }
                    return existing;
                }
                existing.setStatus("QUEUED");
                existing.setRequestedBy(requestedBy);
                existing.setRunAfter(runAfter);
                existing.setDeadline(deadline);
                existing.setPayload(payload);
                existing.setMaxAttempts(maxAttempts);
                existing.setAttempts(0);
                existing.setErrorStreak(0);
                existing.setLastCode(null);
                existing.setLeaseUntil(null);
                existing.setLockedBy(null);
                existing.setUpdatedAt(Instant.now());
                return mongo.save(existing);
            }
            MeetingJob j = new MeetingJob();
            j.setOrganizationId(org);
            j.setSessionId(sessionId);
            j.setType(type);
            j.setJobKey(key);
            j.setRequestedBy(requestedBy);
            j.setRunAfter(runAfter);
            j.setDeadline(deadline);
            j.setPayload(payload);
            j.setMaxAttempts(maxAttempts);
            try {
                return mongo.insert(j);
            } catch (DuplicateKeyException race) {
                // another request created it first — loop once and return that one
            }
        }
        return mongo.findOne(new Query(Criteria.where("jobKey").is(key)), MeetingJob.class);
    }

    /** Atomically claims the next due job (or one whose lease expired), or returns null. */
    public MeetingJob claimNext(String workerId) {
        Instant now = Instant.now();
        Criteria due = new Criteria().orOperator(
                Criteria.where("status").is("QUEUED").and("runAfter").lte(now),
                Criteria.where("status").is("RUNNING").and("leaseUntil").lt(now));
        Update u = new Update().set("status", "RUNNING").set("lockedBy", workerId)
                .set("leaseUntil", now.plus(LEASE)).set("updatedAt", now).inc("attempts", 1);
        return mongo.findAndModify(new Query(due).with(Sort.by(Sort.Direction.ASC, "runAfter")).limit(1),
                u, FindAndModifyOptions.options().returnNew(true), MeetingJob.class);
    }

    public Optional<MeetingJob> find(String org, String sessionId, String type) {
        return Optional.ofNullable(mongo.findOne(new Query(Criteria.where("organizationId").is(org)
                .and("jobKey").is(keyOf(type, sessionId))), MeetingJob.class));
    }

    /** Long jobs (several model calls) call this between steps so another worker doesn't take over a healthy run. */
    public void extendLease(MeetingJob j) {
        mongo.updateFirst(new Query(Criteria.where("id").is(j.getId()).and("status").is("RUNNING")),
                new Update().set("leaseUntil", Instant.now().plus(LEASE)).set("updatedAt", Instant.now()), MeetingJob.class);
    }

    public void succeed(MeetingJob j) { finish(j, "SUCCEEDED", null); }

    public void failJob(MeetingJob j, String code) { finish(j, "FAILED", code); }

    private void finish(MeetingJob j, String status, String code) {
        mongo.updateFirst(new Query(Criteria.where("id").is(j.getId())),
                new Update().set("status", status).set("lastCode", code).set("leaseUntil", null).set("lockedBy", null)
                        .set("updatedAt", Instant.now()), MeetingJob.class);
    }

    public void reschedule(MeetingJob j, Instant at, String code, boolean error) {
        Update u = new Update().set("status", "QUEUED").set("runAfter", at).set("lastCode", code)
                .set("leaseUntil", null).set("lockedBy", null).set("updatedAt", Instant.now())
                .set("errorStreak", error ? j.getErrorStreak() + 1 : 0);
        mongo.updateFirst(new Query(Criteria.where("id").is(j.getId())), u, MeetingJob.class);
    }

    /** Stops pending work for a meeting (cancelled, or a transcript arrived another way). A running job re-checks the session itself. */
    public void cancelForSession(String org, String sessionId) {
        mongo.updateMulti(new Query(Criteria.where("organizationId").is(org).and("sessionId").is(sessionId).and("status").is("QUEUED")),
                new Update().set("status", "CANCELLED").set("updatedAt", Instant.now()), MeetingJob.class);
    }

    public List<MeetingJob> forSession(String org, String sessionId) {
        return mongo.find(new Query(Criteria.where("organizationId").is(org).and("sessionId").is(sessionId)), MeetingJob.class);
    }
}

package com.prowosma.backend.uma.core;

import com.prowosma.backend.uma.model.UmaJob;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.FindAndModifyOptions;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * MongoDB job queue for the Universal Meeting Assistant (same design as the existing assistant's queue, its own collection).
 * A job is claimed with one atomic findAndModify that sets a lease: two instances never run the same job, and a job whose
 * worker died is claimed again when the lease expires. A job that keeps failing ends as DEAD (the dead-letter state) and
 * its meeting shows what went wrong and how to retry.
 */
@Component
public class UmaJobQueue {
    public static final Duration LEASE = Duration.ofMinutes(10);
    private final MongoTemplate mongo;

    public UmaJobQueue(MongoTemplate mongo) { this.mongo = mongo; }

    public static String keyOf(String type, String meetingId) { return type + ":" + meetingId; }

    /** Idempotent: a live job of the same type for the same meeting is returned as it is; a finished one is re-armed. */
    public UmaJob enqueue(String org, String meetingId, String type, String requestedBy) {
        String key = keyOf(type, meetingId);
        for (int attempt = 0; attempt < 3; attempt++) {
            UmaJob existing = mongo.findOne(new Query(Criteria.where("jobKey").is(key)), UmaJob.class);
            if (existing != null) {
                if ("QUEUED".equals(existing.getStatus()) || "RUNNING".equals(existing.getStatus())) return existing;
                Update u = new Update().set("status", "QUEUED").set("attempts", 0).set("runAfter", Instant.now())
                        .set("requestedBy", requestedBy).set("updatedAt", Instant.now()).unset("lastCode").unset("leaseUntil").unset("lockedBy");
                mongo.updateFirst(new Query(Criteria.where("_id").is(existing.getId()).and("status").is(existing.getStatus())), u, UmaJob.class);
                return mongo.findById(existing.getId(), UmaJob.class);
            }
            UmaJob j = new UmaJob();
            j.setOrganizationId(org); j.setMeetingId(meetingId); j.setType(type); j.setJobKey(key); j.setRequestedBy(requestedBy);
            try { return mongo.insert(j); } catch (DuplicateKeyException race) { /* someone else inserted it: loop and reuse */ }
        }
        throw new IllegalStateException("Could not enqueue " + key);
    }

    /** Like {@link #enqueue} but not before {@code at}. */
    public UmaJob enqueueAt(String org, String meetingId, String type, String requestedBy, Instant at) {
        UmaJob j = enqueue(org, meetingId, type, requestedBy);
        mongo.updateFirst(new Query(Criteria.where("_id").is(j.getId()).and("status").is("QUEUED")),
                new Update().set("runAfter", at), UmaJob.class);
        return j;
    }

    /** Waiting for something outside (e.g. a notetaker's transcript): check again later without using up an attempt. */
    public void pollAgain(UmaJob j, java.time.Duration after) {
        mongo.updateFirst(new Query(Criteria.where("_id").is(j.getId()).and("lockedBy").is(j.getLockedBy())),
                new Update().set("status", "QUEUED").set("runAfter", Instant.now().plus(after)).inc("attempts", -1)
                        .unset("leaseUntil").unset("lockedBy").set("updatedAt", Instant.now()), UmaJob.class);
    }

    /** Claims the next job that is due (or whose worker's lease expired). */
    public Optional<UmaJob> claimNext(String workerId) {
        Instant now = Instant.now();
        Criteria due = new Criteria().orOperator(
                Criteria.where("status").is("QUEUED").and("runAfter").lte(now),
                Criteria.where("status").is("RUNNING").and("leaseUntil").lt(now));
        Update u = new Update().set("status", "RUNNING").set("lockedBy", workerId).set("leaseUntil", now.plus(LEASE))
                .inc("attempts", 1).set("updatedAt", now);
        return Optional.ofNullable(mongo.findAndModify(new Query(due).with(Sort.by("runAfter")).limit(1), u,
                FindAndModifyOptions.options().returnNew(true), UmaJob.class));
    }

    public void succeed(UmaJob j) { finish(j, "SUCCEEDED", null); }

    public void dead(UmaJob j, String code) { finish(j, "DEAD", code); }

    public void cancel(String org, String meetingId) {
        mongo.updateMulti(new Query(Criteria.where("organizationId").is(org).and("meetingId").is(meetingId).and("status").in("QUEUED", "RUNNING")),
                new Update().set("status", "CANCELLED").set("updatedAt", Instant.now()), UmaJob.class);
    }

    /** Try again later with exponential backoff (30 s, 1 min, 2 min, …, capped at 15 min). */
    public void retryLater(UmaJob j, String code) {
        long delay = Math.min(900, 30L * (1L << Math.max(0, Math.min(5, j.getAttempts() - 1))));
        mongo.updateFirst(new Query(Criteria.where("_id").is(j.getId()).and("lockedBy").is(j.getLockedBy())),
                new Update().set("status", "QUEUED").set("runAfter", Instant.now().plusSeconds(delay)).set("lastCode", code)
                        .unset("leaseUntil").unset("lockedBy").set("updatedAt", Instant.now()), UmaJob.class);
    }

    public void extendLease(UmaJob j) {
        mongo.updateFirst(new Query(Criteria.where("_id").is(j.getId()).and("lockedBy").is(j.getLockedBy())),
                new Update().set("leaseUntil", Instant.now().plus(LEASE)), UmaJob.class);
    }

    public List<UmaJob> forMeeting(String org, String meetingId) {
        return mongo.find(new Query(Criteria.where("organizationId").is(org).and("meetingId").is(meetingId)), UmaJob.class);
    }

    private void finish(UmaJob j, String status, String code) {
        Update u = new Update().set("status", status).set("updatedAt", Instant.now()).unset("leaseUntil");
        if (code != null) u.set("lastCode", code);
        mongo.updateFirst(new Query(Criteria.where("_id").is(j.getId()).and("lockedBy").is(j.getLockedBy())), u, UmaJob.class);
    }
}

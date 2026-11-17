package com.prowosma.backend.uma.core;

import com.prowosma.backend.uma.model.*;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * All reads and writes of the Universal Meeting Assistant's collections. Every query names the workspace explicitly,
 * so nothing here can return another workspace's data whatever the caller passes.
 */
@Component
public class UmaStore {
    private final MongoTemplate mongo;

    public UmaStore(MongoTemplate mongo) { this.mongo = mongo; }

    private static Query org(String org) { return new Query(Criteria.where("organizationId").is(org)); }

    // ── meetings ──────────────────────────────────────────────────────────
    public Optional<UmaMeeting> meeting(String org, String id) {
        if (org == null || id == null) return Optional.empty();
        return Optional.ofNullable(mongo.findOne(new Query(Criteria.where("organizationId").is(org).and("_id").is(id)), UmaMeeting.class));
    }

    public List<UmaMeeting> meetings(String org, int limit) {
        return mongo.find(org(org).with(Sort.by(Sort.Direction.DESC, "createdAt")).limit(limit), UmaMeeting.class);
    }

    public UmaMeeting save(UmaMeeting m) {
        m.setUpdatedAt(Instant.now());
        return mongo.save(m);
    }

    /**
     * Moves a meeting to a new state, only if the move is allowed from its CURRENT state (re-read from the database, so
     * two workers can't both move it). Returns the updated meeting, or throws CONFLICT.
     */
    public UmaMeeting transition(String org, String id, UmaStatus to, String by, String detail, String note) {
        for (int attempt = 0; attempt < 3; attempt++) {
            UmaMeeting m = meeting(org, id).orElseThrow(UmaException::notFound);
            UmaStatus from = m.getStatus();
            if (from == to && to != UmaStatus.ANALYZING) { m.setStatusDetail(detail); return save(m); }
            if (!from.canMoveTo(to))
                throw new UmaException(HttpStatus.CONFLICT, "INVALID_STATE",
                        "This meeting is " + from.label().toLowerCase() + " and can't do that right now.");
            Query guarded = new Query(Criteria.where("organizationId").is(org).and("_id").is(id).and("status").is(from));
            UmaMeeting.Transition t = new UmaMeeting.Transition();
            t.setFrom(from); t.setTo(to); t.setBy(by); t.setNote(note);
            org.springframework.data.mongodb.core.query.Update u = new org.springframework.data.mongodb.core.query.Update()
                    .set("status", to).set("statusDetail", detail).set("updatedAt", Instant.now()).push("history", t);
            if (to != UmaStatus.FAILED) u.unset("errorCode").unset("recoveryHint");
            if (mongo.updateFirst(guarded, u, UmaMeeting.class).getModifiedCount() == 1)
                return meeting(org, id).orElseThrow();
        }
        throw new UmaException(HttpStatus.CONFLICT, "BUSY", "This meeting changed while we were updating it. Try again.");
    }

    public void deleteMeeting(String org, String id) {
        Query byMeeting = new Query(Criteria.where("organizationId").is(org).and("meetingId").is(id));
        mongo.remove(byMeeting, UmaSegment.class);
        mongo.remove(new Query(Criteria.where("organizationId").is(org).and("_id").is(id)), UmaInsights.class);
        mongo.remove(byMeeting, UmaQuestion.class);
        mongo.remove(byMeeting, UmaJob.class);
        mongo.remove(new Query(Criteria.where("organizationId").is(org).and("_id").is(id)), UmaMeeting.class);
    }

    // ── transcript ────────────────────────────────────────────────────────
    public List<UmaSegment> segments(String org, String meetingId) {
        return mongo.find(new Query(Criteria.where("organizationId").is(org).and("meetingId").is(meetingId))
                .with(Sort.by("seq")), UmaSegment.class);
    }

    /** Replaces the whole transcript (idempotent: running a transcription twice leaves one copy). */
    public void replaceSegments(String org, String meetingId, List<UmaSegment> segments) {
        mongo.remove(new Query(Criteria.where("organizationId").is(org).and("meetingId").is(meetingId)), UmaSegment.class);
        if (!segments.isEmpty()) mongo.insertAll(segments);
    }

    public void appendSegments(List<UmaSegment> segments) { if (!segments.isEmpty()) mongo.insertAll(segments); }

    public void removeSegmentsFrom(String org, String meetingId, int fromSeq) {
        mongo.remove(new Query(Criteria.where("organizationId").is(org).and("meetingId").is(meetingId).and("seq").gte(fromSeq)), UmaSegment.class);
    }

    public Optional<UmaSegment> segment(String org, String meetingId, int seq) {
        return Optional.ofNullable(mongo.findOne(new Query(Criteria.where("organizationId").is(org).and("meetingId").is(meetingId).and("seq").is(seq)), UmaSegment.class));
    }

    public UmaSegment saveSegment(UmaSegment s) { return mongo.save(s); }

    // ── insights ──────────────────────────────────────────────────────────
    public Optional<UmaInsights> insights(String org, String meetingId) {
        return Optional.ofNullable(mongo.findOne(new Query(Criteria.where("organizationId").is(org).and("_id").is(meetingId)), UmaInsights.class));
    }

    public UmaInsights saveInsights(UmaInsights i) { return mongo.save(i); }

    // ── questions / audit ─────────────────────────────────────────────────
    public UmaQuestion saveQuestion(UmaQuestion q) { return mongo.save(q); }

    public List<UmaQuestion> questions(String org, String meetingId) {
        return mongo.find(new Query(Criteria.where("organizationId").is(org).and("meetingId").is(meetingId))
                .with(Sort.by(Sort.Direction.DESC, "at")).limit(50), UmaQuestion.class);
    }

    public void audit(String org, String meetingId, String actor, String action, String detail) {
        UmaAuditEvent e = new UmaAuditEvent();
        e.setOrganizationId(org); e.setMeetingId(meetingId); e.setActor(actor); e.setAction(action); e.setDetail(detail);
        mongo.insert(e);
    }

    public List<UmaAuditEvent> auditTrail(String org, String meetingId) {
        return mongo.find(new Query(Criteria.where("organizationId").is(org).and("meetingId").is(meetingId))
                .with(Sort.by(Sort.Direction.DESC, "at")).limit(200), UmaAuditEvent.class);
    }
}

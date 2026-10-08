package com.prowosma.backend.service;

import com.prowosma.backend.meetingassistant.SessionStatus;
import com.prowosma.backend.model.MeetingAuditEvent;
import com.prowosma.backend.model.MeetingSession;
import com.prowosma.backend.repository.MeetingSessionRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Optional;

/**
 * Session persistence and the ONLY place a session's status changes. Every method takes an explicit
 * organization — nothing here reads the request-scoped workspace — so request handlers and background
 * jobs share one implementation of the state machine and the audit trail.
 */
@Service
@RequiredArgsConstructor
public class MeetingSessionStore {

    private final MeetingSessionRepository sessions;
    private final MongoTemplate mongo;

    /** Remembers what the latest check found. A targeted update: it never changes the meeting's status or version. */
    public void recordCheck(String org, String sessionId, String code, String message, java.util.Map<String, Object> facts) {
        mongo.updateFirst(new org.springframework.data.mongodb.core.query.Query(Criteria.where("_id").is(sessionId).and("organizationId").is(org)),
                new org.springframework.data.mongodb.core.query.Update().set("lastCheckAt", java.time.Instant.now()).set("lastCheckCode", code)
                        .set("lastCheckMessage", message).set("lastCheckFacts", facts == null ? java.util.Map.of() : facts), MeetingSession.class);
    }

    public void recordCheck(String org, String sessionId, com.prowosma.backend.meetingassistant.GoogleCheckReport.Report r) {
        recordCheck(org, sessionId, r.code(), r.message(), r.facts());
    }

    public Optional<MeetingSession> find(String org, String id) {
        if (org == null || id == null) return Optional.empty();
        return sessions.findById(id).filter(s -> org.equals(s.getOrganizationId()));
    }

    public MeetingSession save(MeetingSession s) {
        try {
            return sessions.save(s);
        } catch (OptimisticLockingFailureException e) {
            throw new MeetingAssistantException(HttpStatus.CONFLICT, "CONFLICT",
                    "This meeting was just updated by someone else. Refresh and try again.");
        }
    }

    public static String occurrenceToken(Instant scheduledFor) {
        return scheduledFor == null ? "NOW" : scheduledFor.truncatedTo(ChronoUnit.MINUTES).toString();
    }

    public static String activeKeyOf(String org, String provider, String meetingKey, Instant scheduledFor) {
        return org + "|" + provider + "|" + meetingKey + "|" + occurrenceToken(scheduledFor);
    }

    public static String detailFor(SessionStatus st) {
        return switch (st) {
            case SCHEDULED -> "Registered. Live joining isn't available; the transcript is added after the meeting.";
            case AWAITING_TRANSCRIPT -> "Waiting for a transcript. Upload or paste one, or connect Google to import it automatically.";
            case TRANSCRIPT_RECEIVED -> "Transcript received. Summaries and minutes aren't generated yet.";
            case PROCESSING -> "Processing the transcript.";
            case READY_FOR_REVIEW -> "Ready for your review.";
            case COMPLETED -> "Completed.";
            case CANCELLED -> "Cancelled.";
            case FAILED -> "Something went wrong.";
            default -> st.name();
        };
    }

    /**
     * Moves a session along the state machine, frees the active key when it becomes terminal, appends to the
     * history and writes an audit event. {@code detail} overrides the default plain-language status line.
     */
    public MeetingSession transition(MeetingSession s, SessionStatus to, String by, String note,
                                     String detail, String failureCode, String recovery) {
        SessionStatus from = SessionStatus.valueOf(s.getStatus());
        if (!from.canTransitionTo(to)) {
            throw new MeetingAssistantException(HttpStatus.CONFLICT, "INVALID_STATE",
                    "This meeting can't change from " + from + " to " + to + ".");
        }
        s.setStatus(to.name());
        s.setStatusDetail(detail != null ? detail : detailFor(to));
        s.setFailureCode(to == SessionStatus.FAILED ? failureCode : null);
        s.setRecoveryAction(to == SessionStatus.FAILED ? recovery : null);
        if (to.isTerminal()) {
            s.setActiveKey(null);
            s.setEndedAt(Instant.now());
        }
        s.setUpdatedAt(Instant.now());
        addHistory(s, from.name(), to.name(), by, note);
        MeetingSession saved = save(s);
        audit(saved.getOrganizationId(), saved.getId(), by, "STATUS_CHANGED", from + " -> " + to);
        return saved;
    }

    public static void addHistory(MeetingSession s, String from, String to, String by, String note) {
        MeetingSession.StatusEvent e = new MeetingSession.StatusEvent();
        e.setFrom(from);
        e.setTo(to);
        e.setBy(by);
        e.setNote(note);
        s.getHistory().add(e);
    }

    /** Never put transcript text, tokens or meeting passcodes in {@code detail}. */
    public void audit(String org, String sessionId, String actor, String action, String detail) {
        MeetingAuditEvent e = new MeetingAuditEvent();
        e.setOrganizationId(org);
        e.setSessionId(sessionId);
        e.setActor(actor == null ? "system" : actor);
        e.setAction(action);
        e.setDetail(detail);
        mongo.insert(e);
    }
}

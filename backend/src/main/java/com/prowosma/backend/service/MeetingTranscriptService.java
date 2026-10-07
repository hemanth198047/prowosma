package com.prowosma.backend.service;

import com.prowosma.backend.meetingassistant.SessionStatus;
import com.prowosma.backend.meetingassistant.TranscriptParser;
import com.prowosma.backend.model.MeetingSession;
import com.prowosma.backend.model.TranscriptSegment;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;

/**
 * Stores and reads transcripts. All queries carry an explicit organization + session, and replacement is
 * generation-based: the new text is written completely BEFORE the session points at it, and the old text is
 * removed only afterwards — a crash or conflict in between never leaves a half-written transcript visible.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class MeetingTranscriptService {

    private static final Set<SessionStatus> ACCEPTS_TRANSCRIPT = EnumSet.of(
            SessionStatus.SCHEDULED, SessionStatus.AWAITING_TRANSCRIPT, SessionStatus.TRANSCRIPT_RECEIVED, SessionStatus.FAILED,
            SessionStatus.READY_FOR_REVIEW);
    private static final int WRITE_BATCH = 1000;

    private final MongoTemplate mongo;
    private final MeetingSessionStore store;

    public TranscriptParser.Parsed parse(String content, String format) {
        try {
            return TranscriptParser.parse(content, format);
        } catch (TranscriptParser.TranscriptFormatException e) {
            throw new MeetingAssistantException(HttpStatus.BAD_REQUEST, e.getCode(), e.getMessage());
        }
    }

    public static List<TranscriptSegment> fromParsed(TranscriptParser.Parsed parsed, String source) {
        List<TranscriptSegment> out = new ArrayList<>(parsed.segments().size());
        for (TranscriptParser.Segment p : parsed.segments()) {
            TranscriptSegment t = new TranscriptSegment();
            t.setStartMs(p.startMs());
            t.setEndMs(p.endMs());
            t.setSpeakerLabel(p.speaker());
            t.setText(p.text());
            t.setSource(source);
            out.add(t);
        }
        return out;
    }

    /** Stores a new transcript generation and moves the session to TRANSCRIPT_RECEIVED. */
    public MeetingSession receive(MeetingSession s, List<TranscriptSegment> segments, String source,
                                  String captureStatus, String note, String by, String statusDetail) {
        SessionStatus from = SessionStatus.valueOf(s.getStatus());
        if (!ACCEPTS_TRANSCRIPT.contains(from)) {
            throw new MeetingAssistantException(HttpStatus.CONFLICT, "TRANSCRIPT_LOCKED",
                    "A transcript can't be added or replaced once the meeting is being processed, or when it is finished or cancelled.");
        }
        if (segments.isEmpty()) {
            throw new MeetingAssistantException(HttpStatus.BAD_REQUEST, "NO_SEGMENTS", "There is no spoken text to store.");
        }
        final String org = s.getOrganizationId();
        final int generation = s.getTranscriptGeneration() + 1;
        int seq = 0;
        for (TranscriptSegment t : segments) {
            t.setOrganizationId(org);
            t.setSessionId(s.getId());
            t.setGeneration(generation);
            t.setSeq(++seq);
        }
        try {
            for (int i = 0; i < segments.size(); i += WRITE_BATCH) {
                mongo.insert(segments.subList(i, Math.min(segments.size(), i + WRITE_BATCH)), TranscriptSegment.class);
            }
            s.setTranscriptGeneration(generation);
            s.setSegmentCount(segments.size());
            s.setTranscriptSource(source);
            s.setTranscriptReceivedAt(Instant.now());
            s.setTranscriptReceivedBy(by);
            s.setTranscriptNote(note);
            s.setTranscriptPurgedAt(null);
            s.setCaptureStatus(captureStatus);
            MeetingSession saved;
            if (from == SessionStatus.TRANSCRIPT_RECEIVED) {
                s.setStatusDetail(statusDetail);
                s.setUpdatedAt(Instant.now());
                MeetingSessionStore.addHistory(s, from.name(), from.name(), by, "Transcript replaced (" + source + ")");
                saved = store.save(s);
                store.audit(org, s.getId(), by, "TRANSCRIPT_REPLACED", source + ", " + segments.size() + " lines");
            } else {
                if (from == SessionStatus.FAILED) {   // a failed meeting is rescued by a transcript: take the active slot back
                    s.setActiveKey(MeetingSessionStore.activeKeyOf(org, s.getProvider(), s.getMeetingKey(), s.getScheduledFor()));
                }
                saved = store.transition(s, SessionStatus.TRANSCRIPT_RECEIVED, by, "Transcript received (" + source + ")",
                        statusDetail, null, null);
                store.audit(org, s.getId(), by, "TRANSCRIPT_RECEIVED", source + ", " + segments.size() + " lines");
            }
            removeGenerations(org, s.getId(), generation, true);
            return saved;
        } catch (DuplicateKeyException dup) {
            removeGenerations(org, s.getId(), generation, false);
            throw new MeetingAssistantException(HttpStatus.CONFLICT, "DUPLICATE_SESSION",
                    "The assistant is already assigned to this meeting occurrence.");
        } catch (RuntimeException e) {
            removeGenerations(org, s.getId(), generation, false);   // never leave an orphan generation
            throw e;
        }
    }

    private void removeGenerations(String org, String sessionId, int generation, boolean olderThan) {
        Criteria c = Criteria.where("organizationId").is(org).and("sessionId").is(sessionId);
        c = olderThan ? c.and("generation").lt(generation) : c.and("generation").is(generation);
        mongo.remove(new Query(c), TranscriptSegment.class);
    }

    /** One page of the CURRENT generation, in order. */
    public List<Map<String, Object>> page(MeetingSession s, int afterSeq, int limit) {
        if (s.getTranscriptGeneration() <= 0 || s.getTranscriptPurgedAt() != null) return List.of();
        int n = Math.max(1, Math.min(limit, 500));
        Query q = new Query(Criteria.where("organizationId").is(s.getOrganizationId())
                .and("sessionId").is(s.getId())
                .and("generation").is(s.getTranscriptGeneration())
                .and("seq").gt(Math.max(0, afterSeq)))
                .with(Sort.by(Sort.Direction.ASC, "seq")).limit(n);
        List<Map<String, Object>> out = new ArrayList<>();
        for (TranscriptSegment t : mongo.find(q, TranscriptSegment.class)) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("seq", t.getSeq());
            m.put("startMs", t.getStartMs());
            m.put("endMs", t.getEndMs());
            m.put("speaker", t.getSpeakerLabel());          // null = unknown speaker
            m.put("text", t.getText());
            m.put("languageCode", t.getLanguageCode());
            out.add(m);
        }
        return out;
    }

    /** Removes the text and returns the session to "waiting" if it had only just received it. */
    public MeetingSession delete(MeetingSession s, String by) {
        final String org = s.getOrganizationId();
        mongo.remove(new Query(Criteria.where("organizationId").is(org).and("sessionId").is(s.getId())), TranscriptSegment.class);
        s.setSegmentCount(0);
        s.setTranscriptSource(null);
        s.setTranscriptReceivedAt(null);
        s.setTranscriptReceivedBy(null);
        s.setConferenceRecord(null);
        s.setCaptureStatus("NONE");
        s.setTranscriptNote("The transcript was deleted by " + by + ".");
        s.setTranscriptGeneration(s.getTranscriptGeneration() + 1);   // keep generations monotonic
        MeetingSession saved;
        if (SessionStatus.valueOf(s.getStatus()) == SessionStatus.TRANSCRIPT_RECEIVED) {
            saved = store.transition(s, SessionStatus.AWAITING_TRANSCRIPT, by, "Transcript deleted", null, null, null);
        } else {
            s.setUpdatedAt(Instant.now());
            saved = store.save(s);
        }
        store.audit(org, s.getId(), by, "TRANSCRIPT_DELETED", null);
        return saved;
    }

    /**
     * Retention: removes transcript TEXT once it is older than the organization's configured days. The meeting
     * record and its history stay, with a note explaining what happened. Idempotent, safe on every instance.
     */
    public int purgeExpired(java.util.function.ToIntFunction<String> retentionDaysForOrg) {
        Instant oldestPossible = Instant.now().minus(1, ChronoUnit.DAYS);
        Query q = new Query(Criteria.where("transcriptGeneration").gt(0)
                .and("transcriptPurgedAt").isNull()
                .and("transcriptReceivedAt").lt(oldestPossible)).limit(500);
        int purged = 0;
        Map<String, Integer> cache = new HashMap<>();
        for (MeetingSession s : mongo.find(q, MeetingSession.class)) {
            int days = cache.computeIfAbsent(s.getOrganizationId(), retentionDaysForOrg::applyAsInt);
            if (s.getTranscriptReceivedAt().isAfter(Instant.now().minus(days, ChronoUnit.DAYS))) continue;
            mongo.remove(new Query(Criteria.where("organizationId").is(s.getOrganizationId()).and("sessionId").is(s.getId())),
                    TranscriptSegment.class);
            s.setSegmentCount(0);
            s.setTranscriptPurgedAt(Instant.now());
            s.setTranscriptNote("The transcript text was removed after " + days + " days under your retention policy.");
            s.setUpdatedAt(Instant.now());
            try {
                store.save(s);
                store.audit(s.getOrganizationId(), s.getId(), "system", "TRANSCRIPT_PURGED", "retention " + days + " days");
                purged++;
            } catch (MeetingAssistantException conflict) {
                log.debug("Retention purge skipped a session that changed concurrently");
            }
        }
        return purged;
    }
}

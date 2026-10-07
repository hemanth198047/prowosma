package com.prowosma.backend.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.integration.LlmClient;
import com.prowosma.backend.integration.LlmException;
import com.prowosma.backend.meetingassistant.*;
import com.prowosma.backend.meetingassistant.TranscriptChunker.Line;
import com.prowosma.backend.model.*;
import com.prowosma.backend.repository.MeetingAssistantSettingsRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.FindAndModifyOptions;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import java.util.*;

/**
 * Summary / Minutes of Meeting / Notes generation and their versioned documents.
 *
 * Guarantees: every statement carries validated transcript evidence (unsupported ones are removed, never kept);
 * long meetings are split into parts, never truncated; a regenerated version waits for review instead of replacing
 * what a person has; every document keeps all its versions; token usage is recorded per run. Everything here takes
 * an explicit organization, so it runs the same in a request and in a background job.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class MeetingOutputService {

    public static final String JOB_TYPE = "GENERATE_MEETING_OUTPUTS";
    public static final List<String> TYPES = List.of("SUMMARY", "MOM", "NOTES");
    static final int MAX_DOC_CHARS = 200_000;
    private static final int MAX_SPLIT_DEPTH = 4;

    private final MongoTemplate mongo;
    private final MeetingSessionStore store;
    private final MeetingJobService jobs;
    private final LlmClient llm;
    private final MeetingAssistantSettingsRepository settingsRepo;
    private final ObjectMapper om = new ObjectMapper();

    @Value("${app.meeting-assistant.ai-single-pass-chars:90000}") private int singlePassChars;
    @Value("${app.meeting-assistant.ai-chunk-chars:60000}") private int chunkChars;
    @Value("${app.meeting-assistant.ai-max-output-tokens:8000}") private int maxOutputTokens;
    @Value("${app.meeting-assistant.ai-max-generations-per-hour:20}") private int maxPerHour;

    /** Raised internally when the model's answer was cut off at its output limit. */
    private static final class Truncated extends RuntimeException {
        Truncated() { super("truncated", null, false, false); }
    }

    /** Running totals for one generation. */
    private static final class Usage {
        long in, out; int calls, chunks, dropped; String provider, model;
        final List<String> warnings = new ArrayList<>();
        void add(LlmClient.Result r) { in += r.inputTokens(); out += r.outputTokens(); calls++; provider = r.provider(); model = r.model(); }
    }

    // ── starting a run ────────────────────────────────────────────────────────

    public boolean rateLimited(String org) {
        long n = mongo.count(new Query(Criteria.where("organizationId").is(org).and("createdAt").gte(Instant.now().minus(1, ChronoUnit.HOURS))),
                MeetingGeneration.class);
        long queued = mongo.count(new Query(Criteria.where("organizationId").is(org).and("type").is(JOB_TYPE)
                .and("status").in("QUEUED", "RUNNING").and("createdAt").gte(Instant.now().minus(1, ChronoUnit.HOURS))), MeetingJob.class);
        return n + queued >= maxPerHour;
    }

    /** Moves the meeting to PROCESSING and queues the run. The caller has already checked permissions and state. */
    public MeetingSession start(MeetingSession s, String by) {
        final String org = s.getOrganizationId();
        if (s.getStatus().equals(SessionStatus.FAILED.name())) {
            s.setActiveKey(MeetingSessionStore.activeKeyOf(org, s.getProvider(), s.getMeetingKey(), s.getScheduledFor()));
        }
        MeetingSession saved = store.transition(s, SessionStatus.PROCESSING, by, "Generating summary, minutes and notes",
                "Generating the summary, minutes and notes…", null, null);
        jobs.enqueue(org, saved.getId(), JOB_TYPE, by, Instant.now(), Instant.now().plus(2, ChronoUnit.HOURS),
                UUID.randomUUID().toString(), 6);
        store.audit(org, saved.getId(), by, "GENERATION_REQUESTED", null);
        return saved;
    }

    /** Automatic start after a transcript arrives — only when the organization allows it, AI is ready and the hourly limit isn't hit. */
    public MeetingSession startIfEnabled(MeetingSession s, String by) {
        try {
            if (!SessionStatus.TRANSCRIPT_RECEIVED.name().equals(s.getStatus())) return s;
            MeetingAssistantSettings st = settingsRepo.findByOrganizationId(s.getOrganizationId()).orElse(null);
            boolean auto = st == null || st.isAutoGenerateOutputs();
            if (!auto || !llm.isReady(s.getOrganizationId()) || rateLimited(s.getOrganizationId())) return s;
            return start(s, by);
        } catch (MeetingAssistantException | org.springframework.dao.DataAccessException e) {
            log.warn("Automatic generation not started: {}", e.getClass().getSimpleName());
            return s;
        }
    }

    /** The status line shown once a transcript is stored and processing has not started on its own. */
    public String receivedDetail(String org, int lines) {
        return "Transcript received (" + lines + " lines). " + hint(org);
    }

    public String hint(String org) {
        if (!llm.isReady(org)) return "Summaries and minutes aren't generated yet because AI isn't set up.";
        return "Press Generate to create the summary, minutes and notes.";
    }

    // ── the run ───────────────────────────────────────────────────────────────

    public record Outcome(int dropped, List<String> warnings) {}

    /** Produces all three documents from the CURRENT transcript. Throws LlmException on provider/format failures. */
    public Outcome generate(MeetingJob job, MeetingSession s, String requestId, Runnable heartbeat) {
        final String org = s.getOrganizationId();
        MeetingGeneration prior = requestId == null ? null : mongo.findOne(new Query(Criteria.where("organizationId").is(org)
                .and("requestId").is(requestId).and("status").is("SUCCEEDED")), MeetingGeneration.class);
        if (prior != null) return new Outcome(prior.getDropped(), prior.getWarnings());   // a crashed worker already finished this run

        long t0 = System.currentTimeMillis();
        Usage u = new Usage();
        String error = null;
        Map<String, Object> analysis = null;
        List<Line> lines = loadLines(s);
        try {
            if (lines.isEmpty()) throw new LlmException(LlmException.Kind.BAD_RESPONSE, "This meeting has no transcript text to summarise.");
            int maxSeq = lines.get(lines.size() - 1).seq();
            analysis = TranscriptChunker.totalChars(lines) <= singlePassChars
                    ? analyseWholeOrSplit(org, s, lines, u, heartbeat)
                    : analyseParts(org, s, TranscriptChunker.chunk(lines, chunkChars), lines, maxSeq, u, heartbeat);
        } catch (RuntimeException e) {
            error = e instanceof LlmException le ? le.getKind().name() : "ERROR";
            throw e;
        } finally {
            if (error != null) record(null, org, s, requestId, "FAILED", error, u, t0, null, job.getRequestedBy());   // tokens spent are still counted
        }

        MeetingRenderer.Meta meta = meta(s, lines);
        Map<String, String> docs = new LinkedHashMap<>();
        docs.put("SUMMARY", MeetingRenderer.summary(analysis, meta));
        docs.put("MOM", MeetingRenderer.mom(analysis, meta));
        docs.put("NOTES", MeetingRenderer.notes(analysis, meta));

        // Documents first, the SUCCEEDED record last: if a worker dies in between, the retry regenerates (at worst a spare
        // pending version) instead of a "succeeded" record hiding missing documents.
        String genId = new org.bson.types.ObjectId().toHexString();
        for (Map.Entry<String, String> d : docs.entrySet()) {
            saveVersion(org, s.getId(), d.getKey(), d.getValue(), "AI", genId, s.getTranscriptGeneration(), null, "system", null, true);
        }
        record(genId, org, s, requestId, "SUCCEEDED", null, u, t0, analysis, job.getRequestedBy());
        return new Outcome(u.dropped, u.warnings);
    }

    private Map<String, Object> analyseWholeOrSplit(String org, MeetingSession s, List<Line> lines, Usage u, Runnable hb) {
        return analyseLines(org, s, lines, 1, 0, u, hb);     // halves the lines itself if the answer is cut off
    }

    private Map<String, Object> analyseParts(String org, MeetingSession s, List<TranscriptChunker.Chunk> chunks, List<Line> all,
                                             int maxSeq, Usage u, Runnable hb) {
        u.chunks = chunks.size();
        List<Map<String, Object>> partials = new ArrayList<>();
        int total = chunks.size();
        for (TranscriptChunker.Chunk c : chunks) {
            List<Line> part = all.stream().filter(l -> l.seq() >= c.fromSeq() && l.seq() <= c.toSeq()).toList();
            partials.add(analyseLines(org, s, part, total, c.index(), u, hb));
        }
        return merge(org, partials, maxSeq, u, hb);
    }

    /** One analysis call for a run of lines, with a single repair retry for unparseable replies and halving on truncation. */
    private Map<String, Object> analyseLines(String org, MeetingSession s, List<Line> lines, int parts, int index, Usage u, Runnable hb) {
        StringBuilder text = new StringBuilder();
        for (Line l : lines) text.append(TranscriptChunker.render(l)).append('\n');
        String user = PromptBuilder.userForTranscript(cleanTitle(s), text.toString(), index, parts);
        int min = lines.get(0).seq(), max = lines.get(lines.size() - 1).seq();
        try {
            return callAndSanitize(org, PromptBuilder.system(language(org)), user, min, max, u, hb);
        } catch (Truncated t) {
            if (lines.size() < 2) throw new LlmException(LlmException.Kind.BAD_RESPONSE, "The AI's answer was too long even for a single line.");
            return splitAndMerge(org, s, lines, parts, index, u, hb, 1);
        }
    }

    private Map<String, Object> splitAndMerge(String org, MeetingSession s, List<Line> lines, int parts, int index, Usage u, Runnable hb, int depth) {
        if (depth > MAX_SPLIT_DEPTH) throw new LlmException(LlmException.Kind.BAD_RESPONSE, "The AI's answers were too long to use.");
        List<Map<String, Object>> halves = new ArrayList<>();
        for (List<Line> half : TranscriptChunker.halve(lines)) {
            if (half.isEmpty()) continue;
            StringBuilder text = new StringBuilder();
            for (Line l : half) text.append(TranscriptChunker.render(l)).append('\n');
            String user = PromptBuilder.userForTranscript(cleanTitle(s), text.toString(), index, Math.max(parts, 2));
            try {
                halves.add(callAndSanitize(org, PromptBuilder.system(language(org)), user, half.get(0).seq(), half.get(half.size() - 1).seq(), u, hb));
            } catch (Truncated t) {
                if (half.size() < 2) throw new LlmException(LlmException.Kind.BAD_RESPONSE, "The AI's answer was too long even for a single line.");
                halves.add(splitAndMerge(org, s, half, parts, index, u, hb, depth + 1));
            }
        }
        u.warnings.add("Some long parts were analysed in smaller pieces; duplicates across pieces may remain.");
        return OutputSanitizer.concat(halves);
    }

    private Map<String, Object> callAndSanitize(String org, String system, String user, int min, int max, Usage u, Runnable hb) {
        Map<String, Object> raw = null;
        for (int attempt = 0; attempt < 2 && raw == null; attempt++) {
            hb.run();
            LlmClient.Result r = llm.complete(org, system, attempt == 0 ? user : user + "\n\n" + PromptBuilder.repair(), maxOutputTokens);
            u.add(r);
            if (r.truncated()) throw new Truncated();
            raw = parse(r.text());
        }
        if (raw == null) throw new LlmException(LlmException.Kind.BAD_RESPONSE, "The AI's reply wasn't in the expected format, even after a retry.");
        OutputSanitizer.Result sr = OutputSanitizer.sanitize(raw, min, max);
        u.dropped += sr.dropped();
        for (String w : sr.warnings()) if (!u.warnings.contains(w)) u.warnings.add(w);
        return sr.data();
    }

    /** Combines the analyses of consecutive parts, asking the model to de-duplicate; falls back to plain joining, never to dropping. */
    private Map<String, Object> merge(String org, List<Map<String, Object>> partials, int maxSeq, Usage u, Runnable hb) {
        List<Map<String, Object>> cur = partials;
        while (cur.size() > 1) {
            List<List<Map<String, Object>>> groups = new ArrayList<>();
            List<Map<String, Object>> g = new ArrayList<>();
            int size = 0;
            for (Map<String, Object> p : cur) {
                int n = json(p).length();
                if (!g.isEmpty() && size + n > singlePassChars) { groups.add(g); g = new ArrayList<>(); size = 0; }
                g.add(p); size += n;
            }
            groups.add(g);
            if (groups.size() == cur.size()) break;                 // nothing could be combined within the budget
            List<Map<String, Object>> next = new ArrayList<>();
            for (List<Map<String, Object>> group : groups) {
                if (group.size() == 1) { next.add(group.get(0)); continue; }
                try {
                    List<String> jsons = new ArrayList<>();
                    for (Map<String, Object> p : group) jsons.add(json(p));
                    next.add(callAndSanitize(org, PromptBuilder.system(language(org)), PromptBuilder.userForMerge(jsons), 1, maxSeq, u, hb));
                } catch (Truncated | LlmException e) {
                    if (e instanceof LlmException le && le.getKind() != LlmException.Kind.BAD_RESPONSE
                            && le.getKind() != LlmException.Kind.INPUT_TOO_LARGE) throw le;    // config, auth and outage problems must surface (and retry)
                    u.warnings.add("Parts of this long meeting were combined without removing duplicates.");
                    next.add(OutputSanitizer.concat(group));
                }
            }
            cur = next;
        }
        return cur.size() == 1 ? cur.get(0) : OutputSanitizer.concat(cur);
    }

    private String json(Map<String, Object> m) {
        try {
            return om.writeValueAsString(m);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> parse(String text) {
        String j = ModelJson.extract(text);
        if (j == null) return null;
        try {
            return om.readValue(j, Map.class);
        } catch (Exception e) {
            return null;
        }
    }

    private String language(String org) {
        return settingsRepo.findByOrganizationId(org).map(MeetingAssistantSettings::getOutputLanguage).orElse("en");
    }

    private static String cleanTitle(MeetingSession s) {
        String t = s.getTitle() == null ? "Meeting" : s.getTitle();
        return t.startsWith("[SIMULATED] ") ? t.substring(12) : t;
    }

    private MeetingRenderer.Meta meta(MeetingSession s, List<Line> lines) {
        ZoneId zone;
        try { zone = ZoneId.of(s.getTimezone() == null ? "UTC" : s.getTimezone()); } catch (RuntimeException e) { zone = ZoneId.of("UTC"); }
        Instant anchor = s.getStartedAt() != null ? s.getStartedAt() : s.getScheduledFor() != null ? s.getScheduledFor() : s.getCreatedAt();
        ZonedDateTime z = anchor.atZone(zone);
        long lastMs = 0;
        for (Line l : lines) lastMs = Math.max(lastMs, l.startMs() == null ? 0 : l.startMs());
        String duration = lastMs >= 60_000 ? "about " + Math.round(lastMs / 60000.0) + " min (from transcript timestamps)" : "Not recorded";
        LinkedHashSet<String> names = new LinkedHashSet<>();
        for (Line l : lines) if (l.speaker() != null && !l.speaker().isBlank() && names.size() < 50) names.add(l.speaker());
        return new MeetingRenderer.Meta(cleanTitle(s), z.toLocalDate().toString(), z.toLocalTime().withSecond(0).withNano(0).toString(),
                zone.getId(), duration, new ArrayList<>(names));
    }

    List<Line> loadLines(MeetingSession s) {
        Query q = new Query(Criteria.where("organizationId").is(s.getOrganizationId()).and("sessionId").is(s.getId())
                .and("generation").is(s.getTranscriptGeneration())).with(Sort.by(Sort.Direction.ASC, "seq"));
        List<Line> out = new ArrayList<>();
        for (TranscriptSegment t : mongo.find(q, TranscriptSegment.class)) out.add(new Line(t.getSeq(), t.getStartMs(), t.getSpeakerLabel(), t.getText()));
        return out;
    }

    private String record(String id, String org, MeetingSession s, String requestId, String status, String error, Usage u, long t0,
                          Map<String, Object> analysis, String by) {
        MeetingGeneration g = new MeetingGeneration();
        if (id != null) g.setId(id);
        g.setOrganizationId(org);
        g.setSessionId(s.getId());
        g.setRequestId(requestId);
        g.setTranscriptGeneration(s.getTranscriptGeneration());
        g.setStatus(status);
        g.setErrorCode(error);
        g.setProvider(u.provider);
        g.setModel(u.model);
        g.setInputTokens(u.in);
        g.setOutputTokens(u.out);
        g.setCalls(u.calls);
        g.setChunks(u.chunks);
        g.setDurationMs(System.currentTimeMillis() - t0);
        g.setDropped(u.dropped);
        g.setWarnings(new ArrayList<>(u.warnings));
        g.setAnalysis(analysis);
        g.setRequestedBy(by);
        try {
            return mongo.insert(g).getId();
        } catch (DuplicateKeyException dup) {
            return Optional.ofNullable(mongo.findOne(new Query(Criteria.where("organizationId").is(org).and("requestId").is(requestId)
                    .and("status").is(status)), MeetingGeneration.class)).map(MeetingGeneration::getId).orElse(null);
        }
    }

    // ── documents & versions ─────────────────────────────────────────────────

    private Query headQuery(String org, String sessionId, String type) {
        return new Query(Criteria.where("organizationId").is(org).and("sessionId").is(sessionId).and("type").is(type));
    }

    private int nextVersion(String org, String sessionId, String type) {
        MeetingArtifactHead h = mongo.findAndModify(headQuery(org, sessionId, type), new Update().inc("nextVersion", 1),
                FindAndModifyOptions.options().upsert(true).returnNew(true), MeetingArtifactHead.class);
        return h.getNextVersion();
    }

    /**
     * Adds a version. For a first-ever AI version it becomes current; a later AI version becomes PENDING (never replacing
     * what a person has); edits and restores become current directly, guarded by the version they were based on.
     */
    private MeetingArtifact saveVersion(String org, String sessionId, String type, String markdown, String source, String generationId,
                                        int transcriptGeneration, Integer parentVersion, String by, String note, boolean ai) {
        int v = nextVersion(org, sessionId, type);
        MeetingArtifact a = new MeetingArtifact();
        a.setOrganizationId(org);
        a.setSessionId(sessionId);
        a.setType(type);
        a.setVersion(v);
        a.setSource(source);
        a.setMarkdown(markdown);
        a.setGenerationId(generationId);
        a.setTranscriptGeneration(transcriptGeneration);
        a.setParentVersion(parentVersion);
        a.setCreatedBy(by);
        a.setNote(note);
        mongo.insert(a);
        if (ai) {
            var first = mongo.updateFirst(headQuery(org, sessionId, type).addCriteria(Criteria.where("currentVersion").isNull()),
                    new Update().set("currentVersion", v), MeetingArtifactHead.class);
            if (first.getModifiedCount() == 0) {
                mongo.updateFirst(headQuery(org, sessionId, type), new Update().set("pendingVersion", v), MeetingArtifactHead.class);
            }
        } else {
            var cas = mongo.updateFirst(headQuery(org, sessionId, type).addCriteria(Criteria.where("currentVersion").is(parentVersion)),
                    new Update().set("currentVersion", v), MeetingArtifactHead.class);
            if (cas.getModifiedCount() == 0) {
                mongo.remove(new Query(Criteria.where("_id").is(a.getId())), MeetingArtifact.class);
                throw conflict(org, sessionId, type);
            }
        }
        return a;
    }

    private MeetingAssistantException conflict(String org, String sessionId, String type) {
        MeetingArtifactHead h = mongo.findOne(headQuery(org, sessionId, type), MeetingArtifactHead.class);
        Map<String, Object> extras = new LinkedHashMap<>();
        extras.put("currentVersion", h == null ? null : h.getCurrentVersion());
        return new MeetingAssistantException(HttpStatus.CONFLICT, "VERSION_CONFLICT",
                "Someone else changed this document since you opened it. Reload to see their version.", extras);
    }

    private static String type(String raw) {
        String t = raw == null ? "" : raw.trim().toUpperCase(Locale.ROOT);
        if (!TYPES.contains(t)) throw new MeetingAssistantException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Unknown document type.");
        return t;
    }

    private MeetingArtifact artifact(String org, String sessionId, String type, int version) {
        MeetingArtifact a = mongo.findOne(new Query(Criteria.where("organizationId").is(org).and("sessionId").is(sessionId)
                .and("type").is(type).and("version").is(version)), MeetingArtifact.class);
        if (a == null) throw new MeetingAssistantException(HttpStatus.NOT_FOUND, "NOT_FOUND", "That version wasn't found.");
        return a;
    }

    private Map<String, Object> meta(MeetingArtifact a, boolean withText) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("version", a.getVersion());
        m.put("source", a.getSource());
        m.put("createdBy", a.getCreatedBy());
        m.put("createdAt", a.getCreatedAt() == null ? null : a.getCreatedAt().toString());
        m.put("parentVersion", a.getParentVersion());
        m.put("transcriptGeneration", a.getTranscriptGeneration());
        if (withText) m.put("markdown", a.getMarkdown());
        return m;
    }

    /** All three documents with their current and pending versions. {@code stale} = the transcript changed after it was generated. */
    public Map<String, Object> artifacts(MeetingSession s) {
        final String org = s.getOrganizationId();
        Map<String, Object> out = new LinkedHashMap<>();
        for (String t : TYPES) {
            MeetingArtifactHead h = mongo.findOne(headQuery(org, s.getId(), t), MeetingArtifactHead.class);
            Map<String, Object> d = new LinkedHashMap<>();
            if (h == null || h.getCurrentVersion() == null) {
                out.put(t, null);
                continue;
            }
            MeetingArtifact cur = artifact(org, s.getId(), t, h.getCurrentVersion());
            d.put("current", meta(cur, true));
            d.put("stale", cur.getTranscriptGeneration() != s.getTranscriptGeneration());
            if (h.getPendingVersion() != null) {
                MeetingArtifact p = mongo.findOne(new Query(Criteria.where("organizationId").is(org).and("sessionId").is(s.getId())
                        .and("type").is(t).and("version").is(h.getPendingVersion())), MeetingArtifact.class);
                d.put("pending", p == null ? null : meta(p, true));
            } else {
                d.put("pending", null);
            }
            d.put("versionCount", h.getNextVersion());
            out.put(t, d);
        }
        return out;
    }

    public List<Map<String, Object>> versions(MeetingSession s, String typeRaw) {
        String t = type(typeRaw);
        List<Map<String, Object>> out = new ArrayList<>();
        for (MeetingArtifact a : mongo.find(new Query(Criteria.where("organizationId").is(s.getOrganizationId()).and("sessionId").is(s.getId())
                .and("type").is(t)).with(Sort.by(Sort.Direction.DESC, "version")), MeetingArtifact.class)) out.add(meta(a, false));
        return out;
    }

    public Map<String, Object> version(MeetingSession s, String typeRaw, int n) {
        return meta(artifact(s.getOrganizationId(), s.getId(), type(typeRaw), n), true);
    }

    public Map<String, Object> edit(MeetingSession s, String typeRaw, int baseVersion, String markdown, String by) {
        String t = type(typeRaw);
        if (markdown == null || markdown.isBlank())
            throw new MeetingAssistantException(HttpStatus.BAD_REQUEST, "EMPTY_DOCUMENT", "The document can't be empty.");
        if (markdown.length() > MAX_DOC_CHARS)
            throw new MeetingAssistantException(HttpStatus.PAYLOAD_TOO_LARGE, "DOCUMENT_TOO_LARGE", "The document is too large.");
        String clean = markdown.replace("\r\n", "\n").replaceAll("[\\p{Cntrl}&&[^\n\t]]", "");
        MeetingArtifactHead h = mongo.findOne(headQuery(s.getOrganizationId(), s.getId(), t), MeetingArtifactHead.class);
        if (h == null || h.getCurrentVersion() == null)
            throw new MeetingAssistantException(HttpStatus.NOT_FOUND, "NOT_FOUND", "There is nothing to edit yet.");
        if (h.getCurrentVersion() != baseVersion) throw conflict(s.getOrganizationId(), s.getId(), t);
        MeetingArtifact a = saveVersion(s.getOrganizationId(), s.getId(), t, clean, "USER_EDIT", null, s.getTranscriptGeneration(), baseVersion, by, null, false);
        store.audit(s.getOrganizationId(), s.getId(), by, "DOCUMENT_EDITED", t + " v" + a.getVersion());
        return meta(a, true);
    }

    public Map<String, Object> restore(MeetingSession s, String typeRaw, int fromVersion, String by) {
        String t = type(typeRaw);
        MeetingArtifact src = artifact(s.getOrganizationId(), s.getId(), t, fromVersion);
        MeetingArtifactHead h = mongo.findOne(headQuery(s.getOrganizationId(), s.getId(), t), MeetingArtifactHead.class);
        if (h == null || h.getCurrentVersion() == null)
            throw new MeetingAssistantException(HttpStatus.NOT_FOUND, "NOT_FOUND", "There is nothing to restore into.");
        MeetingArtifact a = saveVersion(s.getOrganizationId(), s.getId(), t, src.getMarkdown(), "RESTORE", null, src.getTranscriptGeneration(),
                h.getCurrentVersion(), by, "Restored from version " + fromVersion, false);
        store.audit(s.getOrganizationId(), s.getId(), by, "DOCUMENT_RESTORED", t + " v" + fromVersion + " -> v" + a.getVersion());
        return meta(a, true);
    }

    public void acceptPending(MeetingSession s, String typeRaw, String by) {
        String t = type(typeRaw);
        MeetingArtifactHead h = mongo.findOne(headQuery(s.getOrganizationId(), s.getId(), t), MeetingArtifactHead.class);
        if (h == null || h.getPendingVersion() == null)
            throw new MeetingAssistantException(HttpStatus.CONFLICT, "NO_PENDING", "There is no regenerated version waiting for review.");
        var r = mongo.updateFirst(headQuery(s.getOrganizationId(), s.getId(), t).addCriteria(Criteria.where("pendingVersion").is(h.getPendingVersion())),
                new Update().set("currentVersion", h.getPendingVersion()).unset("pendingVersion"), MeetingArtifactHead.class);
        if (r.getModifiedCount() == 0) throw conflict(s.getOrganizationId(), s.getId(), t);
        store.audit(s.getOrganizationId(), s.getId(), by, "PENDING_ACCEPTED", t + " v" + h.getPendingVersion());
    }

    public void dismissPending(MeetingSession s, String typeRaw, String by) {
        String t = type(typeRaw);
        mongo.updateFirst(headQuery(s.getOrganizationId(), s.getId(), t), new Update().unset("pendingVersion"), MeetingArtifactHead.class);
        store.audit(s.getOrganizationId(), s.getId(), by, "PENDING_DISMISSED", t);
    }

    public List<Map<String, Object>> diff(MeetingSession s, String typeRaw, int from, int to) {
        String t = type(typeRaw);
        List<Map<String, Object>> out = new ArrayList<>();
        for (LineDiff.Op op : LineDiff.diff(artifact(s.getOrganizationId(), s.getId(), t, from).getMarkdown(),
                artifact(s.getOrganizationId(), s.getId(), t, to).getMarkdown())) {
            out.add(Map.of("t", String.valueOf(op.type()), "line", op.line()));
        }
        return out;
    }

    // ── cost & retention ─────────────────────────────────────────────────────

    /** Token usage for an organization over the last {@code days}. Tokens, not money: prices depend on the model you chose. */
    public Map<String, Object> usage(String org, int days) {
        int d = Math.max(1, Math.min(days, 365));
        List<MeetingGeneration> gens = mongo.find(new Query(Criteria.where("organizationId").is(org)
                .and("createdAt").gte(Instant.now().minus(d, ChronoUnit.DAYS))), MeetingGeneration.class);
        long in = 0, out = 0; int ok = 0, failed = 0, calls = 0;
        Set<String> meetings = new HashSet<>();
        TreeMap<String, long[]> byDay = new TreeMap<>();
        for (MeetingGeneration g : gens) {
            in += g.getInputTokens(); out += g.getOutputTokens(); calls += g.getCalls();
            if ("SUCCEEDED".equals(g.getStatus())) ok++; else failed++;
            meetings.add(g.getSessionId());
            long[] a = byDay.computeIfAbsent(g.getCreatedAt().toString().substring(0, 10), k -> new long[3]);
            a[0] += g.getInputTokens(); a[1] += g.getOutputTokens(); a[2]++;
        }
        List<Map<String, Object>> days2 = new ArrayList<>();
        byDay.forEach((k, v) -> days2.add(Map.of("day", k, "inputTokens", v[0], "outputTokens", v[1], "runs", v[2])));
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("days", d);
        res.put("runs", gens.size());
        res.put("succeeded", ok);
        res.put("failed", failed);
        res.put("meetings", meetings.size());
        res.put("modelCalls", calls);
        res.put("inputTokens", in);
        res.put("outputTokens", out);
        res.put("byDay", days2);
        return res;
    }

    /** Removes generated documents (all versions) and run records older than the organization's configured days. Idempotent. */
    public int purgeExpired(java.util.function.ToIntFunction<String> retentionDaysForOrg) {
        Instant oldestPossible = Instant.now().minus(1, ChronoUnit.DAYS);
        Map<String, Integer> cache = new HashMap<>();
        int purged = 0;
        for (MeetingArtifact a : mongo.find(new Query(Criteria.where("createdAt").lt(oldestPossible)).limit(500), MeetingArtifact.class)) {
            int days = cache.computeIfAbsent(a.getOrganizationId(), retentionDaysForOrg::applyAsInt);
            if (a.getCreatedAt().isAfter(Instant.now().minus(days, ChronoUnit.DAYS))) continue;
            mongo.remove(new Query(Criteria.where("_id").is(a.getId())), MeetingArtifact.class);
            purged++;
        }
        for (MeetingGeneration g : mongo.find(new Query(Criteria.where("createdAt").lt(oldestPossible)).limit(500), MeetingGeneration.class)) {
            int days = cache.computeIfAbsent(g.getOrganizationId(), retentionDaysForOrg::applyAsInt);
            if (g.getCreatedAt().isAfter(Instant.now().minus(days, ChronoUnit.DAYS))) continue;
            mongo.remove(new Query(Criteria.where("_id").is(g.getId())), MeetingGeneration.class);
        }
        // heads whose documents are all gone
        for (MeetingArtifactHead h : mongo.find(new Query().limit(1000), MeetingArtifactHead.class)) {
            boolean any = mongo.exists(new Query(Criteria.where("organizationId").is(h.getOrganizationId()).and("sessionId").is(h.getSessionId())
                    .and("type").is(h.getType())), MeetingArtifact.class);
            if (!any) mongo.remove(new Query(Criteria.where("_id").is(h.getId())), MeetingArtifactHead.class);
        }
        return purged;
    }
}

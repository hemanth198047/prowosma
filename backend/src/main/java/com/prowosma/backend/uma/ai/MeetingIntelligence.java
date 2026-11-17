package com.prowosma.backend.uma.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.prowosma.backend.integration.LlmException;
import com.prowosma.backend.meetingassistant.ModelJson;
import com.prowosma.backend.meetingassistant.NameMatcher;
import com.prowosma.backend.meetingassistant.TranscriptChunker;
import com.prowosma.backend.repository.TeamMemberRepository;
import com.prowosma.backend.uma.core.UmaException;
import com.prowosma.backend.uma.core.UmaStore;
import com.prowosma.backend.uma.model.UmaInsights;
import com.prowosma.backend.uma.model.UmaMeeting;
import com.prowosma.backend.uma.model.UmaQuestion;
import com.prowosma.backend.uma.model.UmaSegment;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.*;
import java.util.function.IntConsumer;

/**
 * Turns a transcript into grounded meeting intelligence, and answers questions about it. Transcription, extraction and question
 * answering are separate calls with separate limits. Long transcripts are split (line numbers stay global) and merged — the
 * executive summary is summarised hierarchically. Output is parsed and validated by {@link InsightValidator}; nothing the model
 * says reaches a person without passing those checks.
 */
@Component
@Slf4j
public class MeetingIntelligence {
    private final UmaAi ai;
    private final UmaStore store;
    private final TeamMemberRepository members;
    private final ObjectMapper om = new ObjectMapper();

    @Value("${app.uma.ai.single-pass-chars:60000}") private int singlePassChars = 60000;
    @Value("${app.uma.ai.chunk-chars:40000}") private int chunkChars = 40000;
    @Value("${app.uma.ai.max-output-tokens:4000}") private int maxOutputTokens = 4000;
    @Value("${app.uma.ai.ask-context-chars:24000}") private int askContextChars = 24000;

    public MeetingIntelligence(UmaAi ai, UmaStore store, TeamMemberRepository members) {
        this.ai = ai; this.store = store; this.members = members;
    }

    void limits(int singlePass, int chunk) { this.singlePassChars = singlePass; this.chunkChars = chunk; }

    public String notReadyReason(String org) { return ai.notReadyReason(org); }

    // ── analysis ─────────────────────────────────────────────────────────

    public UmaInsights analyze(UmaMeeting m, IntConsumer heartbeat) {
        String org = m.getOrganizationId();
        String reason = ai.notReadyReason(org);
        if (reason != null) throw new UmaException(HttpStatus.FAILED_DEPENDENCY, "AI_NOT_READY", reason,
                "An admin can set up AI under AI Settings (or a self-hosted model on the server), then press Retry.");
        List<UmaSegment> segs = store.segments(org, m.getId());
        if (segs.isEmpty()) throw new UmaException(HttpStatus.UNPROCESSABLE_CONTENT, "NO_TRANSCRIPT", "This meeting has no transcript yet.",
                "Upload a recording or import a transcript.");

        List<TranscriptChunker.Line> lines = new ArrayList<>();
        Map<Integer, InsightValidator.Line> byseq = new HashMap<>();
        for (UmaSegment s : segs) {
            lines.add(new TranscriptChunker.Line(s.getSeq(), s.getStartMs(), s.getSpeaker(), s.getText()));
            byseq.put(s.getSeq(), new InsightValidator.Line(s.getSeq(), s.getSpeaker(), s.getText()));
        }
        LocalDate date = (m.getMeetingAt() == null ? Instant.now() : m.getMeetingAt())
                .atZone(zone(m.getTimezone())).toLocalDate();

        int[] tokens = {0, 0};
        String[] who = {null, null};
        List<JsonNode> parts = new ArrayList<>();
        List<List<TranscriptChunker.Line>> pieces = new ArrayList<>();
        if (TranscriptChunker.totalChars(lines) <= singlePassChars) pieces.add(lines);
        else for (TranscriptChunker.Chunk c : TranscriptChunker.chunk(lines, chunkChars))
            pieces.add(lines.stream().filter(l -> l.seq() >= c.fromSeq() && l.seq() <= c.toSeq()).toList());

        Deque<List<TranscriptChunker.Line>> work = new ArrayDeque<>(pieces);
        int total = pieces.size(), n = 0;
        while (!work.isEmpty()) {
            List<TranscriptChunker.Line> piece = work.pollFirst();
            heartbeat.accept(n);
            String text = render(piece);
            MeetingAiModel.Reply r = call(org, InsightPrompts.EXTRACT_SYSTEM,
                    InsightPrompts.extractUser(m.getTitle(), date.toString(), text, ++n, Math.max(total, n)), tokens, who);
            if (r.truncated() && piece.size() > 4) {                    // cut off at the model's limit: redo on halves
                List<List<TranscriptChunker.Line>> halves = TranscriptChunker.halve(piece);
                work.addFirst(halves.get(1)); work.addFirst(halves.get(0));
                total++;
                continue;
            }
            parts.add(parseOrRepair(org, r, InsightPrompts.EXTRACT_SYSTEM,
                    InsightPrompts.extractUser(m.getTitle(), date.toString(), text, n, Math.max(total, n)), tokens, who));
        }

        JsonNode merged = merge(parts);
        if (parts.size() > 1) {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < parts.size(); i++) sb.append("Part ").append(i + 1).append(": ").append(parts.get(i).path("summary").asText("")).append("\n");
            try {
                MeetingAiModel.Reply r = call(org, InsightPrompts.MERGE_SUMMARY_SYSTEM, sb.toString(), tokens, who);
                ((ObjectNode) merged).put("summary", r.text().strip());
            } catch (LlmException e) {
                log.info("uma: summary merge failed ({}), keeping the joined partial summaries", e.getKind());
            }
        }

        UmaInsights previous = store.insights(org, m.getId()).orElse(null);
        UmaInsights out = InsightValidator.validate(merged, byseq, date, directory(org), previous, m.getProjectId());
        out.setId(m.getId());
        out.setMeetingId(m.getId());
        out.setOrganizationId(org);
        out.setVersion(previous == null ? 1 : previous.getVersion() + 1);
        out.setGeneratedAt(Instant.now());
        out.setProvider(who[0]);
        out.setModel(who[1]);
        out.setInputTokens(tokens[0]);
        out.setOutputTokens(tokens[1]);
        if (pieces.size() > 1) out.getWarnings().add("This meeting was long, so it was analysed in " + pieces.size() + " parts.");
        return store.saveInsights(out);
    }

    private MeetingAiModel.Reply call(String org, String system, String user, int[] tokens, String[] who) {
        try {
            MeetingAiModel.Reply r = ai.complete(org, system, user, maxOutputTokens);
            tokens[0] += r.inputTokens(); tokens[1] += r.outputTokens();
            who[0] = r.provider(); who[1] = r.model();
            return r;
        } catch (LlmException e) {
            throw toUma(e);
        }
    }

    private JsonNode parseOrRepair(String org, MeetingAiModel.Reply r, String system, String user, int[] tokens, String[] who) {
        JsonNode parsed = parse(r.text());
        if (parsed != null) return parsed;
        MeetingAiModel.Reply again = call(org, system, user + "\n\n" + InsightPrompts.REPAIR, tokens, who);
        parsed = parse(again.text());
        if (parsed != null) return parsed;
        throw new UmaException(HttpStatus.BAD_GATEWAY, "AI_BAD_OUTPUT", "The AI model's answer couldn't be read, even after asking again.",
                "Press Retry. If it keeps failing, an admin can choose a stronger model in AI Settings.");
    }

    JsonNode parse(String text) {
        String json = ModelJson.extract(text);
        if (json == null) return null;
        try {
            JsonNode n = om.readTree(json);
            return n.isObject() ? n : null;
        } catch (Exception e) {
            return null;
        }
    }

    JsonNode merge(List<JsonNode> parts) {
        ObjectNode out = om.createObjectNode();
        out.put("summary", parts.isEmpty() ? "" : String.join(" ", parts.stream().map(p -> p.path("summary").asText("")).filter(s -> !s.isBlank()).toList()));
        for (String key : List.of("notes", "decisions", "actions", "risks", "questions", "followUps")) {
            ArrayNode arr = out.putArray(key);
            for (JsonNode p : parts) if (p.path(key).isArray()) p.path(key).forEach(arr::add);
        }
        return out;
    }

    // ── Ask AI ───────────────────────────────────────────────────────────

    public UmaQuestion ask(UmaMeeting m, String question, String askedBy) {
        String org = m.getOrganizationId();
        String q = question == null ? "" : question.strip();
        if (q.isEmpty()) throw new UmaException(HttpStatus.BAD_REQUEST, "EMPTY_QUESTION", "Type a question about this meeting.");
        if (q.length() > 500) throw new UmaException(HttpStatus.BAD_REQUEST, "QUESTION_TOO_LONG", "Keep the question under 500 characters.");
        String reason = ai.notReadyReason(org);
        if (reason != null) throw new UmaException(HttpStatus.FAILED_DEPENDENCY, "AI_NOT_READY", reason, "An admin can set up AI under AI Settings.");
        List<UmaSegment> segs = store.segments(org, m.getId());
        if (segs.isEmpty()) throw new UmaException(HttpStatus.UNPROCESSABLE_CONTENT, "NO_TRANSCRIPT", "This meeting has no transcript yet.");

        List<UmaSegment> context = relevant(segs, q, askContextChars);
        Set<Integer> allowed = new HashSet<>();
        for (UmaSegment s : context) allowed.add(s.getSeq());
        String text = render(context.stream().map(s -> new TranscriptChunker.Line(s.getSeq(), s.getStartMs(), s.getSpeaker(), s.getText())).toList());

        int[] tokens = {0, 0};
        String[] who = {null, null};
        MeetingAiModel.Reply r = call(org, InsightPrompts.ASK_SYSTEM, InsightPrompts.askUser(m.getTitle(), q, text), tokens, who);
        JsonNode j = parse(r.text());

        UmaQuestion out = new UmaQuestion();
        out.setOrganizationId(org); out.setMeetingId(m.getId()); out.setAskedBy(askedBy); out.setQuestion(q);
        out.setProvider(who[0]); out.setModel(who[1]); out.setInputTokens(tokens[0]); out.setOutputTokens(tokens[1]);
        List<Integer> ev = new ArrayList<>();
        if (j != null) j.path("evidence").forEach(e -> { if (e.canConvertToInt() && allowed.contains(e.asInt())) ev.add(e.asInt()); });
        boolean found = j != null && j.path("found").asBoolean(false);
        String answer = j == null ? null : j.path("answer").asText(null);
        if (found && !ev.isEmpty() && answer != null && !answer.isBlank()) {
            out.setAnswer(answer.strip()); out.setEvidence(ev.stream().distinct().sorted().toList()); out.setGrounded(true);
        } else {
            out.setAnswer("This meeting's transcript doesn't clearly answer that.");
            out.setGrounded(false);
        }
        return store.saveQuestion(out);
    }

    /** The lines most related to the question (word overlap), with one line of context either side, in order. */
    static List<UmaSegment> relevant(List<UmaSegment> segs, String question, int maxChars) {
        int all = 0;
        for (UmaSegment s : segs) all += s.getText().length() + 40;
        if (all <= maxChars) return segs;
        Set<String> qw = words(question);
        Map<Integer, Integer> score = new HashMap<>();
        for (int i = 0; i < segs.size(); i++) {
            Set<String> w = words(segs.get(i).getText() + " " + Objects.toString(segs.get(i).getSpeaker(), ""));
            int s = 0;
            for (String x : qw) if (w.contains(x)) s++;
            if (s > 0) score.put(i, s);
        }
        List<Integer> ranked = new ArrayList<>(score.keySet());
        ranked.sort((a, b) -> score.get(b) - score.get(a));
        TreeSet<Integer> pick = new TreeSet<>();
        int used = 0;
        for (int i : ranked) {
            for (int k = Math.max(0, i - 1); k <= Math.min(segs.size() - 1, i + 1); k++) {
                if (pick.add(k)) used += segs.get(k).getText().length() + 40;
            }
            if (used >= maxChars) break;
        }
        if (pick.isEmpty()) for (int i = 0; i < segs.size() && used < maxChars; i++) { pick.add(i); used += segs.get(i).getText().length() + 40; }
        List<UmaSegment> out = new ArrayList<>();
        for (int i : pick) out.add(segs.get(i));
        return out;
    }

    private static final Set<String> STOP = Set.of("the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are", "was", "were", "what", "who",
            "when", "did", "do", "we", "about", "this", "that", "it", "be", "with", "me", "my", "i", "you", "our", "us", "how", "why", "which");

    private static Set<String> words(String s) {
        Set<String> out = new HashSet<>();
        for (String w : s.toLowerCase(Locale.ROOT).split("[^\\p{L}\\p{N}]+")) {
            if (w.length() < 3 || STOP.contains(w)) continue;
            out.add(w.length() > 5 ? w.substring(0, 5) : w);               // crude stem: "deploy", "deployment" meet
        }
        return out;
    }

    // ── shared ───────────────────────────────────────────────────────────

    private static String render(List<TranscriptChunker.Line> lines) {
        StringBuilder sb = new StringBuilder();
        for (TranscriptChunker.Line l : lines) sb.append(TranscriptChunker.render(l)).append('\n');
        return sb.toString();
    }

    private List<NameMatcher.Person> directory(String org) {
        return members.findByOrganizationId(org).stream()
                .map(t -> new NameMatcher.Person(t.getId(), t.getName(), t.getEmail(), t.getRole())).toList();
    }

    private static ZoneId zone(String tz) {
        try { return tz == null || tz.isBlank() ? ZoneId.of("UTC") : ZoneId.of(tz); } catch (Exception e) { return ZoneId.of("UTC"); }
    }

    static UmaException toUma(LlmException e) {
        return switch (e.getKind()) {
            case NOT_CONFIGURED -> new UmaException(HttpStatus.FAILED_DEPENDENCY, "AI_NOT_READY", e.getMessage(), "An admin can set up AI under AI Settings, then press Retry.");
            case AUTH -> new UmaException(HttpStatus.BAD_GATEWAY, "AI_AUTH", e.getMessage(), "An admin needs to fix the AI key in AI Settings, then press Retry.");
            case INPUT_TOO_LARGE -> new UmaException(HttpStatus.BAD_GATEWAY, "AI_TOO_LONG", e.getMessage(), "An admin can lower app.uma.ai.chunk-chars, then press Retry.");
            case RATE_LIMITED, SERVER, NETWORK -> new UmaException(HttpStatus.SERVICE_UNAVAILABLE, "AI_UNAVAILABLE", e.getMessage(), "This usually passes. Press Retry in a few minutes.");
            default -> new UmaException(HttpStatus.BAD_GATEWAY, "AI_BAD_OUTPUT", e.getMessage(), "Press Retry.");
        };
    }
}

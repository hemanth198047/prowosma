package com.prowosma.backend.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.integration.LlmClient;
import com.prowosma.backend.integration.LlmException;
import com.prowosma.backend.meetingassistant.*;
import com.prowosma.backend.meetingassistant.ActionSanitizer.Item;
import com.prowosma.backend.meetingassistant.ActionSanitizer.Parsed;
import com.prowosma.backend.meetingassistant.ActionSanitizer.Proposal;
import com.prowosma.backend.meetingassistant.ActionSanitizer.Withdrawal;
import com.prowosma.backend.meetingassistant.NameMatcher.Person;
import com.prowosma.backend.meetingassistant.ProjectMatcher.Proj;
import com.prowosma.backend.meetingassistant.TranscriptChunker.Line;
import com.prowosma.backend.model.*;
import com.prowosma.backend.repository.MeetingAssistantSettingsRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.time.DateTimeException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.regex.Pattern;

/**
 * Structured action extraction and review.
 *
 * The model is asked only for what was SAID (titles, names and deadlines as spoken, cited transcript lines). Everything that decides
 * a person, a project or a date happens afterwards in code: owners are matched to the directory only on an exact, unique full name (a
 * first name is merely suggested), projects only to existing project names or the one selected, deadlines are resolved against the
 * meeting's date and timezone — and whatever can't be settled stays visibly unresolved for a person to pick. The directory is never
 * sent to the model. A re-run never overwrites reviewed work: it waits as a difference to apply or discard.
 *
 * Required fields (decision for this feature): a TASK needs a title and a project; a new PROJECT needs a name and a description.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class MeetingActionService {

    public static final String JOB_TYPE = "EXTRACT_MEETING_ACTIONS";
    private static final double DEDUPE = 0.7, WITHDRAW = 0.5, DIFF = 0.6, SUSPECT = 0.55;
    private static final int MAX_SPLIT_DEPTH = 4;
    private static final Pattern FIRST_PERSON = Pattern.compile("(?i)^(i|me|myself|i'll|i will|ill)$");
    private static final Set<String> TYPES = Set.of("TASK", "BUG", "FOLLOW_UP", "RESEARCH", "OTHER");
    private static final Set<String> KINDS = Set.of("COMMITMENT", "SUGGESTION", "UNRESOLVED");
    private static final Set<String> PRIORITIES = Set.of("LOW", "MEDIUM", "HIGH");

    private final MongoTemplate mongo;
    private final MeetingSessionStore store;
    private final MeetingJobService jobs;
    private final LlmClient llm;
    private final MeetingOutputService outputs;
    private final MeetingAssistantSettingsRepository settingsRepo;
    private final ObjectMapper om = new ObjectMapper();

    @Value("${app.meeting-assistant.ai-single-pass-chars:90000}") private int singlePassChars;
    @Value("${app.meeting-assistant.ai-chunk-chars:60000}") private int chunkChars;
    @Value("${app.meeting-assistant.ai-max-output-tokens:8000}") private int maxOutputTokens;

    private static final class Truncated extends RuntimeException {
        Truncated() { super("truncated", null, false, false); }
    }

    private static final class Usage {
        long in, out; int calls; String provider, model;
        void add(LlmClient.Result r) { in += r.inputTokens(); out += r.outputTokens(); calls++; provider = r.provider(); model = r.model(); }
    }

    public record RunOutcome(int actions, int proposals, boolean pendingReview, int dropped, List<String> warnings) {}

    private static MeetingAssistantException err(HttpStatus s, String code, String msg) { return new MeetingAssistantException(s, code, msg); }

    // ── starting ──────────────────────────────────────────────────────────────

    public MeetingSession enqueue(MeetingSession s, String by) {
        final String org = s.getOrganizationId();
        setSession(org, s.getId(), new Update().set("actionsStatus", "RUNNING").set("actionsMessage", null).set("updatedAt", Instant.now()));
        s.setActionsStatus("RUNNING");
        s.setActionsMessage(null);
        jobs.enqueue(org, s.getId(), JOB_TYPE, by, Instant.now(), Instant.now().plus(2, ChronoUnit.HOURS), UUID.randomUUID().toString(), 6);
        store.audit(org, s.getId(), by, "EXTRACTION_REQUESTED", null);
        return s;
    }

    /** Automatic start once the documents exist — same switch as automatic generation, and only when AI is ready and under the hourly limit. */
    public void startIfEnabled(MeetingSession s, String by) {
        try {
            MeetingAssistantSettings st = settingsRepo.findByOrganizationId(s.getOrganizationId()).orElse(null);
            if ((st != null && !st.isAutoExtractActions()) || !llm.isReady(s.getOrganizationId()) || outputs.rateLimited(s.getOrganizationId())) return;
            enqueue(s, by);
        } catch (RuntimeException e) {
            log.warn("Automatic action extraction not started: {}", e.getClass().getSimpleName());
        }
    }

    private void setSession(String org, String id, Update u) {
        mongo.updateFirst(new Query(Criteria.where("_id").is(id).and("organizationId").is(org)), u, MeetingSession.class);
    }

    public void markFailed(MeetingJob job, String code, String message, String recovery) {
        setSession(job.getOrganizationId(), job.getSessionId(), new Update().set("actionsStatus", "FAILED")
                .set("actionsMessage", message + (recovery == null ? "" : " " + recovery)).set("updatedAt", Instant.now()));
        store.audit(job.getOrganizationId(), job.getSessionId(), "system", "EXTRACTION_FAILED", code);
    }

    // ── the run ───────────────────────────────────────────────────────────────

    public RunOutcome run(MeetingJob job, MeetingSession s, String requestId, Runnable hb) {
        final String org = s.getOrganizationId();
        MeetingGeneration prior = requestId == null ? null : mongo.findOne(new Query(Criteria.where("organizationId").is(org)
                .and("requestId").is(requestId).and("status").is("SUCCEEDED")), MeetingGeneration.class);
        if (prior != null) return new RunOutcome(0, 0, false, prior.getDropped(), prior.getWarnings());

        long t0 = System.currentTimeMillis();
        Usage u = new Usage();
        String error = null;
        List<Line> lines = outputs.loadLines(s);
        Ctx ctx = context(s, lines);
        List<String> promptProjects = ctx.projects.stream().filter(p -> !"DONE".equalsIgnoreCase(p.status())).map(Proj::name).distinct().limit(200).toList();
        Parsed parsed;
        try {
            if (lines.isEmpty()) throw new LlmException(LlmException.Kind.BAD_RESPONSE, "This meeting has no transcript text to analyse.");
            parsed = extractAll(org, s, lines, promptProjects, u, hb);
        } catch (RuntimeException e) {
            error = e instanceof LlmException le ? le.getKind().name() : "ERROR";
            throw e;
        } finally {
            if (error != null) recordGeneration(org, s, requestId, "FAILED", error, u, t0, 0, List.of(), job.getRequestedBy());
        }

        List<Item> items = ActionMatcher.dedupe(parsed.actions(), DEDUPE);
        List<Withdrawal> unmatched = new ArrayList<>();
        boolean[] withdrawn = ActionMatcher.withdrawnFlags(items, parsed.withdrawn(), WITHDRAW, unmatched);
        List<Proposal> proposals = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (Proposal p : parsed.proposals()) if (seen.add(NameMatcher.norm(p.name()))) proposals.add(p);
        List<String> warnings = new ArrayList<>(parsed.warnings());
        if (!unmatched.isEmpty()) warnings.add(unmatched.size() + " withdrawn item(s) didn't match any action and were ignored.");

        RunOutcome out = ingest(s, ctx, requestId, items, withdrawn, proposals, warnings, parsed.dropped());
        recordGeneration(org, s, requestId, "SUCCEEDED", null, u, t0, parsed.dropped(), warnings, job.getRequestedBy());
        setSession(org, s.getId(), new Update().set("actionsStatus", "READY").set("actionsExtractedAt", Instant.now())
                .set("actionsMessage", out.pendingReview() ? "A re-run found changes waiting for your review." : null).set("updatedAt", Instant.now()));
        return out;
    }

    private Parsed extractAll(String org, MeetingSession s, List<Line> lines, List<String> projects, Usage u, Runnable hb) {
        List<Parsed> parts = new ArrayList<>();
        List<String> prior = new ArrayList<>();
        if (TranscriptChunker.totalChars(lines) <= singlePassChars) {
            parts.add(callPart(org, s, lines, 1, 0, projects, prior, 0, u, hb));
        } else {
            List<TranscriptChunker.Chunk> chunks = TranscriptChunker.chunk(lines, chunkChars);
            for (TranscriptChunker.Chunk c : chunks) {
                List<Line> part = lines.stream().filter(l -> l.seq() >= c.fromSeq() && l.seq() <= c.toSeq()).toList();
                Parsed p = callPart(org, s, part, chunks.size(), c.index(), projects, prior, 0, u, hb);
                parts.add(p);
                for (Item i : p.actions()) if (prior.size() < 200) prior.add(i.title());
            }
        }
        List<Item> actions = new ArrayList<>();
        List<Proposal> proposals = new ArrayList<>();
        List<Withdrawal> withdrawn = new ArrayList<>();
        List<String> warnings = new ArrayList<>();
        int dropped = 0;
        for (Parsed p : parts) {
            actions.addAll(p.actions());
            proposals.addAll(p.proposals());
            withdrawn.addAll(p.withdrawn());
            for (String w : p.warnings()) if (!warnings.contains(w)) warnings.add(w);
            dropped += p.dropped();
        }
        return new Parsed(actions, proposals, withdrawn, warnings, dropped);
    }

    private Parsed callPart(String org, MeetingSession s, List<Line> part, int parts, int index, List<String> projects, List<String> prior,
                            int depth, Usage u, Runnable hb) {
        StringBuilder text = new StringBuilder();
        for (Line l : part) text.append(TranscriptChunker.render(l)).append('\n');
        String user = PromptBuilder.actionsUser(cleanTitle(s), text.toString(), index, parts, projects, prior);
        int min = part.get(0).seq(), max = part.get(part.size() - 1).seq();
        try {
            Map<String, Object> raw = callParse(org, PromptBuilder.actionsSystem(language(org)), user, u, hb);
            return ActionSanitizer.sanitize(raw, min, max, projects);
        } catch (Truncated t) {
            if (part.size() < 2 || depth >= MAX_SPLIT_DEPTH) throw new LlmException(LlmException.Kind.BAD_RESPONSE, "The AI's answer was too long to use.");
            List<Parsed> halves = new ArrayList<>();
            List<String> priorCopy = new ArrayList<>(prior);
            for (List<Line> half : TranscriptChunker.halve(part)) {
                if (half.isEmpty()) continue;
                Parsed p = callPart(org, s, half, Math.max(parts, 2), index, projects, priorCopy, depth + 1, u, hb);
                halves.add(p);
                for (Item i : p.actions()) priorCopy.add(i.title());
            }
            List<Item> a = new ArrayList<>();
            List<Proposal> pr = new ArrayList<>();
            List<Withdrawal> w = new ArrayList<>();
            List<String> warn = new ArrayList<>();
            int d = 0;
            for (Parsed h : halves) { a.addAll(h.actions()); pr.addAll(h.proposals()); w.addAll(h.withdrawn()); warn.addAll(h.warnings()); d += h.dropped(); }
            return new Parsed(a, pr, w, warn, d);
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> callParse(String org, String system, String user, Usage u, Runnable hb) {
        for (int attempt = 0; attempt < 2; attempt++) {
            hb.run();
            LlmClient.Result r = llm.complete(org, system, attempt == 0 ? user : user + "\n\n" + PromptBuilder.repair(), maxOutputTokens);
            u.add(r);
            if (r.truncated()) throw new Truncated();
            String j = ModelJson.extract(r.text());
            if (j == null) continue;
            try {
                return om.readValue(j, Map.class);
            } catch (Exception e) {
                // fall through to the single repair attempt
            }
        }
        throw new LlmException(LlmException.Kind.BAD_RESPONSE, "The AI's reply wasn't in the expected format, even after a retry.");
    }

    private void recordGeneration(String org, MeetingSession s, String requestId, String status, String error, Usage u, long t0, int dropped,
                                  List<String> warnings, String by) {
        MeetingGeneration g = new MeetingGeneration();
        g.setKind("ACTIONS");
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
        g.setDurationMs(System.currentTimeMillis() - t0);
        g.setDropped(dropped);
        g.setWarnings(new ArrayList<>(warnings));
        g.setRequestedBy(by);
        try {
            mongo.insert(g);
        } catch (DuplicateKeyException ignored) { /* a retry of the same request already recorded it */ }
    }

    private String language(String org) {
        return settingsRepo.findByOrganizationId(org).map(MeetingAssistantSettings::getOutputLanguage).orElse("en");
    }

    private static String cleanTitle(MeetingSession s) {
        String t = s.getTitle() == null ? "Meeting" : s.getTitle();
        return t.startsWith("[SIMULATED] ") ? t.substring(12) : t;
    }

    // ── resolution context ────────────────────────────────────────────────────

    private static final class Ctx {
        String org, tz;
        List<Person> directory = new ArrayList<>();
        List<Proj> projects = new ArrayList<>();
        Proj selected;
        LocalDate meetingDate;
        Map<Integer, String> speakerBySeq = new HashMap<>();
        Set<String> approvedProposals = new HashSet<>();
    }

    private Ctx context(MeetingSession s, List<Line> lines) {
        Ctx c = new Ctx();
        c.org = s.getOrganizationId();
        for (TeamMember m : mongo.find(new Query(Criteria.where("organizationId").is(c.org)), TeamMember.class))
            if (m.getName() != null && !m.getName().isBlank()) c.directory.add(new Person(m.getId(), m.getName(), m.getEmail(), m.getRole()));
        for (Project p : mongo.find(new Query(Criteria.where("organizationId").is(c.org)), Project.class))
            if (p.getName() != null && !p.getName().isBlank()) c.projects.add(new Proj(p.getId(), p.getName(), p.getStatus()));
        if ("SELECTED".equals(s.getProjectMode()) && s.getProjectId() != null)
            c.selected = c.projects.stream().filter(p -> p.id().equals(s.getProjectId())).findFirst().orElse(null);
        ZoneId zone;
        try { zone = ZoneId.of(s.getTimezone() == null ? "UTC" : s.getTimezone()); } catch (DateTimeException e) { zone = ZoneId.of("UTC"); }
        c.tz = zone.getId();
        Instant anchor = s.getStartedAt() != null ? s.getStartedAt() : s.getScheduledFor() != null ? s.getScheduledFor() : s.getCreatedAt();
        c.meetingDate = anchor.atZone(zone).toLocalDate();
        for (Line l : lines) c.speakerBySeq.put(l.seq(), l.speaker());
        for (MeetingProposedProject p : proposals(c.org, s.getId())) if ("APPROVED".equals(p.getStatus())) c.approvedProposals.add(NameMatcher.norm(p.getName()));
        return c;
    }

    // ── building actions from validated items ────────────────────────────────

    private MeetingAction build(Ctx c, MeetingSession s, Item it, boolean withdrawn, String extractionId) {
        MeetingAction a = new MeetingAction();
        a.setOrganizationId(c.org);
        a.setSessionId(s.getId());
        a.setStableId(UUID.randomUUID().toString());
        a.setExtractionId(extractionId);
        a.setTitle(it.title());
        a.setDescription(it.description());
        a.setType(it.type());
        a.setKind(it.kind());
        a.setEvidence(new ArrayList<>(it.evidence()));
        a.setDependencies(new ArrayList<>(it.dependencies()));
        a.setAcceptanceCriteria(new ArrayList<>(it.acceptanceCriteria()));
        a.setTimezone(c.tz);

        // owner — deterministic, from the directory; first-person uses the label the SOURCE gave the speaker
        a.setOwnerIsSpeaker(it.ownerIsSpeaker());
        String spoken = it.owner();
        boolean firstPerson = it.ownerIsSpeaker() && (spoken == null || FIRST_PERSON.matcher(spoken.trim()).matches());
        NameMatcher.Match om2;
        if (firstPerson) {
            String label = null;
            for (int seq : it.evidence()) { String sp = c.speakerBySeq.get(seq); if (sp != null && !sp.isBlank()) { label = sp; break; } }
            a.setOwnerSpeakerLabel(label);
            a.setOwnerAsSpoken(spoken == null ? "I" : spoken);
            om2 = NameMatcher.resolve(label, c.directory);
            if (om2.person() != null) om2 = new NameMatcher.Match("RESOLVED", "SPEAKER_LABEL", om2.person(), om2.candidates());
        } else {
            a.setOwnerAsSpoken(spoken);
            om2 = NameMatcher.resolve(spoken, c.directory);
        }
        a.setOwnerState(om2.state());
        a.setOwnerBasis(om2.basis());
        if (om2.person() != null) { a.setOwnerUserId(om2.person().id()); a.setOwnerName(om2.person().name()); a.setOwnerEmail(om2.person().email()); }
        if (!"NOT_ELIGIBLE".equals(om2.state()))            // a read-only member is never offered as someone to pick
            a.setOwnerCandidates(toPeople(om2.candidates().stream().map(p -> new String[]{p.id(), p.name(), p.email()}).toList()));

        // project
        ProjectMatcher.Match pm = ProjectMatcher.resolve(it.projectName(), c.selected, c.projects);
        if ("UNRESOLVED".equals(pm.state()) && it.proposedProject() != null) {
            Proj existing = ProjectMatcher.existingNamed(it.proposedProject(), c.projects);
            if (existing != null) pm = new ProjectMatcher.Match("EXISTING", "NAMED", existing, List.of(existing), false);
            else { a.setProjectState("PROPOSED_NEW"); a.setProposedProjectName(it.proposedProject()); }
        }
        if (!"PROPOSED_NEW".equals(a.getProjectState())) {
            a.setProjectState(pm.state());
            a.setProjectBasis(pm.basis());
            a.setProjectDiffers(pm.differsFromSelected());
            if (pm.project() != null) { a.setProjectId(pm.project().id()); a.setProjectName(pm.project().name()); }
            a.setProjectCandidates(toPeople(pm.candidates().stream().map(p -> new String[]{p.id(), p.name(), null}).toList()));
        }

        // deadline & priority
        a.setDeadlineText(it.deadline());
        DeadlineResolver.Result d = DeadlineResolver.resolve(it.deadline(), c.meetingDate);
        a.setDeadlineDate(d.date());
        a.setDeadlineStatus(d.status());
        a.setDeadlineNote(d.note());
        if (it.priority() != null) { a.setPriority(it.priority()); a.setPriorityBasis("STATED"); a.setPriorityEvidence(new ArrayList<>(it.priorityEvidence())); }
        else { a.setPriority("MEDIUM"); a.setPriorityBasis("DEFAULT"); }

        a.setStatus(withdrawn ? "WITHDRAWN" : "PROPOSED");
        evaluate(a, c.approvedProposals);
        return a;
    }

    private static List<MeetingAction.Person> toPeople(List<String[]> rows) {
        List<MeetingAction.Person> out = new ArrayList<>();
        for (String[] r : rows) {
            MeetingAction.Person p = new MeetingAction.Person();
            p.setId(r[0]); p.setName(r[1]); p.setEmail(r[2]);
            out.add(p);
        }
        return out;
    }

    /** Recomputes the review reasons, confidence and validity from the action's current facts. */
    private void evaluate(MeetingAction a, Set<String> approvedProposals) {
        boolean proposedNew = "PROPOSED_NEW".equals(a.getProjectState());
        String cands = String.join(", ", a.getOwnerCandidates().stream().map(MeetingAction.Person::getName).toList());
        ReviewRules.Outcome o = ReviewRules.evaluate(new ReviewRules.Input(a.getKind(), "WITHDRAWN".equals(a.getStatus()), a.getOwnerState(), cands,
                a.getDeadlineStatus(), a.getDeadlineText() != null || a.getDeadlineDate() != null, a.getProjectState(), a.isProjectDiffers(), proposedNew,
                proposedNew && approvedProposals.contains(NameMatcher.norm(a.getProposedProjectName())), a.getDuplicateOf() != null, a.isMissingFromLatestRun()));
        List<MeetingAction.Reason> rs = new ArrayList<>();
        for (ReviewRules.Reason r : o.reasons()) {
            MeetingAction.Reason x = new MeetingAction.Reason();
            x.setCode(r.code()); x.setMessage(r.message()); x.setBlocking(r.blocking());
            rs.add(x);
        }
        a.setReasons(rs);
        a.setConfidence(o.confidence());
        a.setValid(o.valid());
    }

    // ── saving a run ──────────────────────────────────────────────────────────

    private RunOutcome ingest(MeetingSession s, Ctx ctx, String requestId, List<Item> items, boolean[] withdrawn, List<Proposal> proposals,
                              List<String> warnings, int dropped) {
        final String org = s.getOrganizationId();
        long existing = mongo.count(new Query(Criteria.where("organizationId").is(org).and("sessionId").is(s.getId())), MeetingAction.class);
        for (MeetingExtraction old : mongo.find(new Query(Criteria.where("organizationId").is(org).and("sessionId").is(s.getId()).and("status").is("PENDING_REVIEW")), MeetingExtraction.class)) {
            old.setStatus("DISCARDED"); old.setDecidedAt(Instant.now()); mongo.save(old);       // superseded by this newer run
        }
        MeetingExtraction ex = new MeetingExtraction();
        ex.setOrganizationId(org);
        ex.setSessionId(s.getId());
        ex.setRequestId(requestId);
        ex.setTranscriptGeneration(s.getTranscriptGeneration());
        ex.setWarnings(new ArrayList<>(warnings));
        if (existing == 0) {
            ex.setStatus("APPLIED");
            ex.setDecidedAt(Instant.now());
            ex = mongo.insert(ex);
            addProposals(ctx, s, proposals, ex.getId());
            addActions(ctx, s, items, withdrawn, ex.getId());
            setSession(org, s.getId(), new Update().set("actionsPendingDiff", false));
            ex.setNewCount(items.size());
            mongo.save(ex);
            return new RunOutcome(items.size(), proposals.size(), false, dropped, warnings);
        }
        List<MeetingAction> current = actions(org, s.getId()).stream().filter(a -> !"MERGED".equals(a.getStatus())).toList();
        ActionMatcher.Diff diff = ActionMatcher.diff(current.stream().map(MeetingAction::getTitle).toList(), items, DIFF);
        int fresh = 0, matched = 0;
        for (int m : diff.matchedExisting()) if (m < 0) fresh++; else matched++;
        ex.setStatus("PENDING_REVIEW");
        ex.setNewCount(fresh);
        ex.setMatchedCount(matched);
        ex.setGoneCount(diff.gone().size());
        List<Map<String, Object>> raw = new ArrayList<>();
        for (int i = 0; i < items.size(); i++) {
            Map<String, Object> mm = om.convertValue(items.get(i), new TypeReference<Map<String, Object>>() {});
            mm.put("_withdrawn", withdrawn[i]);
            raw.add(mm);
        }
        ex.setItems(raw);
        ex.setProposals(proposals.stream().map(p -> om.convertValue(p, new TypeReference<Map<String, Object>>() {})).toList());
        mongo.insert(ex);
        setSession(org, s.getId(), new Update().set("actionsPendingDiff", true));
        return new RunOutcome(fresh, proposals.size(), true, dropped, warnings);
    }

    private void addProposals(Ctx c, MeetingSession s, List<Proposal> proposals, String extractionId) {
        Set<String> have = new HashSet<>();
        for (MeetingProposedProject p : proposals(c.org, s.getId())) have.add(NameMatcher.norm(p.getName()));
        for (Proposal p : proposals) {
            if (ProjectMatcher.existingNamed(p.name(), c.projects) != null || !have.add(NameMatcher.norm(p.name()))) continue;   // never propose what exists
            MeetingProposedProject m = new MeetingProposedProject();
            m.setOrganizationId(c.org);
            m.setSessionId(s.getId());
            m.setStableId(UUID.randomUUID().toString());
            m.setName(p.name());
            m.setDescription(p.description());
            m.setRationale(p.rationale());
            m.setEvidence(new ArrayList<>(p.evidence()));
            m.setExtractionId(extractionId);
            m.setMissingFields(missingProjectFields(m));
            mongo.insert(m);
        }
    }

    private void addActions(Ctx c, MeetingSession s, List<Item> items, boolean[] withdrawn, String extractionId) {
        List<MeetingAction> known = new ArrayList<>(actions(c.org, s.getId()).stream().filter(a -> !"MERGED".equals(a.getStatus())).toList());
        for (int i = 0; i < items.size(); i++) {
            MeetingAction a = build(c, s, items.get(i), withdrawn != null && i < withdrawn.length && withdrawn[i], extractionId);
            for (MeetingAction e : known) {                         // near-duplicates that weren't merged are flagged, never silently dropped
                if (ActionMatcher.similarity(e.getTitle(), a.getTitle()) >= SUSPECT) { a.setDuplicateOf(e.getId()); evaluate(a, c.approvedProposals); break; }
            }
            mongo.insert(a);
            known.add(a);
        }
    }

    private static List<String> missingProjectFields(MeetingProposedProject p) {
        List<String> m = new ArrayList<>();
        if (p.getName() == null || p.getName().trim().length() < 2) m.add("name");
        if (p.getDescription() == null || p.getDescription().isBlank()) m.add("description");
        return m;
    }

    // ── reading ───────────────────────────────────────────────────────────────

    List<MeetingAction> actions(String org, String sessionId) {
        return mongo.find(new Query(Criteria.where("organizationId").is(org).and("sessionId").is(sessionId)).with(Sort.by(Sort.Direction.ASC, "createdAt")), MeetingAction.class);
    }

    List<MeetingProposedProject> proposals(String org, String sessionId) {
        return mongo.find(new Query(Criteria.where("organizationId").is(org).and("sessionId").is(sessionId)).with(Sort.by(Sort.Direction.ASC, "createdAt")), MeetingProposedProject.class);
    }

    private MeetingAction action(String org, String sessionId, String id) {
        MeetingAction a = mongo.findOne(new Query(Criteria.where("_id").is(id).and("organizationId").is(org).and("sessionId").is(sessionId)), MeetingAction.class);
        if (a == null) throw err(HttpStatus.NOT_FOUND, "NOT_FOUND", "That action wasn't found.");
        return a;
    }

    private MeetingProposedProject proposal(String org, String sessionId, String id) {
        MeetingProposedProject p = mongo.findOne(new Query(Criteria.where("_id").is(id).and("organizationId").is(org).and("sessionId").is(sessionId)), MeetingProposedProject.class);
        if (p == null) throw err(HttpStatus.NOT_FOUND, "NOT_FOUND", "That project proposal wasn't found.");
        return p;
    }

    public Map<String, Object> list(MeetingSession s) {
        final String org = s.getOrganizationId();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("status", s.getActionsStatus());
        out.put("message", s.getActionsMessage());
        out.put("extractedAt", s.getActionsExtractedAt() == null ? null : s.getActionsExtractedAt().toString());
        MeetingExtraction pending = mongo.findOne(new Query(Criteria.where("organizationId").is(org).and("sessionId").is(s.getId()).and("status").is("PENDING_REVIEW")), MeetingExtraction.class);
        if (pending == null) out.put("pendingDiff", null);
        else out.put("pendingDiff", Map.of("new", pending.getNewCount(), "stillPresent", pending.getMatchedCount(), "noLongerFound", pending.getGoneCount(),
                "warnings", pending.getWarnings(), "createdAt", pending.getCreatedAt().toString()));
        out.put("actions", actions(org, s.getId()).stream().map(this::view).toList());
        out.put("proposedProjects", proposals(org, s.getId()).stream().map(this::projectView).toList());
        return out;
    }

    private Map<String, Object> view(MeetingAction a) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", a.getId());
        m.put("title", a.getTitle());
        m.put("description", a.getDescription());
        m.put("type", a.getType());
        m.put("kind", a.getKind());
        m.put("kindConfirmedByUser", a.isKindConfirmedByUser());
        m.put("status", a.getStatus());
        m.put("mergedInto", a.getMergedInto());
        m.put("duplicateOf", a.getDuplicateOf());
        m.put("missingFromLatestRun", a.isMissingFromLatestRun());
        m.put("owner", Map.of("state", a.getOwnerState(), "basis", a.getOwnerBasis() == null ? "" : a.getOwnerBasis(), "asSpoken", a.getOwnerAsSpoken() == null ? "" : a.getOwnerAsSpoken(),
                "speakerLabel", a.getOwnerSpeakerLabel() == null ? "" : a.getOwnerSpeakerLabel(), "userId", a.getOwnerUserId() == null ? "" : a.getOwnerUserId(),
                "name", a.getOwnerName() == null ? "" : a.getOwnerName(), "email", a.getOwnerEmail() == null ? "" : a.getOwnerEmail(),
                "candidates", a.getOwnerCandidates().stream().map(p -> Map.of("id", String.valueOf(p.getId()), "name", String.valueOf(p.getName()))).toList()));
        m.put("project", Map.of("state", a.getProjectState(), "basis", a.getProjectBasis() == null ? "" : a.getProjectBasis(), "id", a.getProjectId() == null ? "" : a.getProjectId(),
                "name", a.getProjectName() == null ? "" : a.getProjectName(), "proposedName", a.getProposedProjectName() == null ? "" : a.getProposedProjectName(),
                "differsFromSelected", a.isProjectDiffers(),
                "candidates", a.getProjectCandidates().stream().map(p -> Map.of("id", String.valueOf(p.getId()), "name", String.valueOf(p.getName()))).toList()));
        Map<String, Object> dl = new LinkedHashMap<>();
        dl.put("text", a.getDeadlineText());
        dl.put("date", a.getDeadlineDate() == null ? null : a.getDeadlineDate().toString());
        dl.put("status", a.getDeadlineStatus());
        dl.put("note", a.getDeadlineNote());
        dl.put("timezone", a.getTimezone());
        m.put("deadline", dl);
        m.put("priority", a.getPriority());
        m.put("priorityBasis", a.getPriorityBasis());
        m.put("dependencies", a.getDependencies());
        m.put("acceptanceCriteria", a.getAcceptanceCriteria());
        m.put("evidence", a.getEvidence());
        m.put("confidence", a.getConfidence());
        m.put("reasons", a.getReasons().stream().map(r -> Map.of("code", r.getCode(), "message", r.getMessage(), "blocking", r.isBlocking())).toList());
        m.put("valid", a.isValid());
        m.put("edited", a.isEdited());
        return m;
    }

    private Map<String, Object> projectView(MeetingProposedProject p) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", p.getId());
        m.put("name", p.getName());
        m.put("description", p.getDescription());
        m.put("rationale", p.getRationale());
        m.put("evidence", p.getEvidence());
        m.put("status", p.getStatus());
        m.put("missingFields", p.getMissingFields());
        m.put("edited", p.isEdited());
        return m;
    }

    // ── reviewing ─────────────────────────────────────────────────────────────

    private MeetingAction save(MeetingAction a, String by) {
        a.setUpdatedAt(Instant.now());
        a.setUpdatedBy(by);
        try {
            return mongo.save(a);
        } catch (OptimisticLockingFailureException e) {
            throw err(HttpStatus.CONFLICT, "CONFLICT", "This action was just changed by someone else. Refresh and try again.");
        }
    }

    private Set<String> approvedProposalNames(String org, String sessionId) {
        Set<String> out = new HashSet<>();
        for (MeetingProposedProject p : proposals(org, sessionId)) if ("APPROVED".equals(p.getStatus())) out.add(NameMatcher.norm(p.getName()));
        return out;
    }

    private static String bounded(Object v, int max, String field) {
        String t = v == null ? "" : String.valueOf(v).replaceAll("[\\p{Cntrl}&&[^\n\t]]", "").strip();
        if (t.length() > max) throw err(HttpStatus.BAD_REQUEST, "INVALID_" + field.toUpperCase(Locale.ROOT), field + " is too long (limit " + max + ").");
        return t;
    }

    private List<String> stringList(Object v, String field) {
        if (!(v instanceof List<?> l)) throw err(HttpStatus.BAD_REQUEST, "INVALID_" + field.toUpperCase(Locale.ROOT), field + " must be a list.");
        List<String> out = new ArrayList<>();
        for (Object o : l) { String t = bounded(o, 300, field); if (!t.isEmpty() && out.size() < 10) out.add(t); }
        return out;
    }

    public Map<String, Object> patch(MeetingSession s, String id, Map<String, Object> patch, String by) {
        final String org = s.getOrganizationId();
        MeetingAction a = action(org, s.getId(), id);
        if ("MERGED".equals(a.getStatus())) throw err(HttpStatus.CONFLICT, "INVALID_STATE", "A merged action can't be edited. Restore it first.");
        boolean wasApproved = "APPROVED".equals(a.getStatus());

        if (patch.containsKey("title")) {
            String t = bounded(patch.get("title"), 200, "title");
            if (t.isEmpty()) throw err(HttpStatus.BAD_REQUEST, "INVALID_TITLE", "The title can't be empty.");
            a.setTitle(t);
        }
        if (patch.containsKey("description")) { String d = bounded(patch.get("description"), 1500, "description"); a.setDescription(d.isEmpty() ? null : d); }
        if (patch.containsKey("type")) {
            String t = String.valueOf(patch.get("type")).toUpperCase(Locale.ROOT);
            if (!TYPES.contains(t)) throw err(HttpStatus.BAD_REQUEST, "INVALID_TYPE", "Unknown action type.");
            a.setType(t);
        }
        if (patch.containsKey("kind")) {
            String k = String.valueOf(patch.get("kind")).toUpperCase(Locale.ROOT);
            if (!KINDS.contains(k)) throw err(HttpStatus.BAD_REQUEST, "INVALID_KIND", "Unknown kind.");
            if (!k.equals(a.getKind())) { a.setKind(k); a.setKindConfirmedByUser("COMMITMENT".equals(k)); }
        }
        if (patch.containsKey("ownerUserId")) {
            Object v = patch.get("ownerUserId");
            if (v == null || String.valueOf(v).isBlank()) {                                    // explicitly unassigned
                a.setOwnerUserId(null); a.setOwnerName(null); a.setOwnerEmail(null); a.setOwnerState("MANUAL"); a.setOwnerBasis("USER"); a.setOwnerCandidates(new ArrayList<>());
            } else {
                TeamMember m = mongo.findOne(new Query(Criteria.where("_id").is(String.valueOf(v)).and("organizationId").is(org)), TeamMember.class);
                if (m == null) throw err(HttpStatus.BAD_REQUEST, "INVALID_OWNER", "That person isn't a member of this workspace.");
                if (!NameMatcher.eligible(new Person(m.getId(), m.getName(), m.getEmail(), m.getRole())))
                    throw err(HttpStatus.BAD_REQUEST, "INVALID_OWNER", "Read-only members can't be assigned work.");
                a.setOwnerUserId(m.getId()); a.setOwnerName(m.getName()); a.setOwnerEmail(m.getEmail());
                a.setOwnerState("MANUAL"); a.setOwnerBasis("USER"); a.setOwnerCandidates(new ArrayList<>());
            }
        }
        if (patch.containsKey("projectId") || patch.containsKey("proposedProject")) {
            Object pid = patch.get("projectId");
            Object prop = patch.get("proposedProject");
            if (prop != null && !String.valueOf(prop).isBlank()) {
                String name = String.valueOf(prop);
                MeetingProposedProject mp = proposals(org, s.getId()).stream().filter(p -> NameMatcher.norm(p.getName()).equals(NameMatcher.norm(name)) && !"REJECTED".equals(p.getStatus())).findFirst()
                        .orElseThrow(() -> err(HttpStatus.BAD_REQUEST, "INVALID_PROJECT", "That new project isn't proposed for this meeting."));
                a.setProjectState("PROPOSED_NEW"); a.setProposedProjectName(mp.getName()); a.setProjectId(null); a.setProjectName(null); a.setProjectBasis("USER");
            } else if (pid == null || String.valueOf(pid).isBlank()) {
                a.setProjectState("UNRESOLVED"); a.setProjectId(null); a.setProjectName(null); a.setProposedProjectName(null); a.setProjectBasis(null);
            } else {
                Project p = mongo.findOne(new Query(Criteria.where("_id").is(String.valueOf(pid)).and("organizationId").is(org)), Project.class);
                if (p == null) throw err(HttpStatus.BAD_REQUEST, "INVALID_PROJECT", "That project wasn't found in this workspace.");
                a.setProjectState("MANUAL"); a.setProjectBasis("USER"); a.setProjectId(p.getId()); a.setProjectName(p.getName()); a.setProposedProjectName(null);
            }
            a.setProjectDiffers(false);
            a.setProjectCandidates(new ArrayList<>());
        }
        if (patch.containsKey("deadlineDate")) {
            Object v = patch.get("deadlineDate");
            if (v == null || String.valueOf(v).isBlank()) {
                a.setDeadlineDate(null); a.setDeadlineText(null); a.setDeadlineStatus("UNRESOLVED"); a.setDeadlineNote("No deadline (chosen).");
            } else {
                LocalDate d;
                try { d = LocalDate.parse(String.valueOf(v)); } catch (DateTimeException e) { throw err(HttpStatus.BAD_REQUEST, "INVALID_DATE", "Use a date like 2026-10-16."); }
                if (d.getYear() < 2000 || d.getYear() > 2100) throw err(HttpStatus.BAD_REQUEST, "INVALID_DATE", "That date looks wrong.");
                a.setDeadlineDate(d); a.setDeadlineStatus("MANUAL"); a.setDeadlineNote("Chosen by a person.");
            }
        }
        if (patch.containsKey("priority")) {
            String p = String.valueOf(patch.get("priority")).toUpperCase(Locale.ROOT);
            if (!PRIORITIES.contains(p)) throw err(HttpStatus.BAD_REQUEST, "INVALID_PRIORITY", "Priority must be LOW, MEDIUM or HIGH.");
            a.setPriority(p); a.setPriorityBasis("USER");
        }
        if (Boolean.TRUE.equals(patch.get("notDuplicate"))) a.setDuplicateOf(null);                // "keep both"
        if (patch.containsKey("dependencies")) a.setDependencies(stringList(patch.get("dependencies"), "dependencies"));
        if (patch.containsKey("acceptanceCriteria")) a.setAcceptanceCriteria(stringList(patch.get("acceptanceCriteria"), "acceptanceCriteria"));

        a.setEdited(true);
        if (wasApproved) a.setStatus("PROPOSED");                      // an edit needs a fresh approval — what was approved is what will be created
        evaluate(a, approvedProposalNames(org, s.getId()));
        MeetingAction saved = save(a, by);
        store.audit(org, s.getId(), by, "ACTION_EDITED", saved.getId() + (wasApproved ? " (approval reset)" : ""));
        return view(saved);
    }

    public Map<String, Object> decide(MeetingSession s, String id, String decisionRaw, String by) {
        final String org = s.getOrganizationId();
        MeetingAction a = action(org, s.getId(), id);
        String decision = decisionRaw == null ? "" : decisionRaw.toUpperCase(Locale.ROOT);
        switch (decision) {
            case "APPROVE" -> {
                if (!"PROPOSED".equals(a.getStatus())) throw err(HttpStatus.CONFLICT, "INVALID_STATE", "Only a proposed action can be approved.");
                evaluate(a, approvedProposalNames(org, s.getId()));
                if (!a.isValid()) {
                    String why = String.join(" ", a.getReasons().stream().filter(MeetingAction.Reason::isBlocking).map(MeetingAction.Reason::getMessage).toList());
                    save(a, by);
                    throw err(HttpStatus.CONFLICT, "NOT_READY", "This can't be approved yet. " + why);
                }
                a.setStatus("APPROVED");
            }
            case "REJECT" -> {
                if ("MERGED".equals(a.getStatus())) throw err(HttpStatus.CONFLICT, "INVALID_STATE", "Restore the merged action first.");
                a.setStatus("REJECTED");
            }
            case "RESTORE" -> {
                if ("PROPOSED".equals(a.getStatus()) || "APPROVED".equals(a.getStatus())) throw err(HttpStatus.CONFLICT, "INVALID_STATE", "It isn't rejected, withdrawn or merged.");
                a.setStatus("PROPOSED");
                a.setMergedInto(null);
            }
            default -> throw err(HttpStatus.BAD_REQUEST, "INVALID_DECISION", "Decision must be APPROVE, REJECT or RESTORE.");
        }
        evaluate(a, approvedProposalNames(org, s.getId()));
        MeetingAction saved = save(a, by);
        store.audit(org, s.getId(), by, "ACTION_" + decision, saved.getId());
        return view(saved);
    }

    public Map<String, Object> merge(MeetingSession s, String fromId, String intoId, String by) {
        final String org = s.getOrganizationId();
        if (fromId.equals(intoId)) throw err(HttpStatus.BAD_REQUEST, "INVALID_MERGE", "Pick a different action to merge into.");
        MeetingAction from = action(org, s.getId(), fromId), into = action(org, s.getId(), intoId);
        if ("MERGED".equals(from.getStatus()) || "MERGED".equals(into.getStatus())) throw err(HttpStatus.CONFLICT, "INVALID_STATE", "That action is already merged.");
        TreeSet<Integer> ev = new TreeSet<>(into.getEvidence());
        ev.addAll(from.getEvidence());
        into.setEvidence(new ArrayList<>(ev));
        if (into.getDescription() == null) into.setDescription(from.getDescription());
        for (String d : from.getDependencies()) if (!into.getDependencies().contains(d) && into.getDependencies().size() < 10) into.getDependencies().add(d);
        for (String d : from.getAcceptanceCriteria()) if (!into.getAcceptanceCriteria().contains(d) && into.getAcceptanceCriteria().size() < 10) into.getAcceptanceCriteria().add(d);
        into.setEdited(true);
        if ("APPROVED".equals(into.getStatus())) into.setStatus("PROPOSED");
        if (into.getDuplicateOf() != null && (into.getDuplicateOf().equals(from.getId()))) into.setDuplicateOf(null);
        from.setStatus("MERGED");
        from.setMergedInto(into.getId());
        Set<String> approved = approvedProposalNames(org, s.getId());
        evaluate(into, approved);
        evaluate(from, approved);
        save(from, by);
        MeetingAction saved = save(into, by);
        store.audit(org, s.getId(), by, "ACTION_MERGED", from.getId() + " -> " + into.getId());
        return view(saved);
    }

    public Map<String, Object> approveValid(MeetingSession s, String by) {
        final String org = s.getOrganizationId();
        Set<String> approved = approvedProposalNames(org, s.getId());
        int n = 0;
        List<Map<String, Object>> skipped = new ArrayList<>();
        for (MeetingAction a : actions(org, s.getId())) {
            if (!"PROPOSED".equals(a.getStatus())) continue;
            evaluate(a, approved);
            if (a.isValid()) { a.setStatus("APPROVED"); save(a, by); n++; }
            else skipped.add(Map.of("id", a.getId(), "title", a.getTitle(), "reasons", a.getReasons().stream().filter(MeetingAction.Reason::isBlocking).map(MeetingAction.Reason::getMessage).toList()));
        }
        store.audit(org, s.getId(), by, "ACTIONS_APPROVED_BULK", n + " approved, " + skipped.size() + " skipped");
        return Map.of("approved", n, "skipped", skipped);
    }

    // ── re-runs: a difference to review ──────────────────────────────────────

    public Map<String, Object> resolveDiff(MeetingSession s, boolean apply, String by) {
        final String org = s.getOrganizationId();
        MeetingExtraction ex = mongo.findOne(new Query(Criteria.where("organizationId").is(org).and("sessionId").is(s.getId()).and("status").is("PENDING_REVIEW")), MeetingExtraction.class);
        if (ex == null) throw err(HttpStatus.CONFLICT, "NO_PENDING", "There are no re-run changes waiting for review.");
        if (apply) {
            List<Item> items = new ArrayList<>();
            boolean[] withdrawn = new boolean[ex.getItems().size()];
            for (int i = 0; i < ex.getItems().size(); i++) {
                Map<String, Object> m = new LinkedHashMap<>(ex.getItems().get(i));
                withdrawn[i] = Boolean.TRUE.equals(m.remove("_withdrawn"));
                items.add(om.convertValue(m, Item.class));
            }
            List<Proposal> proposals = ex.getProposals().stream().map(p -> om.convertValue(p, Proposal.class)).toList();
            Ctx ctx = context(s, List.of());
            ctx.speakerBySeq = speakerMap(s);
            List<MeetingAction> current = actions(org, s.getId()).stream().filter(a -> !"MERGED".equals(a.getStatus())).toList();
            ActionMatcher.Diff diff = ActionMatcher.diff(current.stream().map(MeetingAction::getTitle).toList(), items, DIFF);
            addProposals(ctx, s, proposals, ex.getId());
            List<Item> fresh = new ArrayList<>();
            List<Boolean> freshWithdrawn = new ArrayList<>();
            for (int i = 0; i < items.size(); i++) {
                int m = diff.matchedExisting()[i];
                if (m < 0) { fresh.add(items.get(i)); freshWithdrawn.add(withdrawn[i]); }
                else {                                                                      // still there: keep the person's version untouched
                    MeetingAction keep = current.get(m);
                    if (keep.isMissingFromLatestRun()) { keep.setMissingFromLatestRun(false); evaluate(keep, ctx.approvedProposals); save(keep, "system"); }
                }
            }
            boolean[] fw = new boolean[fresh.size()];
            for (int i = 0; i < fw.length; i++) fw[i] = freshWithdrawn.get(i);
            addActions(ctx, s, fresh, fw, ex.getId());
            for (int g : diff.gone()) {                                                     // no longer found: flag it, never delete it
                MeetingAction gone = current.get(g);
                if ("REJECTED".equals(gone.getStatus()) || "WITHDRAWN".equals(gone.getStatus())) continue;
                gone.setMissingFromLatestRun(true);
                if ("APPROVED".equals(gone.getStatus())) gone.setStatus("PROPOSED");
                evaluate(gone, ctx.approvedProposals);
                save(gone, "system");
            }
            ex.setStatus("APPLIED");
        } else {
            ex.setStatus("DISCARDED");
        }
        ex.setDecidedAt(Instant.now());
        ex.setItems(new ArrayList<>());
        ex.setProposals(new ArrayList<>());
        mongo.save(ex);
        setSession(org, s.getId(), new Update().set("actionsPendingDiff", false).set("actionsMessage", null));
        store.audit(org, s.getId(), by, apply ? "RERUN_APPLIED" : "RERUN_DISCARDED", null);
        s.setActionsMessage(null);
        return list(s);
    }

    private Map<Integer, String> speakerMap(MeetingSession s) {
        Map<Integer, String> m = new HashMap<>();
        for (Line l : outputs.loadLines(s)) m.put(l.seq(), l.speaker());
        return m;
    }

    // ── proposed projects ────────────────────────────────────────────────────

    public Map<String, Object> patchProject(MeetingSession s, String id, Map<String, Object> patch, String by) {
        final String org = s.getOrganizationId();
        MeetingProposedProject p = proposal(org, s.getId(), id);
        String oldName = p.getName();
        if (patch.containsKey("name")) {
            String n = bounded(patch.get("name"), 100, "name");
            if (n.length() < 2) throw err(HttpStatus.BAD_REQUEST, "INVALID_NAME", "A project needs a name.");
            if (mongo.find(new Query(Criteria.where("organizationId").is(org)), Project.class).stream().anyMatch(x -> NameMatcher.norm(x.getName()).equals(NameMatcher.norm(n))))
                throw err(HttpStatus.CONFLICT, "PROJECT_EXISTS", "A project with that name already exists. Attach the actions to it instead.");
            p.setName(n);
        }
        if (patch.containsKey("description")) { String d = bounded(patch.get("description"), 1000, "description"); p.setDescription(d.isEmpty() ? null : d); }
        p.setEdited(true);
        p.setMissingFields(missingProjectFields(p));
        if ("APPROVED".equals(p.getStatus())) p.setStatus("PROPOSED");
        p.setUpdatedAt(Instant.now());
        mongo.save(p);
        if (!oldName.equals(p.getName())) {
            for (MeetingAction a : actions(org, s.getId()))
                if ("PROPOSED_NEW".equals(a.getProjectState()) && oldName.equals(a.getProposedProjectName())) { a.setProposedProjectName(p.getName()); save(a, by); }
        }
        refreshActionsFor(s, by);
        store.audit(org, s.getId(), by, "PROJECT_PROPOSAL_EDITED", p.getId());
        return projectView(p);
    }

    public Map<String, Object> decideProject(MeetingSession s, String id, String decisionRaw, String by) {
        final String org = s.getOrganizationId();
        MeetingProposedProject p = proposal(org, s.getId(), id);
        String decision = decisionRaw == null ? "" : decisionRaw.toUpperCase(Locale.ROOT);
        switch (decision) {
            case "APPROVE" -> {
                p.setMissingFields(missingProjectFields(p));
                if (!p.getMissingFields().isEmpty())
                    throw err(HttpStatus.CONFLICT, "MISSING_FIELDS", "A new project needs: " + String.join(", ", p.getMissingFields()) + ". Fill it in first.");
                p.setStatus("APPROVED");
            }
            case "REJECT" -> p.setStatus("REJECTED");
            case "RESTORE" -> p.setStatus("PROPOSED");
            default -> throw err(HttpStatus.BAD_REQUEST, "INVALID_DECISION", "Decision must be APPROVE, REJECT or RESTORE.");
        }
        p.setUpdatedAt(Instant.now());
        mongo.save(p);
        refreshActionsFor(s, by);
        store.audit(org, s.getId(), by, "PROJECT_PROPOSAL_" + decision, p.getId());
        return projectView(p);
    }

    /** After a proposal changes, actions that depend on it are re-evaluated; an approved action that is no longer valid goes back to review. */
    private void refreshActionsFor(MeetingSession s, String by) {
        Set<String> approved = approvedProposalNames(s.getOrganizationId(), s.getId());
        for (MeetingAction a : actions(s.getOrganizationId(), s.getId())) {
            if (!"PROPOSED_NEW".equals(a.getProjectState())) continue;
            evaluate(a, approved);
            if ("APPROVED".equals(a.getStatus()) && !a.isValid()) a.setStatus("PROPOSED");
            save(a, by);
        }
    }

    // ── preview: exactly what would be created ───────────────────────────────

    public Map<String, Object> preview(MeetingSession s) {
        final String org = s.getOrganizationId();
        List<MeetingAction> all = actions(org, s.getId());
        List<Map<String, Object>> tasks = new ArrayList<>();
        Map<String, Integer> perProject = new HashMap<>();
        for (MeetingAction a : all) {
            if (!"APPROVED".equals(a.getStatus())) continue;
            Map<String, Object> t = new LinkedHashMap<>();
            t.put("actionId", a.getId());
            t.put("stableId", a.getStableId());
            t.put("title", a.getTitle());
            t.put("description", a.getDescription());
            t.put("assignee", a.getOwnerUserId() == null ? null : Map.of("id", a.getOwnerUserId(), "name", String.valueOf(a.getOwnerName()), "email", String.valueOf(a.getOwnerEmail())));
            boolean isNew = "PROPOSED_NEW".equals(a.getProjectState());
            t.put("project", Map.of("id", a.getProjectId() == null ? "" : a.getProjectId(), "name", String.valueOf(isNew ? a.getProposedProjectName() : a.getProjectName()), "isNew", isNew));
            t.put("dueDate", a.getDeadlineDate() == null ? null : a.getDeadlineDate().toString());
            t.put("timezone", a.getTimezone());
            t.put("priority", a.getPriority());
            t.put("priorityBasis", a.getPriorityBasis());
            t.put("dependencies", a.getDependencies());
            t.put("acceptanceCriteria", a.getAcceptanceCriteria());
            t.put("evidence", a.getEvidence());
            tasks.add(t);
            String key = isNew ? "new:" + NameMatcher.norm(a.getProposedProjectName()) : "id:" + a.getProjectId();
            perProject.merge(key, 1, Integer::sum);
        }
        List<Map<String, Object>> projects = new ArrayList<>();
        for (MeetingProposedProject p : proposals(org, s.getId())) {
            if (!"APPROVED".equals(p.getStatus())) continue;
            Map<String, Object> m = projectView(p);
            m.put("taskCount", perProject.getOrDefault("new:" + NameMatcher.norm(p.getName()), 0));
            projects.add(m);
        }
        long waiting = all.stream().filter(a -> "PROPOSED".equals(a.getStatus())).count();
        return Map.of("tasks", tasks, "projects", projects, "waitingForReview", waiting);
    }
}

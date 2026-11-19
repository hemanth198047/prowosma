package com.prowosma.backend.uma.app;

import com.prowosma.backend.model.Decision;
import com.prowosma.backend.model.RaidEntry;
import com.prowosma.backend.model.Task;
import com.prowosma.backend.repository.DecisionRepository;
import com.prowosma.backend.repository.RaidRepository;
import com.prowosma.backend.repository.TaskRepository;
import com.prowosma.backend.service.ActivityLogService;
import com.prowosma.backend.uma.core.UmaAccess;
import com.prowosma.backend.uma.core.UmaException;
import com.prowosma.backend.uma.core.UmaStore;
import com.prowosma.backend.uma.model.UmaInsights;
import com.prowosma.backend.uma.model.UmaMeeting;
import com.prowosma.backend.uma.model.UmaStatus;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.time.*;
import java.util.*;
import java.util.stream.Collectors;

/**
 * What the AI Meeting Assistant took over from the two older meeting features, so there is one place for meetings:
 * <ul>
 *   <li>from Meetings (notes): writing notes by hand, sending decisions to the Decision log and risks / blockers to the
 *       project's RAID log, continuity between meetings of the same project, and trends;</li>
 *   <li>from the first Meeting Assistant: editing the summary with a version history, linking an action item to a task that
 *       already exists instead of creating a duplicate, and one list of open action items across meetings.</li>
 * </ul>
 * It writes to the same Decision log, RAID log and task module the rest of the app uses; nothing is copied.
 */
@Service
public class UmaFollowThrough {
    private static final List<String> RAID_OPEN = List.of("OPEN", "IN_PROGRESS");
    private static final Set<String> MEETING_TYPES = Set.of("STANDUP", "PLANNING", "REVIEW", "RETRO", "CLIENT", "ONE_ON_ONE", "OTHER");
    static final int MAX_SUMMARY = 8000;
    static final int MAX_NOTES = 200_000;

    private final UmaService service;
    private final UmaAccess access;
    private final UmaStore store;
    private final TaskRepository tasks;
    private final DecisionRepository decisions;
    private final RaidRepository raid;
    private final ActivityLogService activity;

    public UmaFollowThrough(UmaService service, UmaAccess access, UmaStore store, TaskRepository tasks,
                            DecisionRepository decisions, RaidRepository raid, ActivityLogService activity) {
        this.service = service; this.access = access; this.store = store; this.tasks = tasks;
        this.decisions = decisions; this.raid = raid; this.activity = activity;
    }

    private UmaMeeting readable(UmaService.Ctx c, String id) {
        UmaMeeting m = store.meeting(c.org(), id).orElse(null);
        access.requireRead(m, c.caller());
        return m;
    }

    private UmaMeeting manageable(UmaService.Ctx c, String id) {
        UmaMeeting m = store.meeting(c.org(), id).orElse(null);
        access.requireManage(m, c.caller());
        return m;
    }

    private UmaInsights insights(UmaService.Ctx c, String id) {
        return store.insights(c.org(), id).orElseThrow(() -> new UmaException(HttpStatus.CONFLICT, "NO_INSIGHTS", "This meeting hasn't been processed yet."));
    }

    // ── Notes written by hand ────────────────────────────────────────────

    /**
     * A meeting from typed notes: the agenda and notes become the transcript (one line per line typed), so the summary,
     * decisions and action items come out exactly as for an imported transcript.
     */
    public UmaMeeting createFromNotes(UmaService.Ctx c, String title, Instant meetingAt, String timezone, String projectId,
                                      String meetingType, List<String> attendees, String agenda, String notes) {
        String a = blank(agenda), n = blank(notes);
        if (n == null && a == null) throw new UmaException(HttpStatus.BAD_REQUEST, "EMPTY_NOTES", "Write the notes first.");
        StringBuilder text = new StringBuilder();
        if (a != null) text.append("Agenda:\n").append(a).append("\n\n");
        if (n != null) text.append("Notes:\n").append(n);
        if (text.length() > MAX_NOTES) throw new UmaException(HttpStatus.CONTENT_TOO_LARGE, "NOTES_TOO_LONG", "Those notes are too long. Split them into two meetings.");
        UmaMeeting m = service.importTranscript(c, text.toString(), null, title, projectId, meetingAt, timezone);
        String type = meetingType == null ? null : meetingType.strip().toUpperCase(Locale.ROOT);
        m.setMeetingType(type != null && MEETING_TYPES.contains(type) ? type : null);
        m.setAgenda(a);
        if (attendees != null) m.setAttendees(attendees.stream().map(String::strip).filter(s -> !s.isEmpty()).distinct().limit(200).toList());
        m.setSource(m.getSource() == null ? "NOTES" : m.getSource());
        return store.save(m);
    }

    // ── Summary: edit, history, restore ─────────────────────────────────

    public UmaInsights editSummary(UmaService.Ctx c, String id, String text) {
        manageable(c, id);
        UmaInsights ins = insights(c, id);
        String t = text == null ? "" : text.strip();
        if (t.isEmpty()) throw new UmaException(HttpStatus.BAD_REQUEST, "EMPTY_SUMMARY", "The summary can't be empty.");
        if (t.length() > MAX_SUMMARY) throw new UmaException(HttpStatus.BAD_REQUEST, "SUMMARY_TOO_LONG", "Keep the summary under " + MAX_SUMMARY + " characters.");
        if (t.equals(ins.getSummary())) return ins;
        keepVersion(ins, ins.isSummaryEdited() ? ins.getSummaryEditedBy() : "ai");
        ins.setSummary(t);
        ins.setSummaryEdited(true);
        ins.setSummaryEditedBy(c.caller().email());
        ins.setSummaryEditedAt(Instant.now());
        store.saveInsights(ins);
        store.audit(c.org(), id, c.caller().email(), "SUMMARY_EDITED", "v" + ins.getSummaryHistory().size());
        return ins;
    }

    public UmaInsights restoreSummary(UmaService.Ctx c, String id, int number) {
        manageable(c, id);
        UmaInsights ins = insights(c, id);
        UmaInsights.SummaryVersion v = ins.getSummaryHistory().stream().filter(s -> s.getNumber() == number).findFirst()
                .orElseThrow(() -> new UmaException(HttpStatus.NOT_FOUND, "NO_VERSION", "That version of the summary doesn't exist."));
        keepVersion(ins, ins.isSummaryEdited() ? ins.getSummaryEditedBy() : "ai");
        ins.setSummary(v.getText());
        ins.setSummaryEdited(true);
        ins.setSummaryEditedBy(c.caller().email());
        ins.setSummaryEditedAt(Instant.now());
        store.saveInsights(ins);
        store.audit(c.org(), id, c.caller().email(), "SUMMARY_RESTORED", "v" + number);
        return ins;
    }

    private static void keepVersion(UmaInsights ins, String by) {
        if (ins.getSummary() == null || ins.getSummary().isBlank()) return;
        UmaInsights.SummaryVersion v = new UmaInsights.SummaryVersion();
        v.setNumber(ins.getSummaryHistory().size() + 1);
        v.setText(ins.getSummary());
        v.setBy(by == null ? "ai" : by);
        ins.getSummaryHistory().add(v);
        if (ins.getSummaryHistory().size() > 30) ins.getSummaryHistory().remove(0);   // numbers stay stable: they are never reused
    }

    // ── Decision log and RAID log ───────────────────────────────────────

    /** Adds one decision from the meeting to the workspace Decision log. Repeating returns the same entry. */
    public Decision logDecision(UmaService.Ctx c, String id, String decisionId, String projectId) {
        UmaMeeting m = manageable(c, id);
        UmaInsights ins = insights(c, id);
        UmaInsights.Decision d = ins.getDecisions().stream().filter(x -> x.getId().equals(decisionId)).findFirst()
                .orElseThrow(() -> new UmaException(HttpStatus.NOT_FOUND, "NO_DECISION", "That decision doesn't exist."));
        if (d.getLoggedDecisionId() != null) {
            Optional<Decision> existing = decisions.findById(d.getLoggedDecisionId());
            if (existing.isPresent()) return existing.get();
        }
        String project = blank(projectId) != null ? projectId.strip() : m.getProjectId();
        Decision e = new Decision();
        e.setOrganizationId(c.org());
        e.setWorkspaceId(c.org());
        e.setTitle(shorten(d.getText(), 140));
        e.setDecision(d.getText());
        e.setContext("From the meeting “" + m.getTitle() + "”" + (m.getMeetingAt() == null ? "" : " on " + LocalDate.ofInstant(m.getMeetingAt(), ZoneOffset.UTC)));
        e.setMadeBy(d.getDecidedBy());
        e.setStatus("DECIDED");
        e.setDecidedAt(m.getMeetingAt() == null ? LocalDateTime.now() : LocalDateTime.ofInstant(m.getMeetingAt(), ZoneOffset.UTC));
        if (project != null) { e.setLinkedProjectIds(new ArrayList<>(List.of(project))); e.setLinkedEntityType("PROJECT"); }
        e.setSourceMeetingId(m.getId());
        e.setCreatedBy(c.caller().email());
        e.setCreatedAt(LocalDateTime.now());
        e.setUpdatedAt(LocalDateTime.now());
        Decision saved = decisions.save(e);
        d.setLoggedDecisionId(saved.getId());
        store.saveInsights(ins);
        store.audit(c.org(), id, c.caller().email(), "DECISION_LOGGED", decisionId + " -> " + saved.getId());
        activity.log("decision", saved.getId(), saved.getTitle(), "MEETING_LINKED", null, m.getId(), c.caller().email());
        return saved;
    }

    /** Adds a risk, blocker or dependency from the meeting to the project's RAID log. A project is needed: RAID is per project. */
    public RaidEntry logRisk(UmaService.Ctx c, String id, String findingId, String projectId, String impact) {
        UmaMeeting m = manageable(c, id);
        UmaInsights ins = insights(c, id);
        UmaInsights.Finding f = ins.getRisks().stream().filter(x -> x.getId().equals(findingId)).findFirst()
                .orElseThrow(() -> new UmaException(HttpStatus.NOT_FOUND, "NO_RISK", "That risk doesn't exist."));
        if (f.getRaidId() != null) {
            Optional<RaidEntry> existing = raid.findById(f.getRaidId());
            if (existing.isPresent()) return existing.get();
        }
        String project = blank(projectId) != null ? projectId.strip() : m.getProjectId();
        if (project == null) throw new UmaException(HttpStatus.BAD_REQUEST, "PROJECT_NEEDED", "Choose the project this belongs to: the RAID log is kept per project.");
        RaidEntry r = new RaidEntry();
        r.setOrganizationId(c.org());
        r.setProjectId(project);
        r.setType(raidType(f.getKind()));
        r.setTitle(shorten(f.getText(), 140));
        r.setDescription(f.getText() + "\n\nRaised in the meeting “" + m.getTitle() + "”.");
        String imp = impact == null ? "MEDIUM" : impact.strip().toUpperCase(Locale.ROOT);
        r.setImpact(Set.of("HIGH", "MEDIUM", "LOW").contains(imp) ? imp : "MEDIUM");
        r.setStatus("OPEN");
        r.setSourceMeetingId(m.getId());
        r.setLastMeetingId(m.getId());
        r.setCreatedBy(c.caller().email());
        r.setCreatedAt(LocalDateTime.now());
        r.setUpdatedAt(LocalDateTime.now());
        RaidEntry saved = raid.save(r);
        f.setRaidId(saved.getId());
        store.saveInsights(ins);
        store.audit(c.org(), id, c.caller().email(), "RISK_LOGGED", findingId + " -> " + saved.getId());
        activity.log("RISK".equals(saved.getType()) ? "risk" : "blocker", saved.getId(), saved.getTitle(), "MEETING_LINKED", null, m.getId(), c.caller().email());
        return saved;
    }

    static String raidType(String kind) {
        if (kind == null) return "RISK";
        return switch (kind.toUpperCase(Locale.ROOT)) {
            case "BLOCKER" -> "ISSUE";
            case "DEPENDENCY" -> "DEPENDENCY";
            default -> "RISK";
        };
    }

    // ── Action item → task that already exists ──────────────────────────

    /** Open tasks whose title is close to the action item's: offered so the meeting doesn't create a duplicate. */
    public List<Map<String, Object>> similarTasks(UmaService.Ctx c, String id, String actionId) {
        readable(c, id);
        UmaInsights.ActionItem a = action(insights(c, id), actionId);
        Set<String> words = words(a.getTitle());
        if (words.isEmpty()) return List.of();
        List<Map<String, Object>> out = new ArrayList<>();
        for (Task t : tasks.findByOrganizationId(c.org())) {
            if ("DONE".equals(t.getStatus()) || t.getTitle() == null) continue;
            if (a.getCreatedTaskId() != null && a.getCreatedTaskId().equals(t.getId())) continue;
            double score = similarity(words, words(t.getTitle()));
            if (a.getProjectId() != null && a.getProjectId().equals(t.getProjectId())) score += 0.1;
            if (score < 0.45) continue;
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("id", t.getId()); r.put("title", t.getTitle()); r.put("status", t.getStatus()); r.put("projectId", t.getProjectId());
            r.put("score", Math.round(Math.min(score, 1) * 100) / 100.0);
            out.add(r);
        }
        out.sort(Comparator.comparingDouble((Map<String, Object> r) -> (double) r.get("score")).reversed());
        return out.size() > 5 ? out.subList(0, 5) : out;
    }

    /** The action is already covered by an existing task: link it instead of creating a new one. */
    public UmaInsights.ActionItem linkToTask(UmaService.Ctx c, String id, String actionId, String taskId) {
        manageable(c, id);
        UmaInsights ins = insights(c, id);
        UmaInsights.ActionItem a = action(ins, actionId);
        if ("CREATED".equals(a.getStatus())) throw new UmaException(HttpStatus.CONFLICT, "ALREADY_CREATED", "A task was already created from this item.");
        Task t = tasks.findById(blank(taskId) == null ? "" : taskId.strip()).filter(x -> c.org().equals(x.getOrganizationId()))
                .orElseThrow(() -> new UmaException(HttpStatus.NOT_FOUND, "NO_TASK", "That task doesn't exist in this workspace."));
        a.setStatus("LINKED");
        a.setCreatedTaskId(t.getId());
        a.setDecidedBy(c.caller().email());
        a.setDecidedAt(Instant.now());
        a.setFailureReason(null);
        store.saveInsights(ins);
        store.audit(c.org(), id, c.caller().email(), "ACTION_LINKED", actionId + " -> task " + t.getId());
        return a;
    }

    private static UmaInsights.ActionItem action(UmaInsights ins, String actionId) {
        return ins.getActions().stream().filter(x -> x.getId().equals(actionId)).findFirst()
                .orElseThrow(() -> new UmaException(HttpStatus.NOT_FOUND, "NO_ACTION", "That action item doesn't exist."));
    }

    private static final Set<String> STOP = Set.of("the", "a", "an", "to", "for", "of", "and", "or", "on", "in", "with", "by", "be", "is", "it", "this", "that", "we", "our", "up", "at");

    static Set<String> words(String s) {
        if (s == null) return Set.of();
        return Arrays.stream(s.toLowerCase(Locale.ROOT).split("[^a-z0-9]+"))
                .filter(w -> w.length() > 1 && !STOP.contains(w)).collect(Collectors.toCollection(LinkedHashSet::new));
    }

    /** Overlap of meaningful words (Dice coefficient): 1 = same words, 0 = nothing in common. */
    static double similarity(Set<String> a, Set<String> b) {
        if (a.isEmpty() || b.isEmpty()) return 0;
        long common = a.stream().filter(b::contains).count();
        return 2.0 * common / (a.size() + b.size());
    }

    // ── Open action items across meetings ───────────────────────────────

    /**
     * Every action item that still needs someone: waiting for review in a meeting the person may see, or turned into a task
     * that isn't done yet. Newest meeting first.
     */
    public List<Map<String, Object>> openActions(UmaService.Ctx c, String projectId, int limit) {
        int max = Math.max(1, Math.min(limit, 300));
        List<UmaMeeting> visible = store.meetings(c.org(), 300).stream()
                .filter(m -> access.canRead(m, c.caller()))
                .filter(m -> blank(projectId) == null || projectId.equals(m.getProjectId()))
                .toList();
        Map<String, Task> taskById = new HashMap<>();
        List<Map<String, Object>> out = new ArrayList<>();
        for (UmaMeeting m : visible) {
            Optional<UmaInsights> ins = store.insights(c.org(), m.getId());
            if (ins.isEmpty()) continue;
            boolean canManage = access.canManage(m, c.caller());
            for (UmaInsights.ActionItem a : ins.get().getActions()) {
                String state;
                Task t = null;
                if ("PENDING".equals(a.getStatus()) || "FAILED".equals(a.getStatus())) state = "NEEDS_REVIEW";
                else if (("CREATED".equals(a.getStatus()) || "LINKED".equals(a.getStatus())) && a.getCreatedTaskId() != null) {
                    t = taskById.computeIfAbsent(a.getCreatedTaskId(), k -> tasks.findById(k).orElse(null));
                    if (t == null || "DONE".equals(t.getStatus())) continue;
                    state = "IN_TASKS";
                } else continue;
                Map<String, Object> r = new LinkedHashMap<>();
                r.put("meetingId", m.getId());
                r.put("meetingTitle", m.getTitle());
                r.put("meetingAt", m.getMeetingAt());
                r.put("projectId", a.getProjectId() != null ? a.getProjectId() : m.getProjectId());
                r.put("state", state);
                r.put("canManage", canManage);
                r.put("action", a);
                if (t != null) {
                    r.put("taskStatus", t.getStatus());
                    r.put("taskDueDate", t.getDueDate());
                    r.put("overdue", t.getDueDate() != null && t.getDueDate().isBefore(LocalDateTime.now()));
                } else {
                    r.put("overdue", a.getDueDate() != null && a.getDueDate().isBefore(LocalDate.now()));
                }
                out.add(r);
                if (out.size() >= max) return out;
            }
        }
        return out;
    }

    /** The meetings of one project the person may see, newest first (the project card lists them). */
    public List<Map<String, Object>> forProject(UmaService.Ctx c, String projectId, int limit) {
        String p = blank(projectId);
        if (p == null) throw new UmaException(HttpStatus.BAD_REQUEST, "PROJECT_NEEDED", "Choose a project.");
        return store.meetings(c.org(), 300).stream()
                .filter(m -> p.equals(m.getProjectId()) && m.getStatus() != UmaStatus.CANCELLED && access.canRead(m, c.caller()))
                .sorted(Comparator.comparing(UmaFollowThrough::when).reversed())
                .limit(Math.max(1, Math.min(limit, 50)))
                .map(service::summary).toList();
    }

    // ── Continuity between meetings of the same project ─────────────────

    /**
     * For a meeting with a project: the previous meeting of that project, what changed since then (tasks it produced that are
     * now done, decisions and RAID entries added since), and what is still open going in (action items, open risks and
     * blockers, open decisions). Without a project it returns only the workspace-wide open items the person can act on.
     */
    public Map<String, Object> continuity(UmaService.Ctx c, String id) {
        UmaMeeting m = readable(c, id);
        return continuityFor(c, m.getProjectId(), m.getId(), when(m));
    }

    /** "Where do we stand" before a meeting: the same picture for a project, without a meeting yet. */
    public Map<String, Object> prepare(UmaService.Ctx c, String projectId) {
        return continuityFor(c, blank(projectId), null, Instant.now());
    }

    private Map<String, Object> continuityFor(UmaService.Ctx c, String projectId, String meetingId, Instant at) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("projectId", projectId);
        UmaMeeting previous = null;
        if (projectId != null) {
            previous = store.meetings(c.org(), 300).stream()
                    .filter(x -> projectId.equals(x.getProjectId()) && !x.getId().equals(meetingId))
                    .filter(x -> x.getStatus() != UmaStatus.CANCELLED && when(x).isBefore(at))
                    .filter(x -> access.canRead(x, c.caller()))
                    .max(Comparator.comparing(UmaFollowThrough::when)).orElse(null);
        }
        if (previous != null) {
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("id", previous.getId()); p.put("title", previous.getTitle()); p.put("meetingAt", when(previous));
            out.put("previousMeeting", p);
        }

        // Since the previous meeting
        Map<String, Object> since = new LinkedHashMap<>();
        if (previous != null) {
            LocalDateTime from = LocalDateTime.ofInstant(when(previous), ZoneOffset.UTC);
            List<Map<String, Object>> done = new ArrayList<>(), stillOpen = new ArrayList<>();
            store.insights(c.org(), previous.getId()).ifPresent(ins -> {
                for (UmaInsights.ActionItem a : ins.getActions()) {
                    if (a.getCreatedTaskId() == null) continue;
                    tasks.findById(a.getCreatedTaskId()).ifPresent(t -> {
                        Map<String, Object> r = Map.of("taskId", t.getId(), "title", t.getTitle() == null ? a.getTitle() : t.getTitle(), "status", String.valueOf(t.getStatus()));
                        ("DONE".equals(t.getStatus()) ? done : stillOpen).add(r);
                    });
                }
            });
            since.put("tasksDone", done);
            since.put("tasksStillOpen", stillOpen);
            since.put("newDecisions", decisions.findByOrganizationIdOrderByCreatedAtDesc(c.org()).stream()
                    .filter(d -> d.getLinkedProjectIds() != null && d.getLinkedProjectIds().contains(projectId))
                    .filter(d -> d.getCreatedAt() != null && d.getCreatedAt().isAfter(from))
                    .map(UmaFollowThrough::decisionRow).limit(20).toList());
            List<RaidEntry> projectRaid = raid.findByOrganizationIdAndProjectId(c.org(), projectId);
            since.put("newRisks", projectRaid.stream().filter(r -> r.getCreatedAt() != null && r.getCreatedAt().isAfter(from))
                    .map(UmaFollowThrough::raidRow).limit(20).toList());
            since.put("resolvedRisks", projectRaid.stream()
                    .filter(r -> !RAID_OPEN.contains(String.valueOf(r.getStatus())) && r.getUpdatedAt() != null && r.getUpdatedAt().isAfter(from))
                    .map(UmaFollowThrough::raidRow).limit(20).toList());
        }
        out.put("sinceLastMeeting", since);

        // Still open going in
        Map<String, Object> open = new LinkedHashMap<>();
        List<Map<String, Object>> actions = openActions(c, projectId, 50).stream()
                .filter(r -> meetingId == null || !meetingId.equals(r.get("meetingId"))).toList();
        open.put("actionItems", actions);
        List<RaidEntry> openRaid = projectId == null
                ? raid.findByOrganizationIdAndStatusIn(c.org(), RAID_OPEN)
                : raid.findByOrganizationIdAndProjectIdInAndStatusIn(c.org(), List.of(projectId), RAID_OPEN);
        open.put("blockers", openRaid.stream().filter(r -> "ISSUE".equals(r.getType())).map(UmaFollowThrough::raidRow).limit(30).toList());
        open.put("risks", openRaid.stream().filter(r -> !"ISSUE".equals(r.getType())).map(UmaFollowThrough::raidRow).limit(30).toList());
        List<Decision> openDecisions = projectId == null
                ? decisions.findByOrganizationIdAndStatus(c.org(), "OPEN")
                : decisions.findByOrganizationIdAndStatusAndLinkedProjectIdsIn(c.org(), "OPEN", List.of(projectId));
        open.put("decisions", openDecisions.stream().map(UmaFollowThrough::decisionRow).limit(30).toList());
        out.put("stillOpen", open);

        Map<String, Object> counts = new LinkedHashMap<>();
        counts.put("openActionItems", actions.size());
        counts.put("overdueActionItems", actions.stream().filter(r -> Boolean.TRUE.equals(r.get("overdue"))).count());
        counts.put("activeBlockers", ((List<?>) open.get("blockers")).size());
        counts.put("activeRisks", ((List<?>) open.get("risks")).size());
        counts.put("openDecisions", ((List<?>) open.get("decisions")).size());
        out.put("counts", counts);
        return out;
    }

    private static Map<String, Object> decisionRow(Decision d) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("id", d.getId()); r.put("title", d.getTitle()); r.put("status", d.getStatus()); r.put("createdAt", d.getCreatedAt());
        return r;
    }

    private static Map<String, Object> raidRow(RaidEntry e) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("id", e.getId()); r.put("title", e.getTitle()); r.put("type", e.getType()); r.put("status", e.getStatus());
        r.put("impact", e.getImpact()); r.put("projectId", e.getProjectId());
        return r;
    }

    // ── Trends ───────────────────────────────────────────────────────────

    /** One row per day for the last {@code days} days, from the meetings the person may see. */
    public List<Map<String, Object>> trends(UmaService.Ctx c, int days) {
        int n = Math.max(7, Math.min(days, 90));
        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        LocalDate first = today.minusDays(n - 1L);
        Map<LocalDate, long[]> byDay = new TreeMap<>();               // meetings, action items found, tasks created/linked, decisions
        for (int i = 0; i < n; i++) byDay.put(first.plusDays(i), new long[4]);
        for (UmaMeeting m : store.meetings(c.org(), 300)) {
            if (!access.canRead(m, c.caller()) || m.getStatus() == UmaStatus.CANCELLED) continue;
            LocalDate d = LocalDate.ofInstant(when(m), ZoneOffset.UTC);
            long[] row = byDay.get(d);
            if (row != null) row[0]++;
            store.insights(c.org(), m.getId()).ifPresent(ins -> {
                if (row != null) { row[1] += ins.getActions().size(); row[3] += ins.getDecisions().size(); }
                for (UmaInsights.ActionItem a : ins.getActions()) {
                    if ((!"CREATED".equals(a.getStatus()) && !"LINKED".equals(a.getStatus())) || a.getDecidedAt() == null) continue;
                    long[] r2 = byDay.get(LocalDate.ofInstant(a.getDecidedAt(), ZoneOffset.UTC));
                    if (r2 != null) r2[2]++;
                }
            });
        }
        List<Map<String, Object>> out = new ArrayList<>();
        byDay.forEach((d, v) -> {
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("date", d.toString()); r.put("meetings", v[0]); r.put("actionItems", v[1]); r.put("tasksCreated", v[2]); r.put("decisions", v[3]);
            out.add(r);
        });
        return out;
    }

    // ── helpers ──────────────────────────────────────────────────────────

    static Instant when(UmaMeeting m) {
        return m.getMeetingAt() != null ? m.getMeetingAt() : (m.getCreatedAt() != null ? m.getCreatedAt() : Instant.EPOCH);
    }

    private static String blank(String s) { return s == null || s.isBlank() ? null : s.strip(); }

    private static String shorten(String s, int max) {
        if (s == null) return "";
        String t = s.strip();
        return t.length() <= max ? t : t.substring(0, max - 1).strip() + "…";
    }
}

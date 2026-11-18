package com.prowosma.backend.uma.app;

import com.prowosma.backend.meetingassistant.NameMatcher;
import com.prowosma.backend.model.Project;
import com.prowosma.backend.model.Task;
import com.prowosma.backend.model.TeamMember;
import com.prowosma.backend.model.Workspace;
import com.prowosma.backend.repository.TeamMemberRepository;
import com.prowosma.backend.repository.WorkspaceRepository;
import com.prowosma.backend.service.MeetingSystemContext;
import com.prowosma.backend.service.NotificationService;
import com.prowosma.backend.service.ProjectService;
import com.prowosma.backend.uma.core.UmaStore;
import com.prowosma.backend.uma.model.*;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.*;

/**
 * What happens on its own once a meeting's notes are written. Nothing here comes from the model's word alone:
 * <ul>
 *   <li><b>Projects</b> - a project named in the meeting that already exists is linked; one that someone explicitly asked to create
 *       (intent CREATE, its name said in the cited lines) is created through the existing project service; a suggestion waits for a person.</li>
 *   <li><b>Tasks</b> - only clearly agreed actions (HIGH confidence, cited lines). An action whose named owner can't be verified waits for a person.
 *       The owner is verified when they were invited to the meeting by email (or organised it) - a name match alone is never enough.</li>
 *   <li>Everything runs AS the meeting's organiser in the meeting's workspace, so their permissions apply to every write, and every record
 *       carries a source key, so running it again never makes a second task or project.</li>
 *   <li>The report counts saved records afterwards. It never repeats what the model claimed.</li>
 * </ul>
 * The transcript is untrusted: this step can only create tasks and projects and link them - it never updates, reassigns or deletes anything.
 */
@Component
@Slf4j
public class UmaPostMeeting {
    static final int MAX_AUTO_PROJECTS = 3;

    private final UmaStore store;
    private final MongoTemplate mongo;
    private final MeetingSystemContext system;
    private final UmaTaskWriter taskWriter;
    private final ProjectService projects;
    private final TeamMemberRepository members;
    private final WorkspaceRepository workspaces;
    private final NotificationService notifications;

    public UmaPostMeeting(UmaStore store, MongoTemplate mongo, MeetingSystemContext system, UmaTaskWriter taskWriter, ProjectService projects,
                          TeamMemberRepository members, WorkspaceRepository workspaces, NotificationService notifications) {
        this.store = store; this.mongo = mongo; this.system = system; this.taskWriter = taskWriter; this.projects = projects;
        this.members = members; this.workspaces = workspaces; this.notifications = notifications;
    }

    public record Policy(boolean tasks, boolean assign, boolean projects, int maxTasks) {}

    public Policy policy(String org, String ownerEmail) {
        UmaSettings s = mongo.findById(org, UmaSettings.class);
        if (s == null) s = new UmaSettings();
        UmaUserPrefs p = prefs(org, ownerEmail);
        return new Policy(s.tasksOn() && p.isAutoTasks(), s.assignOn(), s.projectsOn(), s.maxTasks());
    }

    public UmaUserPrefs prefs(String org, String email) {
        UmaUserPrefs p = email == null ? null : mongo.findOne(new Query(Criteria.where("organizationId").is(org)
                .and("userEmail").is(email.toLowerCase(Locale.ROOT))), UmaUserPrefs.class);
        if (p != null) return p;
        p = new UmaUserPrefs();
        p.setOrganizationId(org);
        p.setUserEmail(email == null ? null : email.toLowerCase(Locale.ROOT));
        return p;
    }

    /** Runs the automation for a meeting whose insights were just written. Never throws: a failure is reported, not hidden. */
    public UmaInsights.Automation run(UmaMeeting m) {
        String org = m.getOrganizationId();
        UmaInsights ins = store.insights(org, m.getId()).orElse(null);
        if (ins == null) return null;
        String owner = m.getCreatedBy();
        Policy policy = policy(org, owner);
        List<String> notes = new ArrayList<>();
        try {
            if (!isMember(org, owner)) {
                notes.add("Nothing was created automatically: the meeting's organiser is no longer in this workspace.");
                verifyOwners(m, ins);
            } else {
                system.run(org, owner, () -> { act(m, ins, policy, owner, notes); return null; });
            }
        } catch (RuntimeException e) {
            log.warn("uma post-meeting automation failed for a meeting: {}", e.getClass().getSimpleName());
            notes.add("Automatic steps stopped early: " + (e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage()));
        }
        UmaInsights.Automation report = report(org, ins, policy, owner, notes);
        ins.setAutomation(report);
        store.saveInsights(ins);
        store.audit(org, m.getId(), "automatic", "AUTOMATION_RAN", report.getTasksCreated() + " tasks, " + report.getProjectsCreated()
                + " projects created, " + report.getNeedsReview() + " to review");
        return report;
    }

    private void act(UmaMeeting m, UmaInsights ins, Policy policy, String owner, List<String> notes) {
        String org = m.getOrganizationId();
        // ── projects ──
        List<Project> all = mongo.find(new Query(Criteria.where("organizationId").is(org)), Project.class);
        int created = 0;
        for (UmaInsights.ProjectItem p : ins.getProjects()) {
            if (!"PROPOSED".equals(p.getStatus())) continue;
            Project same = sameName(p.getName(), all);
            if (same != null) {
                p.setStatus("LINKED"); p.setProjectId(same.getId()); p.setAutomatic(true); p.setReviewReason(null);
                p.setDecidedBy("automatic"); p.setDecidedAt(Instant.now());
                continue;
            }
            if ("EXISTING".equals(p.getIntent())) { p.setReviewReason("No project with this exact name was found. Pick it or create it."); continue; }
            if (!"CREATE".equals(p.getIntent())) { p.setReviewReason("Suggested in the meeting, not clearly asked for. Create it if you want it."); continue; }
            if (!policy.projects()) { p.setReviewReason("Automatic project creation is switched off."); continue; }
            if (created >= MAX_AUTO_PROJECTS) { p.setReviewReason("Only " + MAX_AUTO_PROJECTS + " projects are created automatically per meeting."); continue; }
            try {
                Project saved = createProject(m, p, owner);
                p.setStatus("CREATED"); p.setProjectId(saved.getId()); p.setAutomatic(true); p.setReviewReason(null); p.setFailureReason(null);
                p.setDecidedBy("automatic"); p.setDecidedAt(Instant.now());
                all = new ArrayList<>(all); all.add(saved);
                created++;
                store.audit(org, m.getId(), "automatic", "PROJECT_CREATED", p.getId() + " -> project " + saved.getId());
            } catch (RuntimeException e) {
                p.setReviewReason("Couldn't be created automatically: " + reason(e));
            }
        }

        // The project the tasks belong to: the one chosen for the meeting, else the one project this meeting created or named.
        String target = m.getProjectId();
        if (target == null) {
            List<String> ids = ins.getProjects().stream().filter(p -> "CREATED".equals(p.getStatus()) || "LINKED".equals(p.getStatus()))
                    .map(UmaInsights.ProjectItem::getProjectId).distinct().toList();
            if (ids.size() == 1) target = ids.get(0);
        }

        // ── tasks ──
        verifyOwners(m, ins);
        int made = (int) ins.getActions().stream().filter(a -> a.isAutomatic() && "CREATED".equals(a.getStatus())).count();
        for (UmaInsights.ActionItem a : ins.getActions()) {
            if (!"PENDING".equals(a.getStatus()) && !"FAILED".equals(a.getStatus())) continue;
            if (a.getProjectId() == null && target != null && !a.isEdited()) a.setProjectId(target);
            if (a.isEdited()) { a.setReviewReason("You edited it - create it when you're ready."); continue; }
            if (!policy.tasks()) { a.setReviewReason("Automatic task creation is switched off."); continue; }
            if (!"HIGH".equals(a.getConfidence())) { a.setReviewReason("It was suggested rather than clearly agreed. Confirm it if it's needed."); continue; }
            if (a.getEvidence().isEmpty()) { a.setReviewReason("No transcript line supports it."); continue; }
            boolean named = a.getOwnerSpoken() != null;
            if (named && !a.isOwnerVerified()) { a.setReviewReason(a.getOwnerBasis() == null ? "Confirm who owns it." : a.getOwnerBasis()); continue; }
            if (made >= policy.maxTasks()) { a.setReviewReason("Only " + policy.maxTasks() + " tasks are created automatically per meeting."); continue; }
            boolean assign = policy.assign() && a.isOwnerVerified() && a.getOwnerMemberId() != null;
            try {
                Task t = taskWriter.createOrFind(org, m, a, owner, assign);
                a.setStatus("CREATED"); a.setCreatedTaskId(t.getId()); a.setAutomatic(true); a.setFailureReason(null); a.setReviewReason(null);
                a.setDecidedBy("automatic"); a.setDecidedAt(Instant.now());
                made++;
                store.audit(org, m.getId(), "automatic", "TASK_CREATED", a.getId() + " -> task " + t.getId());
                if (assign && t.getAssigneeIds() != null && !t.getAssigneeIds().isEmpty()) notifyAssigned(m, a, t);
                if (a.getDueSpoken() != null && a.getDueDate() == null)                          // never a guessed date
                    notes.add("\"" + t.getTitle() + "\" was created without a deadline: \"" + a.getDueSpoken() + "\" is ambiguous"
                            + (a.getDueSuggested() != null ? " (probably " + a.getDueSuggested() + ")" : "") + ". Set it on the task.");
            } catch (RuntimeException e) {
                a.setStatus("FAILED"); a.setFailureReason(reason(e));
            }
        }
        if (!policy.assign()) notes.add("Automatic assignment is switched off: tasks were created without owners.");
    }

    private Project createProject(UmaMeeting m, UmaInsights.ProjectItem p, String owner) {
        String key = UmaTaskWriter.sourceKey(m.getId(), p.getId());
        Project found = mongo.findOne(new Query(Criteria.where("organizationId").is(m.getOrganizationId()).and("sourceProposalKey").is(key)), Project.class);
        if (found != null) return found;
        Project pr = new Project();
        pr.setName(p.getName());
        String evidence = String.join(", ", p.getEvidence().stream().map(i -> "#" + i).toList());
        pr.setDescription(((p.getDescription() == null || p.getDescription().isBlank()) ? "" : p.getDescription() + "\n\n")
                + "Created from the meeting \"" + m.getTitle() + "\" (AI Meeting Assistant), transcript line" + (p.getEvidence().size() == 1 ? " " : "s ") + evidence + ".");
        pr.setStatus("ACTIVE");
        pr.setCreatedBy(owner);
        pr.setSourceMeetingId(m.getId());
        pr.setSourceMeetingTitle(m.getTitle());
        pr.setSourceProposalKey(key);
        try { return projects.create(pr); }
        catch (DuplicateKeyException race) {
            Project again = mongo.findOne(new Query(Criteria.where("organizationId").is(m.getOrganizationId()).and("sourceProposalKey").is(key)), Project.class);
            if (again == null) throw race;
            return again;
        }
    }

    /**
     * Marks each action's owner as verified or not. Verified = the person the meeting named is a workspace member who was INVITED to
     * this meeting by email (or organised it). A spoken first name counts only when exactly one invited member has that first name.
     */
    void verifyOwners(UmaMeeting m, UmaInsights ins) {
        String org = m.getOrganizationId();
        Set<String> invited = new HashSet<>();
        if (m.getAttendees() != null) m.getAttendees().forEach(e -> { if (e != null) invited.add(e.trim().toLowerCase(Locale.ROOT)); });
        if (m.getCreatedBy() != null) invited.add(m.getCreatedBy().toLowerCase(Locale.ROOT));
        Map<String, TeamMember> byId = new HashMap<>();
        List<TeamMember> invitedMembers = new ArrayList<>();
        for (TeamMember t : members.findByOrganizationId(org)) {
            byId.put(t.getId(), t);
            if (t.getEmail() != null && invited.contains(t.getEmail().toLowerCase(Locale.ROOT)) && !"VIEWER".equalsIgnoreCase(t.getRole())) invitedMembers.add(t);
        }
        for (UmaInsights.ActionItem a : ins.getActions()) {
            if (!"PENDING".equals(a.getStatus()) && !"FAILED".equals(a.getStatus())) continue;
            if (a.isEdited()) continue;                                         // a person chose the owner: leave it alone
            a.setOwnerVerified(false);
            if (a.getOwnerSpoken() == null) { a.setOwnerBasis(null); continue; }
            TeamMember matched = a.getOwnerMemberId() == null ? null : byId.get(a.getOwnerMemberId());
            if (matched != null && matched.getEmail() != null && invited.contains(matched.getEmail().toLowerCase(Locale.ROOT))) {
                a.setOwnerVerified(true);
                a.setOwnerBasis("Invited to the meeting as " + matched.getEmail().toLowerCase(Locale.ROOT) + ".");
                continue;
            }
            // A first name or partial name: accept it only when exactly one invited member matches it.
            String spoken = NameMatcher.norm(a.getOwnerSpoken());
            List<TeamMember> hits = spoken.isEmpty() ? List.of() : invitedMembers.stream().filter(t -> namesMatch(spoken, t.getName())).toList();
            if (hits.size() == 1 && ("SUGGESTED".equals(a.getOwnerState()) || "MATCHED".equals(a.getOwnerState()) || "AMBIGUOUS".equals(a.getOwnerState()))) {
                TeamMember t = hits.get(0);
                a.setOwnerMemberId(t.getId()); a.setOwnerState("MATCHED"); a.setOwnerVerified(true);
                a.setOwnerBasis("The only person invited to the meeting called \"" + a.getOwnerSpoken() + "\" (" + t.getEmail().toLowerCase(Locale.ROOT) + ").");
                continue;
            }
            if (hits.size() > 1) a.setOwnerBasis("More than one invited person is called \"" + a.getOwnerSpoken() + "\". Choose the right one.");
            else if (invited.size() <= 1) a.setOwnerBasis("\"" + a.getOwnerSpoken() + "\" couldn't be checked against the invitation list (the meeting has no invited people). Confirm the owner.");
            else a.setOwnerBasis("\"" + a.getOwnerSpoken() + "\" isn't one of the people invited to this meeting. Confirm the owner.");
        }
    }

    /** "priya", "priya sharma" or "sharma" against "Priya Sharma": every spoken word must be one of the member's name words. */
    static boolean namesMatch(String spokenNorm, String memberName) {
        if (memberName == null) return false;
        Set<String> words = new HashSet<>(Arrays.asList(NameMatcher.norm(memberName).split(" ")));
        for (String w : spokenNorm.split(" ")) if (!w.isEmpty() && !words.contains(w)) return false;
        return true;
    }

    private static Project sameName(String name, List<Project> all) {
        String n = NameMatcher.norm(name);
        List<Project> hits = all.stream().filter(p -> !p.isArchived() && n.equals(NameMatcher.norm(p.getName()))).toList();
        return hits.size() == 1 ? hits.get(0) : null;
    }

    private void notifyAssigned(UmaMeeting m, UmaInsights.ActionItem a, Task t) {
        try {
            String who = members.findById(t.getAssigneeIds().get(0)).map(TeamMember::getName).orElse("someone");
            notifications.createWithCategory("Task assigned from a meeting", who + ": " + t.getTitle() + " (from \"" + m.getTitle() + "\")",
                    "INFO", "TASK", t.getId(), "ASSIGNMENT");
        } catch (RuntimeException e) {
            log.warn("uma: assignment notification failed: {}", e.getClass().getSimpleName());
        }
    }

    private boolean isMember(String org, String email) {
        if (email == null) return false;
        Workspace ws = workspaces.findById(org).orElse(null);
        if (ws != null && email.equalsIgnoreCase(ws.getOwnerEmail())) return true;
        return members.findAllByEmailAndOrganizationId(email, org).stream().anyMatch(t -> !"VIEWER".equalsIgnoreCase(t.getRole()));
    }

    /** Counts from saved records: tasks and projects that really exist now, linked to this meeting. */
    private UmaInsights.Automation report(String org, UmaInsights ins, Policy policy, String owner, List<String> notes) {
        UmaInsights.Automation r = new UmaInsights.Automation();
        r.setRanAt(Instant.now()); r.setRanAs(owner); r.setTasksEnabled(policy.tasks()); r.setProjectsEnabled(policy.projects());
        List<String> autoTaskIds = ins.getActions().stream().filter(a -> a.isAutomatic() && "CREATED".equals(a.getStatus()) && a.getCreatedTaskId() != null)
                .map(UmaInsights.ActionItem::getCreatedTaskId).toList();
        List<Task> saved = autoTaskIds.isEmpty() ? List.of() : mongo.find(new Query(Criteria.where("organizationId").is(org).and("_id").in(autoTaskIds)), Task.class);
        r.setTasksCreated(saved.size());
        r.setTasksAssigned((int) saved.stream().filter(t -> t.getAssigneeIds() != null && !t.getAssigneeIds().isEmpty()).count());
        List<String> createdProjectIds = ins.getProjects().stream().filter(p -> p.isAutomatic() && "CREATED".equals(p.getStatus()) && p.getProjectId() != null)
                .map(UmaInsights.ProjectItem::getProjectId).toList();
        r.setProjectsCreated(createdProjectIds.isEmpty() ? 0 : (int) mongo.count(new Query(Criteria.where("organizationId").is(org).and("_id").in(createdProjectIds)), Project.class));
        r.setProjectsLinked((int) ins.getProjects().stream().filter(p -> "LINKED".equals(p.getStatus())).count());
        r.setNeedsReview((int) (ins.getActions().stream().filter(a -> "PENDING".equals(a.getStatus())).count()
                + ins.getProjects().stream().filter(p -> "PROPOSED".equals(p.getStatus())).count()));
        r.setFailed((int) ins.getActions().stream().filter(a -> "FAILED".equals(a.getStatus())).count());
        if (saved.size() < autoTaskIds.size()) notes.add((autoTaskIds.size() - saved.size()) + " automatically created task(s) no longer exist (deleted since).");
        r.setNotes(notes);
        return r;
    }

    /** One line for the meeting's status: "Meeting processed: 5 tasks created (3 assigned), 2 project updates, 1 needs your review." */
    public static String headline(UmaInsights.Automation r) {
        if (r == null) return null;
        List<String> parts = new ArrayList<>();
        if (r.getTasksCreated() > 0) parts.add(r.getTasksCreated() + " task" + (r.getTasksCreated() == 1 ? "" : "s") + " created"
                + (r.getTasksAssigned() > 0 ? " (" + r.getTasksAssigned() + " assigned)" : ""));
        int projectUpdates = r.getProjectsCreated() + r.getProjectsLinked();
        if (projectUpdates > 0) parts.add(projectUpdates + " project update" + (projectUpdates == 1 ? "" : "s"));
        if (r.getNeedsReview() > 0) parts.add(r.getNeedsReview() + " need" + (r.getNeedsReview() == 1 ? "s" : "") + " your review");
        if (r.getFailed() > 0) parts.add(r.getFailed() + " couldn't be created");
        return "Meeting processed" + (parts.isEmpty() ? "." : ": " + String.join(", ", parts) + ".");
    }

    private static String reason(RuntimeException e) {
        String msg = e.getMessage();
        if (msg == null || msg.isBlank()) return "It couldn't be created.";
        return msg.length() > 200 ? msg.substring(0, 200) : msg;
    }
}

package com.prowosma.backend.service;

import com.prowosma.backend.meetingassistant.*;
import com.prowosma.backend.model.*;
import com.prowosma.backend.repository.MeetingAssistantSettingsRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.mongodb.core.FindAndModifyOptions;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;

/**
 * Creates the real tasks and projects from approved meeting items, through the application's EXISTING TaskService / ProjectService
 * (so activity log, realtime updates and the standard notifications behave exactly as for any other task).
 *
 *  - Duplicate-proof: every item is CLAIMED atomically before anything is created, and every created record carries the stable id of
 *    the item it came from (with a unique index). A repeated request, a retry, two people pressing Create at once, or a crash half-way
 *    can never create the same task twice.
 *  - Partial success is explicit: each item succeeds or fails on its own; failures keep their reason and are the only things retried.
 *  - Nothing stale is created: each item is re-checked against the CURRENT directory/projects first; if it no longer holds it goes
 *    back to review instead of being created.
 *  - Review mode runs inside the person's own request (they are the creator). Automatic mode runs as the dedicated Meeting Assistant
 *    system actor, bound to this one workspace, and only touches items that pass the strict AutoCreateRules.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class MeetingCreationService {

    public static final String JOB_TYPE = "CREATE_FROM_MEETING";
    private static final Duration STALE_CLAIM = Duration.ofMinutes(5);

    private final MongoTemplate mongo;
    private final MeetingSessionStore store;
    private final MeetingJobService jobs;
    private final MeetingActionService actionService;
    private final TaskService taskService;
    private final ProjectService projectService;
    private final NotificationService notificationService;
    private final MeetingSystemContext systemContext;
    private final MeetingAssistantSettingsRepository settingsRepo;

    @Value("${app.meeting-assistant.auto-create-delay-minutes:10}")
    private int autoDelayMinutes;

    public record ItemResult(String kind, String id, String title, String state, String recordId, String message) {
        Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("kind", kind); m.put("id", id); m.put("title", title); m.put("state", state); m.put("recordId", recordId); m.put("message", message);
            return m;
        }
    }

    // ── Review mode: a person presses Create (everything approved) ───────────

    public Map<String, Object> createApproved(MeetingSession s, String actor) {
        long approved = actionService.actions(s.getOrganizationId(), s.getId()).stream().filter(a -> "APPROVED".equals(a.getStatus())).count()
                + actionService.proposals(s.getOrganizationId(), s.getId()).stream().filter(p -> "APPROVED".equals(p.getStatus())).count();
        if (approved == 0) throw new MeetingAssistantException(HttpStatus.CONFLICT, "NOTHING_APPROVED", "Nothing is approved yet. Approve actions first.");
        List<ItemResult> results = process(s, actor, false, true, true);
        return finish(s, "REVIEW", actor, results);
    }

    // ── Automatic mode ────────────────────────────────────────────────────────

    /** After extraction: if an admin enabled automatic creation, queue a run after a short settling period so late corrections count. */
    public void scheduleAutoIfEnabled(MeetingSession s, String requestedBy) {
        try {
            MeetingAssistantSettings st = settingsRepo.findByOrganizationId(s.getOrganizationId()).orElse(null);
            if (st == null || (!st.isAutoCreateTasks() && !st.isAutoCreateProjects())) return;
            jobs.enqueue(s.getOrganizationId(), s.getId(), JOB_TYPE, requestedBy, Instant.now().plus(Math.max(0, autoDelayMinutes), ChronoUnit.MINUTES),
                    Instant.now().plus(1, ChronoUnit.DAYS), UUID.randomUUID().toString(), 6);
            store.audit(s.getOrganizationId(), s.getId(), "system", "AUTO_CREATE_SCHEDULED", null);
        } catch (RuntimeException e) {
            log.warn("Automatic creation not scheduled: {}", e.getClass().getSimpleName());
        }
    }

    /** The background job. Re-checks every condition at run time; anything doubtful is simply left for review. */
    public void runAuto(MeetingJob job, MeetingSession s) {
        final String org = s.getOrganizationId();
        MeetingAssistantSettings st = settingsRepo.findByOrganizationId(org).orElse(null);
        if (st == null || (!st.isAutoCreateTasks() && !st.isAutoCreateProjects())) return;                // switched off since it was queued
        if (s.isActionsPendingDiff() || !"READY".equals(s.getActionsStatus())) {
            store.audit(org, s.getId(), "system", "AUTO_CREATE_SKIPPED", "changes are waiting for review");
            return;
        }
        String role = roleOf(org, job.getRequestedBy());
        if (!st.getSendRoles().contains(role)) {                                                           // the requester may no longer act
            store.audit(org, s.getId(), "system", "AUTO_CREATE_SKIPPED", "requester no longer allowed");
            return;
        }
        List<ItemResult> results = systemContext.run(org, AutoCreateRules.SYSTEM_ACTOR,
                () -> process(s, AutoCreateRules.SYSTEM_ACTOR, true, st.isAutoCreateTasks(), st.isAutoCreateProjects()));
        finish(s, "AUTO", AutoCreateRules.SYSTEM_ACTOR, results);
    }

    private String roleOf(String org, String email) {
        if (email == null) return "NONE";
        Workspace ws = mongo.findOne(new Query(Criteria.where("_id").is(org)), Workspace.class);
        if (ws != null && email.equals(ws.getOwnerEmail())) return "OWNER";
        TeamMember m = mongo.findOne(new Query(Criteria.where("organizationId").is(org).and("email").is(email)), TeamMember.class);
        return m == null || m.getRole() == null ? "NONE" : m.getRole();
    }

    // ── shared engine ─────────────────────────────────────────────────────────

    private List<ItemResult> process(MeetingSession s, String actor, boolean auto, boolean doTasks, boolean doProjects) {
        final String org = s.getOrganizationId();
        List<ItemResult> out = new ArrayList<>();

        if (doProjects) {
            for (MeetingProposedProject p : actionService.proposals(org, s.getId())) {
                if (auto && AutoCreateRules.projectEligible(new AutoCreateRules.ProjectFacts(p.getStatus(), p.getName(), p.getDescription(), p.getEvidence().size())))
                    mongo.updateFirst(new Query(Criteria.where("_id").is(p.getId()).and("organizationId").is(org).and("status").is("PROPOSED")),
                            new Update().set("status", "APPROVED").set("updatedAt", Instant.now()), MeetingProposedProject.class);
                ItemResult r = createProject(s, p.getId(), actor, auto);
                if (r != null) out.add(r);
            }
        }
        if (doTasks) {
            for (MeetingAction a0 : actionService.actions(org, s.getId())) {
                if (auto && ("PROPOSED".equals(a0.getStatus()) || "APPROVED".equals(a0.getStatus()))) {
                    MeetingAction fresh = actionService.refresh(s, a0);
                    boolean newProjectReady = "PROPOSED_NEW".equals(fresh.getProjectState()) && projectReady(org, s.getId(), fresh.getProposedProjectName());
                    boolean eligible = AutoCreateRules.taskEligible(new AutoCreateRules.TaskFacts(fresh.getStatus(), fresh.getKind(), fresh.isValid(),
                            fresh.getOwnerUserId() != null, fresh.getDuplicateOf() != null, fresh.isMissingFromLatestRun(), "WITHDRAWN".equals(fresh.getStatus()),
                            fresh.getEvidence().size(), fresh.getProjectState(), newProjectReady));
                    if (!eligible) continue;                                                                // uncertain items stay in review
                    mongo.updateFirst(new Query(Criteria.where("_id").is(a0.getId()).and("organizationId").is(org).and("status").in("PROPOSED", "APPROVED")),
                            new Update().set("status", "APPROVED").set("updatedAt", Instant.now()), MeetingAction.class);
                }
                ItemResult r = createTask(s, a0.getId(), actor, auto);
                if (r != null) out.add(r);
            }
        }
        return out;
    }

    private boolean projectReady(String org, String sessionId, String name) {
        String n = NameMatcher.norm(name);
        return actionService.proposals(org, sessionId).stream().anyMatch(p -> NameMatcher.norm(p.getName()).equals(n)
                && ("APPROVED".equals(p.getStatus()) || "CREATED".equals(p.getStatus())));
    }

    private Map<String, Object> finish(MeetingSession s, String mode, String actor, List<ItemResult> results) {
        MeetingCreationBatch b = new MeetingCreationBatch();
        b.setOrganizationId(s.getOrganizationId());
        b.setSessionId(s.getId());
        b.setMode(mode);
        b.setActor(actor);
        for (ItemResult r : results) {
            if ("CREATED".equals(r.state())) b.setCreated(b.getCreated() + 1);
            else if ("FAILED".equals(r.state())) b.setFailed(b.getFailed() + 1);
            else b.setSkipped(b.getSkipped() + 1);
            b.getItems().add(r.toMap());
        }
        mongo.insert(b);
        store.audit(s.getOrganizationId(), s.getId(), actor, "CREATION_" + mode, b.getCreated() + " created, " + b.getFailed() + " failed, " + b.getSkipped() + " returned to review");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("batchId", b.getId());
        out.put("mode", mode);
        out.put("created", b.getCreated());
        out.put("failed", b.getFailed());
        out.put("skipped", b.getSkipped());
        out.put("items", b.getItems());
        return out;
    }

    // ── projects ──────────────────────────────────────────────────────────────

    private Criteria claimable() {
        return new Criteria().orOperator(Criteria.where("creationState").is(null), Criteria.where("creationState").is("FAILED"),
                Criteria.where("creationState").is("CREATING").and("creationStartedAt").lt(Instant.now().minus(STALE_CLAIM)));
    }

    private ItemResult createProject(MeetingSession s, String proposalId, String actor, boolean auto) {
        final String org = s.getOrganizationId();
        MeetingProposedProject p = mongo.findAndModify(new Query(new Criteria().andOperator(
                        Criteria.where("_id").is(proposalId).and("organizationId").is(org).and("status").is("APPROVED"), claimable())),
                new Update().set("creationState", "CREATING").set("creationStartedAt", Instant.now()),
                FindAndModifyOptions.options().returnNew(true), MeetingProposedProject.class);
        if (p == null) return null;                                                                       // already created, or someone else is creating it
        try {
            if (p.getName() == null || p.getName().trim().length() < 2 || p.getDescription() == null || p.getDescription().isBlank())
                return failProject(p, "A new project needs a name and a description.");
            Project existing = mongo.findOne(new Query(Criteria.where("organizationId").is(org).and("sourceProposalKey").is(p.getStableId())), Project.class);
            if (existing == null) {
                String key = NameMatcher.norm(p.getName());
                boolean nameTaken = mongo.find(new Query(Criteria.where("organizationId").is(org)), Project.class).stream()
                        .anyMatch(x -> NameMatcher.norm(x.getName()).equals(key));
                if (nameTaken) return failProject(p, "A project with this name already exists. Attach the actions to it instead.");
                Project pr = new Project();
                pr.setName(p.getName().trim());
                pr.setDescription(CreationText.description(p.getDescription(), List.of(), CreationText.footer(s.getTitle(), p.getEvidence(), s.getId())));
                pr.setCreatedBy(actor);
                pr.setSourceMeetingId(s.getId());
                pr.setSourceMeetingTitle(cleanTitle(s));
                pr.setSourceProposalKey(p.getStableId());
                try {
                    existing = projectService.create(pr);
                } catch (DuplicateKeyException race) {                                                    // created concurrently: use that one
                    existing = mongo.findOne(new Query(Criteria.where("organizationId").is(org).and("sourceProposalKey").is(p.getStableId())), Project.class);
                    if (existing == null) throw race;
                }
            }
            p.setStatus("CREATED");
            p.setCreationState("CREATED");
            p.setCreationError(null);
            p.setCreatedProjectId(existing.getId());
            p.setCreatedBy(actor);
            p.setAutoCreated(auto);
            p.setUpdatedAt(Instant.now());
            mongo.save(p);
            store.audit(org, s.getId(), actor, auto ? "PROJECT_AUTO_CREATED" : "PROJECT_CREATED", existing.getId());
            return new ItemResult("PROJECT", p.getId(), p.getName(), "CREATED", existing.getId(), null);
        } catch (RuntimeException e) {
            return failProject(p, friendly(e));
        }
    }

    private ItemResult failProject(MeetingProposedProject p, String message) {
        p.setCreationState("FAILED");
        p.setCreationError(message);
        p.setUpdatedAt(Instant.now());
        mongo.save(p);
        return new ItemResult("PROJECT", p.getId(), p.getName(), "FAILED", null, message);
    }

    // ── tasks ─────────────────────────────────────────────────────────────────

    private ItemResult createTask(MeetingSession s, String actionId, String actor, boolean auto) {
        final String org = s.getOrganizationId();
        MeetingAction a = mongo.findAndModify(new Query(new Criteria().andOperator(
                        Criteria.where("_id").is(actionId).and("organizationId").is(org).and("status").is("APPROVED"), claimable())),
                new Update().set("creationState", "CREATING").set("creationStartedAt", Instant.now()),
                FindAndModifyOptions.options().returnNew(true), MeetingAction.class);
        if (a == null) return null;
        try {
            actionService.refresh(s, a);                                                                   // is it still true today?
            if (!a.isValid()) {
                String why = String.join(" ", a.getReasons().stream().filter(MeetingAction.Reason::isBlocking).map(MeetingAction.Reason::getMessage).toList());
                a.setStatus("PROPOSED");
                a.setCreationState(null);
                a.setCreationError("Sent back for review: " + why);
                a.setUpdatedAt(Instant.now());
                mongo.save(a);
                return new ItemResult("TASK", a.getId(), a.getTitle(), "RETURNED", null, a.getCreationError());
            }
            String projectId = a.getProjectId();
            if ("PROPOSED_NEW".equals(a.getProjectState())) {
                String n = NameMatcher.norm(a.getProposedProjectName());
                projectId = actionService.proposals(org, s.getId()).stream()
                        .filter(p -> NameMatcher.norm(p.getName()).equals(n) && "CREATED".equals(p.getStatus())).map(MeetingProposedProject::getCreatedProjectId).findFirst().orElse(null);
                if (projectId == null) return failTask(a, "Its new project hasn't been created yet. Create the project first, then retry.");
            }

            Task existing = mongo.findOne(new Query(Criteria.where("organizationId").is(org).and("sourceActionKey").is(a.getStableId())), Task.class);
            boolean assigned = false;
            if (existing == null) {
                Task t = new Task();
                t.setTitle(a.getTitle());
                t.setDescription(CreationText.description(a.getDescription(), a.getDependencies(), CreationText.footer(s.getTitle(), a.getEvidence(), s.getId())));
                t.setProjectId(projectId);
                t.setPriority(a.getPriority());
                t.setType(CreationText.taskType(a.getType()));
                if (a.getDeadlineDate() != null) t.setDueDate(a.getDeadlineDate().atStartOfDay());
                if (a.getOwnerUserId() != null) { t.setAssigneeIds(new ArrayList<>(List.of(a.getOwnerUserId()))); assigned = true; }
                t.setTags(new ArrayList<>(List.of("meeting")));
                List<Task.ChecklistItem> checklist = new ArrayList<>();
                for (String c : a.getAcceptanceCriteria()) { Task.ChecklistItem i = new Task.ChecklistItem(); i.setText(c); checklist.add(i); }
                t.setChecklist(checklist);
                t.setCreatedBy(actor);
                t.setSourceMeetingId(s.getId());
                t.setSourceMeetingTitle(cleanTitle(s));
                t.setSourceActionKey(a.getStableId());
                t.setSourceEvidence(new ArrayList<>(a.getEvidence()));
                try {
                    existing = taskService.create(t);
                } catch (DuplicateKeyException race) {                                                    // created concurrently: use that one
                    existing = mongo.findOne(new Query(Criteria.where("organizationId").is(org).and("sourceActionKey").is(a.getStableId())), Task.class);
                    if (existing == null) throw race;
                    assigned = false;
                }
            }
            a.setStatus("CREATED");
            a.setCreationState("CREATED");
            a.setCreationError(null);
            a.setCreatedTaskId(existing.getId());
            a.setCreatedBy(actor);
            a.setAutoCreated(auto);
            a.setCreatedRecordAt(Instant.now());
            a.setUpdatedAt(Instant.now());
            mongo.save(a);
            store.audit(org, s.getId(), actor, auto ? "TASK_AUTO_CREATED" : "TASK_CREATED", existing.getId());
            if (assigned) notifyAssignee(s, a, existing);
            return new ItemResult("TASK", a.getId(), a.getTitle(), "CREATED", existing.getId(), null);
        } catch (RuntimeException e) {
            return failTask(a, friendly(e));
        }
    }

    /** The standard "Task Created" notification comes from TaskService itself; this adds the assignment one in the inbox's ASSIGNMENT category. */
    private void notifyAssignee(MeetingSession s, MeetingAction a, Task t) {
        try {
            notificationService.createWithCategory("Task assigned", "“" + t.getTitle() + "” was assigned to " + a.getOwnerName()
                    + " from the meeting “" + cleanTitle(s) + "”.", "INFO", "TASK", t.getId(), "ASSIGNMENT");
        } catch (RuntimeException e) {
            log.warn("Assignment notification failed for task {}: {}", t.getId(), e.getClass().getSimpleName());   // never undo a created task
        }
    }

    private ItemResult failTask(MeetingAction a, String message) {
        a.setCreationState("FAILED");
        a.setCreationError(message);
        a.setUpdatedAt(Instant.now());
        mongo.save(a);
        return new ItemResult("TASK", a.getId(), a.getTitle(), "FAILED", null, message);
    }

    private static String cleanTitle(MeetingSession s) {
        String t = s.getTitle() == null ? "Meeting" : s.getTitle();
        return t.startsWith("[SIMULATED] ") ? t.substring(12) : t;
    }

    /** A reason a person can read — never a stack trace or internal detail. */
    private static String friendly(RuntimeException e) {
        if (e instanceof org.springframework.web.server.ResponseStatusException rse && rse.getReason() != null) return rse.getReason();
        if (e instanceof IllegalArgumentException && e.getMessage() != null && e.getMessage().length() < 200) return e.getMessage();
        return "Prowosma couldn't create it just now. Try again.";
    }
}

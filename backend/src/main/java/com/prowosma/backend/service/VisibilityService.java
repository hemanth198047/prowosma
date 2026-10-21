package com.prowosma.backend.service;

import com.prowosma.backend.access.*;
import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.*;
import com.prowosma.backend.repository.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.BeanUtils;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.support.PageableExecutionUtils;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.server.ResponseStatusException;

import java.util.*;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import static com.prowosma.backend.access.AccessConstants.*;

/**
 * The single place that answers "what may the person making this request see and do?".
 *
 * It resolves an {@link AccessScope} once per HTTP request and applies it to projects and tasks.
 * Outside an authenticated HTTP request (schedulers, async work, WebSocket frames) the scope is
 * unrestricted, exactly like the tenant guard: those code paths act for the system, not for a person.
 *
 * Nothing is enforced until a workspace admin switches access control on, and a member with no
 * profile stays unrestricted until a default profile is chosen, so existing workspaces behave as before.
 *
 * Phase 1 covers projects, tasks and the live feed. Everything else is held back from restricted
 * callers by {@link AccessGatePolicy} until it is scoped.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class VisibilityService {

    private static final String ATTR = VisibilityService.class.getName() + ".scope";
    private static final String NONE = "\u0000none";

    private final WorkspaceContext workspaceContext;
    private final WorkspaceRepository workspaceRepository;
    private final WorkspaceConfigRepository configRepository;
    private final TeamMemberRepository teamMemberRepository;
    private final AccessProfileRepository profileRepository;
    private final UserGroupRepository groupRepository;
    private final ProjectRepository projectRepository;
    private final MongoTemplate mongoTemplate;

    // ── scope resolution ────────────────────────────────────────────────────────

    public AccessScope current() {
        RequestAttributes ra = RequestContextHolder.getRequestAttributes();
        if (ra == null) return AccessScope.unrestricted();
        Object cached = ra.getAttribute(ATTR, RequestAttributes.SCOPE_REQUEST);
        if (cached instanceof AccessScope s) return s;
        AccessScope s;
        try {
            s = resolve();
        } catch (RuntimeException e) {
            // Never fail open on an error while resolving: a broken lookup must not widen access.
            log.error("Access scope could not be resolved; restricting this request: {}", e.toString());
            s = AccessScope.of("", null, MODE_ASSIGNED, Set.of(), false, Set.of(), "unresolved");
        }
        ra.setAttribute(ATTR, s, RequestAttributes.SCOPE_REQUEST);
        return s;
    }

    private AccessScope resolve() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated() || "anonymousUser".equals(auth.getPrincipal())) return AccessScope.unrestricted();
        String org;
        try {
            org = workspaceContext.getWorkspaceId();
        } catch (RuntimeException notInRequest) {
            return AccessScope.unrestricted();
        }
        if (org == null || org.isBlank()) return AccessScope.unrestricted();
        return resolveFor(auth.getName(), org);
    }

    /**
     * The scope of a named person, for work that runs outside their request (a background job acting
     * for the person who started it). No person (blank email) means the system: unrestricted. A lookup
     * error restricts rather than widens.
     */
    public AccessScope scopeFor(String email, String org) {
        if (email == null || email.isBlank() || org == null || org.isBlank()) return AccessScope.unrestricted();
        try {
            return resolveFor(email, org);
        } catch (RuntimeException e) {
            log.error("Access scope for a background job could not be resolved; restricting it: {}", e.toString());
            return AccessScope.of(email, null, MODE_ASSIGNED, Set.of(), false, Set.of(), "unresolved");
        }
    }

    private AccessScope resolveFor(String email, String org) {
        WorkspaceConfig cfg = configRepository.findByWorkspaceId(org).orElse(null);
        if (cfg == null || !cfg.isAccessControlEnabled()) return AccessScope.unrestricted();

        boolean owner = workspaceRepository.findById(org)
                .map(w -> w.getOwnerEmail() != null && w.getOwnerEmail().equalsIgnoreCase(email)).orElse(false);
        if (owner) return AccessScope.unrestricted();

        TeamMember member = teamMemberRepository.findAllByEmailAndOrganizationId(email, org).stream().findFirst().orElse(null);
        if (member == null) return AccessScope.unrestricted(); // API-key / system principals; WorkspaceFilter already rejects non-members of JWT sessions

        String profileId = member.getAccessProfileId() != null && !member.getAccessProfileId().isBlank()
                ? member.getAccessProfileId() : cfg.getDefaultAccessProfileId();
        if (profileId == null || profileId.isBlank()) return AccessScope.unrestricted(); // legacy: nothing assigned yet

        AccessProfile profile = profileRepository.findByIdAndOrganizationId(profileId, org).orElse(null);
        if (profile == null) return AccessScope.of(email, member.getId(), MODE_ASSIGNED, Set.of(), false, Set.of(), "Missing profile");

        Set<String> departments = groupRepository.findByOrganizationIdAndType(org, GROUP_DEPARTMENT).stream()
                .filter(g -> g.getMemberEmails() != null && g.getMemberEmails().stream().anyMatch(e -> e != null && e.equalsIgnoreCase(email)))
                .map(UserGroup::getId).collect(Collectors.toSet());
        return AccessScope.of(email, member.getId(), profile.getScope(), departments, profile.isDepartmentAdmin(),
                new HashSet<>(profile.getCapabilities() == null ? List.of() : profile.getCapabilities()), profile.getName())
                .withDocMode(cfg.getDocAccessMode());
    }

    public boolean isRestricted() { return current().isRestricted(); }

    // ── facts ───────────────────────────────────────────────────────────────────

    public ProjectFacts facts(Project p) {
        List<String> involved = new ArrayList<>();
        if (p.getMemberEmails() != null) involved.addAll(p.getMemberEmails());
        if (p.getApproverEmails() != null) involved.addAll(p.getApproverEmails());
        if (p.getRoleAssignments() != null) involved.addAll(p.getRoleAssignments().values());
        return ProjectFacts.of(p.getId(), p.getVisibility(), p.getDepartmentIds(), involved, p.getCreatedBy());
    }

    public TaskFacts facts(Task t) {
        return TaskFacts.of(t.getProjectId(), t.getAssigneeIds(), t.getWatcherIds(), t.getCreatedBy());
    }

    // ── projects ────────────────────────────────────────────────────────────────

    public boolean canSeeProject(Project p) {
        AccessScope s = current();
        if (!s.isRestricted()) return true;
        if (p == null) return false;
        ProjectFacts f = facts(p);
        if (s.canSeeProject(f, false)) return true;
        return p.getId() != null && p.getOrganizationId() != null && hasLinkedTask(s, p.getOrganizationId(), p.getId());
    }

    public void requireProjectVisible(Project p) {
        if (!canSeeProject(p)) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Project not found");
    }

    public void requireCanEditProject(Project p) {
        requireProjectVisible(p);
        if (!current().canEditProject(facts(p))) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "You can't change this project.");
    }

    public void requireCanManageProject(Project p) {
        requireProjectVisible(p);
        if (!current().canManageProject(facts(p))) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Only the project's creator, a department admin of its departments, or a workspace admin can do that.");
    }

    public void requireCapability(String capability) {
        if (!current().has(capability)) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Your access profile doesn't allow this (" + capability + ").");
    }

    public List<Project> filterProjects(List<Project> projects) {
        AccessScope s = current();
        if (!s.isRestricted() || projects.isEmpty()) return projects;
        Set<String> linked = linkedProjectIds(s, projects.get(0).getOrganizationId());
        return projects.stream().filter(p -> s.canSeeProject(facts(p), linked.contains(p.getId()))).collect(Collectors.toList());
    }

    /** The projects a given scope may see, for code that is not running in the person's own request. */
    public List<Project> filterProjectsFor(AccessScope s, String org, List<Project> projects) {
        if (!s.isRestricted() || projects.isEmpty()) return projects;
        Set<String> linked = linkedProjectIds(s, org);
        return projects.stream().filter(p -> s.canSeeProject(facts(p), linked.contains(p.getId()))).collect(Collectors.toList());
    }

    /** Pages an already-filtered, already-ordered list. */
    public <T> Page<T> pageOf(List<T> all, Pageable pageable) {
        int from = (int) Math.min(pageable.getOffset(), all.size());
        int to = Math.min(from + pageable.getPageSize(), all.size());
        return new PageImpl<>(new ArrayList<>(all.subList(from, to)), pageable, all.size());
    }

    /** A copy of the project safe to send to this caller: money fields are removed unless they may see financials. */
    public Project redact(Project p) {
        if (p == null) return null;
        AccessScope s = current();
        if (!s.isRestricted() || s.has(CAP_VIEW_FINANCIALS)) return p;
        Project copy = new Project();
        BeanUtils.copyProperties(p, copy);
        copy.setBudget(null);
        copy.setSpent(null);
        copy.setExpenses(new ArrayList<>());
        copy.setExpectedRevenue(null);
        copy.setActualRevenue(null);
        copy.setLaborCost(null);
        copy.setTotalInvestment(null);
        copy.setRoiCategory(null);
        copy.setRevenueLog(new ArrayList<>());
        return copy;
    }

    public List<Project> redact(List<Project> list) { return list.stream().map(this::redact).collect(Collectors.toList()); }

    // ── documents ───────────────────────────────────────────────────────────────

    public DocFacts facts(Doc d) { return DocFacts.of(d.getCreatedBy(), d.getAudience(), d.getDepartmentIds(), d.getSharedWith()); }

    public boolean canSeeDoc(Doc d) { return d != null && current().canSeeDoc(facts(d)); }
    public boolean canEditDoc(Doc d) { return d != null && current().canEditDoc(facts(d)); }
    public boolean canManageDoc(Doc d) { return d != null && current().canManageDoc(facts(d)); }

    /** A doc the caller can't see is answered as not found, so its existence isn't revealed. */
    public void requireDocVisible(Doc d) {
        if (!canSeeDoc(d)) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Doc not found");
    }

    public void requireCanEditDoc(Doc d) {
        requireDocVisible(d);
        if (!canEditDoc(d)) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "You can view this document but not change it.");
    }

    public void requireCanManageDoc(Doc d) {
        requireDocVisible(d);
        if (!canManageDoc(d)) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Only the document's creator, or a department admin of its departments, can do that.");
    }

    public List<Doc> filterDocs(List<Doc> docs) {
        AccessScope s = current();
        if (!s.isRestricted()) return docs;
        return docs.stream().filter(d -> s.canSeeDoc(facts(d))).collect(Collectors.toList());
    }

    /**
     * Sets the audience, departments and sharing of a NEW document (workspace id must already be set). Does nothing while
     * access control is off, so existing workspaces are unaffected. {@code lenient}: a choice the caller may not make
     * (a copy of a workspace-wide doc, say) falls back to the default instead of being refused.
     */
    public void prepareNewDoc(Doc d, boolean lenient) {
        String org = d.getWorkspaceId();
        WorkspaceConfig cfg = org == null ? null : configRepository.findByWorkspaceId(org).orElse(null);
        if (cfg == null || !cfg.isAccessControlEnabled()) return;
        AccessScope s = current();
        String requested = normalizeAudience(d.getAudience());
        if ("?".equals(requested)) { if (lenient) requested = null; else throw bad("Audience must be PRIVATE, DEPARTMENTS or WORKSPACE."); }
        if (requested != null && !s.mayUseAudience(requested)) {
            if (lenient) requested = null;
            else throw new ResponseStatusException(HttpStatus.FORBIDDEN, AUD_WORKSPACE.equals(requested)
                    ? "Only a workspace admin can make a document visible to the whole workspace."
                    : "Documents aren't shared by department in this workspace.");
        }
        Set<String> known = departmentIdsOf(org);
        Set<String> depts = new LinkedHashSet<>(d.getDepartmentIds() == null ? List.of() : d.getDepartmentIds());
        depts.retainAll(known);
        if (s.isRestricted()) depts = new LinkedHashSet<>(s.attachableDepartments(depts));
        String aud = requested;
        if (aud == null) aud = (s.mayUseAudience(AUD_DEPARTMENTS) && !s.departmentIds().isEmpty()) ? AUD_DEPARTMENTS : AUD_PRIVATE;
        if (AUD_DEPARTMENTS.equals(aud) && depts.isEmpty()) depts.addAll(s.departmentIds());
        if (AUD_DEPARTMENTS.equals(aud) && depts.isEmpty()) aud = AUD_PRIVATE;     // nobody's department to put it in
        d.setAudience(aud);
        d.setDepartmentIds(new ArrayList<>(AUD_DEPARTMENTS.equals(aud) ? depts : Set.of()));
        d.setSharedWith(s.sharingEnabled() ? canonical(d.getSharedWith(), workspaceEmails(org), "shared with") : new ArrayList<>());
    }

    /** Replaces who a document is for. The caller must already be allowed to manage it. */
    public void applyDocAccessChange(Doc d, String audience, List<String> departmentIds, List<String> sharedWith) {
        AccessScope s = current();
        String org = d.getWorkspaceId();
        String aud = audience == null ? normalizeAudience(d.getAudience()) : normalizeAudience(audience);
        if (aud == null) aud = AUD_PRIVATE;
        if ("?".equals(aud)) throw bad("Audience must be PRIVATE, DEPARTMENTS or WORKSPACE.");
        if (!s.mayUseAudience(aud)) throw new ResponseStatusException(HttpStatus.FORBIDDEN, AUD_WORKSPACE.equals(aud)
                ? "Only a workspace admin can make a document visible to the whole workspace."
                : "Documents aren't shared by department in this workspace.");
        Set<String> depts = new LinkedHashSet<>(departmentIds == null ? (d.getDepartmentIds() == null ? List.of() : d.getDepartmentIds()) : departmentIds);
        depts.retainAll(departmentIdsOf(org));
        if (s.isRestricted()) {
            // may only add or remove their own departments; the others stay as they were
            Set<String> kept = new LinkedHashSet<>(d.getDepartmentIds() == null ? List.of() : d.getDepartmentIds());
            kept.removeAll(s.departmentIds());
            kept.addAll(s.attachableDepartments(depts));
            depts = kept;
        }
        if (AUD_DEPARTMENTS.equals(aud) && depts.isEmpty()) throw bad("Choose at least one department, or pick another audience.");
        d.setAudience(aud);
        d.setDepartmentIds(new ArrayList<>(AUD_DEPARTMENTS.equals(aud) ? depts : Set.of()));
        List<String> shared = sharedWith == null ? d.getSharedWith() : sharedWith;
        d.setSharedWith(s.sharingEnabled() ? canonical(shared, workspaceEmails(org), "shared with") : new ArrayList<>());
    }

    // ── tasks ───────────────────────────────────────────────────────────────────

    public boolean canSeeTask(Task t) {
        AccessScope s = current();
        if (!s.isRestricted()) return true;
        if (t == null) return false;
        ProjectFacts pf = null;
        if (t.getProjectId() != null && !t.getProjectId().isBlank()) {
            pf = projectRepository.findById(t.getProjectId()).map(this::facts).orElse(null);
        }
        return s.canSeeTask(facts(t), pf);
    }

    public void requireTaskVisible(Task t) {
        if (!canSeeTask(t)) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Task not found");
    }

    /**
     * Answers "may the caller see this task / project?" for many items (notifications, activity entries)
     * without a database round trip each time: projects are loaded once, answers are remembered.
     */
    public EntityVisibility entityVisibility() { return new EntityVisibility(current(), workspaceContext.getWorkspaceId()); }

    public final class EntityVisibility {
        private final AccessScope scope;
        private final String org;
        private Map<String, ProjectFacts> projects;
        private Set<String> linked;
        private final Map<String, Boolean> answers = new HashMap<>();

        private EntityVisibility(AccessScope scope, String org) { this.scope = scope; this.org = org; }

        public boolean restricted() { return scope.isRestricted(); }

        /** TASK and PROJECT only; any other kind of entity is hidden from restricted callers. */
        public boolean canSee(String entityType, String entityId) {
            if (!scope.isRestricted()) return true;
            if (entityType == null || entityId == null || entityId.isBlank()) return false;
            String type = entityType.trim().toUpperCase(Locale.ROOT);
            return answers.computeIfAbsent(type + ":" + entityId, k -> compute(type, entityId));
        }

        private boolean compute(String type, String id) {
            if (projects == null) {
                projects = new HashMap<>();
                projectRepository.findByOrganizationId(org).forEach(p -> projects.put(p.getId(), facts(p)));
                linked = linkedProjectIds(scope, org);
            }
            if ("PROJECT".equals(type)) {
                ProjectFacts pf = projects.get(id);
                return pf != null && scope.canSeeProject(pf, linked.contains(id));
            }
            if ("DOC".equals(type)) {
                Doc d = mongoTemplate.findById(id, Doc.class);
                if (d == null || d.isDeleted() || !org.equals(d.getWorkspaceId())) return false;
                return scope.canSeeDoc(facts(d));
            }
            if ("TASK".equals(type)) {
                Task t = mongoTemplate.findById(id, Task.class);
                if (t == null || !org.equals(t.getOrganizationId())) return false;
                ProjectFacts pf = t.getProjectId() == null ? null : projects.get(t.getProjectId());
                return scope.canSeeTask(facts(t), pf);
            }
            return false;
        }
    }

    /** Tasks from an arbitrary list that the caller may see (workspace-checked, project facts loaded once). */
    public List<Task> filterTasks(List<Task> tasks) {
        AccessScope s = current();
        if (!s.isRestricted()) return tasks;
        String org = workspaceContext.getWorkspaceId();
        Map<String, ProjectFacts> pf = new HashMap<>();
        projectRepository.findByOrganizationId(org).forEach(p -> pf.put(p.getId(), facts(p)));
        return tasks.stream().filter(t -> org != null && org.equals(t.getOrganizationId()))
                .filter(t -> s.canSeeTask(facts(t), t.getProjectId() == null ? null : pf.get(t.getProjectId())))
                .collect(Collectors.toList());
    }

    /** Deleting is for the task's creator or someone who manages its project. */
    public void requireCanDeleteTask(Task t) {
        AccessScope s = current();
        if (!s.isRestricted()) return;
        if (!s.email().isEmpty() && s.email().equals(norm(t.getCreatedBy()))) return;
        ProjectFacts pf = (t.getProjectId() == null || t.getProjectId().isBlank()) ? null
                : projectRepository.findById(t.getProjectId()).map(this::facts).orElse(null);
        if (pf != null && s.canManageProject(pf)) return;
        throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Only the task's creator or a manager of its project can delete it.");
    }

    /** All tasks the caller may see, filtered in the database. Only used for restricted callers. */
    public List<Task> visibleTasks(String org, String status, String projectId) {
        return mongoTemplate.find(taskQuery(org, status, projectId), Task.class);
    }

    public Page<Task> visibleTasksPage(String org, String status, String projectId, Pageable pageable) {
        Query q = taskQuery(org, status, projectId);
        long total = mongoTemplate.count(Query.of(q).limit(-1).skip(-1), Task.class);
        List<Task> list = mongoTemplate.find(Query.of(q).with(pageable), Task.class);
        return PageableExecutionUtils.getPage(list, pageable, () -> total);
    }

    private Query taskQuery(String org, String status, String projectId) {
        AccessScope s = current();
        List<Criteria> and = new ArrayList<>();
        and.add(Criteria.where("organizationId").is(org));
        if (status != null && !status.isBlank()) and.add(Criteria.where("status").is(status.toUpperCase(Locale.ROOT)));
        if (projectId != null && !projectId.isBlank()) and.add(Criteria.where("projectId").is(projectId));
        List<Criteria> or = new ArrayList<>(mineCriteria(s));
        Set<String> ruleVisible = ruleVisibleProjectIds(s, org);
        if (!ruleVisible.isEmpty()) or.add(Criteria.where("projectId").in(ruleVisible));
        and.add(new Criteria().orOperator(or.toArray(new Criteria[0])));
        return new Query(new Criteria().andOperator(and.toArray(new Criteria[0])));
    }

    /** Tasks the caller is personally linked to: assignee, watcher or creator. */
    private List<Criteria> mineCriteria(AccessScope s) {
        String memberId = s.memberId() == null || s.memberId().isBlank() ? NONE : s.memberId();
        String email = s.email().isEmpty() ? NONE : s.email();
        String exactCi = "^" + Pattern.quote(email) + "$";
        List<Criteria> or = new ArrayList<>();
        or.add(Criteria.where("assigneeIds").is(memberId));
        or.add(Criteria.where("watcherIds").regex(exactCi, "i"));
        or.add(Criteria.where("createdBy").regex(exactCi, "i"));
        return or;
    }

    private boolean hasLinkedTask(AccessScope s, String org, String projectId) {
        Criteria base = new Criteria().andOperator(
                Criteria.where("organizationId").is(org),
                Criteria.where("projectId").is(projectId),
                new Criteria().orOperator(mineCriteria(s).toArray(new Criteria[0])));
        return mongoTemplate.exists(new Query(base), Task.class);
    }

    private Set<String> linkedProjectIds(AccessScope s, String org) {
        Criteria base = new Criteria().andOperator(
                Criteria.where("organizationId").is(org),
                Criteria.where("projectId").ne(null),
                new Criteria().orOperator(mineCriteria(s).toArray(new Criteria[0])));
        return new HashSet<>(mongoTemplate.findDistinct(new Query(base), "projectId", Task.class, String.class));
    }

    /** Projects the caller can see by the project's own settings (department / named), without personal task links. */
    private Set<String> ruleVisibleProjectIds(AccessScope s, String org) {
        if (MODE_ASSIGNED.equals(s.mode())) return Set.of();
        return projectRepository.findByOrganizationId(org).stream()
                .filter(p -> s.canSeeProject(facts(p), false)).map(Project::getId).collect(Collectors.toSet());
    }

    // ── creating / changing projects ────────────────────────────────────────────

    /** Validates and normalises the access fields of a NEW project for this caller. Throws a 4xx on a bad request. */
    public void prepareNewProject(Project p) {
        AccessScope s = current();
        String org = p.getOrganizationId();
        WorkspaceConfig cfg = org == null ? null : configRepository.findByWorkspaceId(org).orElse(null);
        if (s.isRestricted()) requireCapability(CAP_CREATE_PROJECT);

        String requested = p.getVisibility();
        String vis;
        if (requested == null || requested.isBlank()) {
            vis = s.isRestricted() ? VIS_DEPARTMENTS
                    : (cfg != null && cfg.isAccessControlEnabled() ? orWorkspace(normalizeVisibility(cfg.getDefaultProjectVisibility())) : VIS_WORKSPACE);
        } else {
            vis = normalizeVisibility(requested);
            if (vis == null) throw bad("Visibility must be WORKSPACE, DEPARTMENTS or MEMBERS_ONLY.");
        }
        if (!s.mayUseVisibility(vis)) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Only a workspace admin can make a project visible to the whole workspace.");

        Set<String> known = departmentIdsOf(org);
        Set<String> depts = new LinkedHashSet<>();
        if (p.getDepartmentIds() != null) depts.addAll(p.getDepartmentIds());
        depts.retainAll(known);
        if (s.isRestricted()) depts = new LinkedHashSet<>(s.attachableDepartments(depts));
        if (VIS_DEPARTMENTS.equals(vis) && depts.isEmpty() && s.isRestricted()) depts.addAll(s.departmentIds());
        if (VIS_DEPARTMENTS.equals(vis) && depts.isEmpty()) {
            if (s.isRestricted()) vis = VIS_MEMBERS;   // a caller with no department can only create a members-only project
            else throw bad("Choose at least one department, or pick another visibility.");
        }
        p.setVisibility(vis);
        p.setDepartmentIds(new ArrayList<>(depts));
        applyPeople(p, org, p.getMemberEmails(), p.getApproverEmails(), p.getRoleAssignments(), cfg);
    }

    /** Replaces the access settings of an existing project. The caller must already be allowed to manage it. */
    public void applyAccessChange(Project p, String visibility, List<String> departmentIds,
                                  List<String> memberEmails, Map<String, String> roles, List<String> approvers) {
        AccessScope s = current();
        String org = p.getOrganizationId();
        WorkspaceConfig cfg = org == null ? null : configRepository.findByWorkspaceId(org).orElse(null);
        String vis = visibility == null ? orWorkspace(normalizeVisibility(p.getVisibility())) : normalizeVisibility(visibility);
        if (vis == null) throw bad("Visibility must be WORKSPACE, DEPARTMENTS or MEMBERS_ONLY.");
        if (!s.mayUseVisibility(vis)) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Only a workspace admin can make a project visible to the whole workspace.");

        Set<String> known = departmentIdsOf(org);
        Set<String> depts = new LinkedHashSet<>(departmentIds == null ? p.getDepartmentIds() : departmentIds);
        depts.retainAll(known);
        if (s.isRestricted()) {
            // a department admin may only add or remove their own departments; others stay as they were
            Set<String> kept = new LinkedHashSet<>(p.getDepartmentIds() == null ? List.of() : p.getDepartmentIds());
            kept.removeAll(s.departmentIds());
            kept.addAll(s.attachableDepartments(depts));
            depts = kept;
        }
        if (VIS_DEPARTMENTS.equals(vis) && depts.isEmpty()) throw bad("Choose at least one department, or pick another visibility.");
        p.setVisibility(vis);
        p.setDepartmentIds(new ArrayList<>(depts));
        applyPeople(p, org,
                memberEmails == null ? p.getMemberEmails() : memberEmails,
                approvers == null ? p.getApproverEmails() : approvers,
                roles == null ? p.getRoleAssignments() : roles, cfg);
    }

    private void applyPeople(Project p, String org, List<String> members, List<String> approvers, Map<String, String> roles, WorkspaceConfig cfg) {
        Map<String, String> emailByLower = workspaceEmails(org);
        p.setMemberEmails(canonical(members, emailByLower, "member"));
        p.setApproverEmails(canonical(approvers, emailByLower, "approver"));
        Map<String, String> out = new LinkedHashMap<>();
        Set<String> slotKeys = new HashSet<>();
        if (cfg != null && cfg.getProjectRoleSlots() != null) cfg.getProjectRoleSlots().forEach(sl -> slotKeys.add(sl.getKey()));
        if (roles != null) {
            for (Map.Entry<String, String> e : roles.entrySet()) {
                if (e.getValue() == null || e.getValue().isBlank()) continue;
                if (!slotKeys.contains(e.getKey())) throw bad("Unknown project role: " + e.getKey());
                String canon = emailByLower.get(norm(e.getValue()));
                if (canon == null) throw bad("Not a member of this workspace: " + e.getValue());
                out.put(e.getKey(), canon);
            }
        }
        p.setRoleAssignments(out);
    }

    private List<String> canonical(List<String> emails, Map<String, String> emailByLower, String what) {
        List<String> out = new ArrayList<>();
        if (emails == null) return out;
        for (String e : emails) {
            if (e == null || e.isBlank()) continue;
            String canon = emailByLower.get(norm(e));
            if (canon == null) throw bad("Not a member of this workspace (" + what + "): " + e);
            if (!out.contains(canon)) out.add(canon);
        }
        return out;
    }

    private Map<String, String> workspaceEmails(String org) {
        Map<String, String> m = new HashMap<>();
        teamMemberRepository.findByOrganizationId(org).forEach(t -> { if (t.getEmail() != null) m.put(norm(t.getEmail()), t.getEmail()); });
        workspaceRepository.findById(org).ifPresent(w -> { if (w.getOwnerEmail() != null) m.put(norm(w.getOwnerEmail()), w.getOwnerEmail()); });
        return m;
    }

    public Set<String> departmentIdsOf(String org) {
        return groupRepository.findByOrganizationIdAndType(org, GROUP_DEPARTMENT).stream().map(UserGroup::getId).collect(Collectors.toSet());
    }

    private static String orWorkspace(String v) { return v == null ? VIS_WORKSPACE : v; }

    private static ResponseStatusException bad(String msg) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, msg); }

    // ── what the browser needs to know about itself ─────────────────────────────

    /** Departments and project roles, for the project access dialog. Names only: safe for every member to read. */
    public Map<String, Object> options() {
        String org = workspaceContext.getWorkspaceId();
        Map<String, Object> m = new LinkedHashMap<>();
        List<Map<String, Object>> depts = new ArrayList<>();
        for (UserGroup g : groupRepository.findByOrganizationIdAndType(org, GROUP_DEPARTMENT)) {
            Map<String, Object> d = new LinkedHashMap<>();
            d.put("id", g.getId());
            d.put("name", g.getName());
            d.put("color", g.getColor());
            depts.add(d);
        }
        m.put("departments", depts);
        WorkspaceConfig cfg = configRepository.findByWorkspaceId(org).orElse(null);
        m.put("roleSlots", cfg == null || cfg.getProjectRoleSlots() == null ? List.of() : cfg.getProjectRoleSlots());
        m.put("docAccessMode", cfg == null ? DOC_MODE_BOTH : normalizeDocMode(cfg.getDocAccessMode()));
        return m;
    }

    public Map<String, Object> describeCurrent() {
        AccessScope s = current();
        Map<String, Object> m = new LinkedHashMap<>();
        boolean enabled = false;
        try {
            String org = workspaceContext.getWorkspaceId();
            enabled = org != null && configRepository.findByWorkspaceId(org).map(WorkspaceConfig::isAccessControlEnabled).orElse(false);
        } catch (RuntimeException ignored) { /* not in a request */ }
        m.put("accessControlEnabled", enabled);
        m.put("docAccessMode", s.docMode());
        m.put("restricted", s.isRestricted());
        m.put("mode", s.mode());
        m.put("profileName", s.profileName());
        m.put("departmentIds", s.departmentIds());
        m.put("departmentAdmin", s.isDepartmentAdmin());
        m.put("capabilities", s.isRestricted() ? s.capabilities() : ALL_CAPABILITIES);
        // Pages the restricted caller can use in this phase (everything else is refused by the API).
        List<String> areas = new ArrayList<>(List.of("dashboard", "projects", "tasks", "team", "gantt", "notifications", "activity", "search", "docs"));
        if (s.has(CAP_USE_MEETING_ASSISTANT)) areas.add("meeting-assistant");
        m.put("allowedAreas", s.isRestricted() ? areas : null);
        return m;
    }
}

package com.prowosma.backend.service;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.Project;
import com.prowosma.backend.repository.GoalRepository;
import com.prowosma.backend.repository.ProjectRepository;
import com.prowosma.backend.repository.TaskRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;

@Service
@RequiredArgsConstructor
public class ProjectService {

    private final ProjectRepository projectRepository;
    private final TaskRepository taskRepository;
    private final GoalRepository goalRepository;
    private final ActivityLogService activityLogService;
    private final NotificationService notificationService;
    private final RealtimeService realtimeService;
    private final WorkspaceContext workspaceContext;
    private final VisibilityService visibility;

    public List<Project> getAll() {
        return visibility.filterProjects(projectRepository.findByOrganizationId(workspaceContext.getWorkspaceId()));
    }

    /** One page of the caller's projects, newest first. Unrestricted callers get exactly the database page they always did. */
    public org.springframework.data.domain.Page<Project> getAllPaged(org.springframework.data.domain.PageRequest pr, String status) {
        String orgId = workspaceContext.getWorkspaceId();
        if (!visibility.isRestricted()) {
            return (status != null && !status.isBlank())
                    ? projectRepository.findByOrganizationIdAndStatus(orgId, status.toUpperCase(), pr)
                    : projectRepository.findByOrganizationId(orgId, pr);
        }
        List<Project> mine = visibility.filterProjects(projectRepository.findByOrganizationId(orgId)).stream()
                .filter(p -> status == null || status.isBlank() || status.equalsIgnoreCase(p.getStatus()))
                .sorted(java.util.Comparator.comparing(Project::getCreatedAt, java.util.Comparator.nullsLast(java.util.Comparator.reverseOrder())))
                .collect(java.util.stream.Collectors.toList());
        return visibility.pageOf(mine, pr);
    }

    public Project getById(String id) {
        Project p = projectRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Project not found"));
        visibility.requireProjectVisible(p);
        return p;
    }

    public Project create(Project project) {
        project.setCreatedAt(LocalDateTime.now());
        project.setUpdatedAt(LocalDateTime.now());
        project.setOrganizationId(workspaceContext.getWorkspaceId());
        if (project.getCreatedBy() == null) {
            try {
                var auth = org.springframework.security.core.context
                        .SecurityContextHolder.getContext().getAuthentication();
                if (auth != null) project.setCreatedBy(auth.getName());
            } catch (Exception ignored) {}
        }
        visibility.prepareNewProject(project);
        // The team (roles, allocation) is only set through updateTeam(), which validates it.
        project.setTeamDetails(new java.util.ArrayList<>());
        Project saved = projectRepository.save(project);
        activityLogService.logFull("PROJECT", saved.getId(), saved.getName(),
                "PROJECT_CREATED", null, saved.getName(), null,
                saved.getId(), null, null);
        notificationService.create("Project Created", "New project: " + saved.getName(),
                "SUCCESS", "PROJECT", saved.getId());
        realtimeService.broadcast(workspaceContext.getWorkspaceId(), "PROJECT_CREATED",
                "PROJECT", saved.getId(), saved.getName(), null,
                "New project created: " + saved.getName());
        return saved;
    }

    public Project update(String id, Project updated) {
        Project existing = getById(id);
        visibility.requireCanEditProject(existing);
        String oldName   = existing.getName();
        String oldStatus = existing.getStatus();
        LocalDateTime oldDue = existing.getDueDate();

        existing.setName(updated.getName());
        existing.setDescription(updated.getDescription());
        existing.setColor(updated.getColor());
        existing.setStatus(updated.getStatus());
        existing.setCategory(updated.getCategory());
        existing.setDueDate(updated.getDueDate());
        existing.setUpdatedAt(LocalDateTime.now());
        Project saved = projectRepository.save(existing);

        // Granular events
        if (oldDue != null && updated.getDueDate() != null && !oldDue.equals(updated.getDueDate())) {
            activityLogService.logFull("PROJECT", saved.getId(), saved.getName(),
                    "PROJECT_DEADLINE_CHANGED",
                    oldDue.toLocalDate().toString(),
                    updated.getDueDate().toLocalDate().toString(),
                    null, saved.getId(), null, null);
        } else if (!oldStatus.equals(saved.getStatus())) {
            activityLogService.logFull("PROJECT", saved.getId(), saved.getName(),
                    "PROJECT_STATUS_CHANGED", oldStatus, saved.getStatus(), null,
                    saved.getId(), null, null);
        } else {
            activityLogService.logFull("PROJECT", saved.getId(), saved.getName(),
                    "PROJECT_UPDATED", oldName, saved.getName(), null,
                    saved.getId(), null, null);
        }

        notificationService.create("Project Updated", "Updated: " + saved.getName(),
                "SUCCESS", "PROJECT", saved.getId());
        realtimeService.broadcast(workspaceContext.getWorkspaceId(), "PROJECT_UPDATED",
                "PROJECT", saved.getId(), saved.getName(), null,
                "Project updated: " + saved.getName());
        return saved;
    }

    /** Changes who can see the project and who is named on it. Separate from update(), which never touches these fields. */
    public Project updateAccess(String id, String visibilityValue, List<String> departmentIds,
                                List<String> memberEmails, java.util.Map<String, String> roles, List<String> approvers) {
        Project existing = getById(id);
        visibility.requireCanManageProject(existing);
        visibility.applyAccessChange(existing, visibilityValue, departmentIds, memberEmails, roles, approvers);
        existing.setTeamDetails(pruneTeamDetails(existing.getMemberEmails(), existing.getTeamDetails()));
        existing.setUpdatedAt(LocalDateTime.now());
        Project saved = projectRepository.save(existing);
        activityLogService.logFull("PROJECT", saved.getId(), saved.getName(),
                "PROJECT_ACCESS_CHANGED", null, saved.getVisibility(), null,
                saved.getId(), null, null);
        return saved;
    }

    public void delete(String id) {
        Project project = getById(id);
        visibility.requireCanManageProject(project);
        activityLogService.logFull("PROJECT", id, project.getName(),
                "PROJECT_DELETED", project.getName(), null, null,
                id, null, null);
        notificationService.create("Project Deleted", "Deleted: " + project.getName(),
                "WARNING", "PROJECT", project.getId());
        realtimeService.broadcast(workspaceContext.getWorkspaceId(), "PROJECT_DELETED",
                "PROJECT", id, project.getName(), null,
                "Project deleted: " + project.getName());
        projectRepository.deleteById(id);
    }

    public List<Project> getSubProjects(String parentId) {
        String org = workspaceContext.getWorkspaceId();
        return visibility.filterProjects(projectRepository.findByParentProjectId(parentId).stream()
                .filter(p -> org != null && org.equals(p.getOrganizationId())).collect(java.util.stream.Collectors.toList()));
    }

    public List<Project> getRootProjects() {
        String org = workspaceContext.getWorkspaceId();
        return visibility.filterProjects(projectRepository.findByParentProjectIdIsNull().stream()
                .filter(p -> org != null && org.equals(p.getOrganizationId())).collect(java.util.stream.Collectors.toList()));
    }

    public int getProgress(String id) {
        getById(id); // existence + visibility; progress of a project the caller can't see is not theirs to learn
        var tasks       = taskRepository.findByProjectId(id);
        var subProjects = projectRepository.findByParentProjectId(id);
        int total = tasks.size();
        long done = tasks.stream().filter(t -> "DONE".equals(t.getStatus())).count();
        for (Project sub : subProjects) {
            var subTasks = taskRepository.findByProjectId(sub.getId());
            total += subTasks.size();
            done  += subTasks.stream().filter(t -> "DONE".equals(t.getStatus())).count();
        }
        return total == 0 ? 0 : (int)((done * 100) / total);
    }

    public void syncGoalProgress(String projectId) {
        Project project = getById(projectId);
        if (project.getLinkedGoalId() == null) return;
        goalRepository.findById(project.getLinkedGoalId()).ifPresent(goal -> {
            int progress = getProgress(projectId);
            goal.setProgress(Math.min(100, Math.max(goal.getProgress(), progress)));
            if (goal.getProgress() == 100) goal.setStatus("ACHIEVED");
            goal.setUpdatedAt(LocalDateTime.now());
            goalRepository.save(goal);
        });
    }

    // ── Budget tracking ───────────────────────────────────────────

    public Project addExpense(String id, java.util.Map<String, Object> body, String author) {
        Project p = getById(id);
        com.prowosma.backend.model.Project.BudgetEntry entry =
            new com.prowosma.backend.model.Project.BudgetEntry();
        entry.setDescription((String) body.getOrDefault("description", ""));
        entry.setAmount(((Number) body.getOrDefault("amount", 0)).doubleValue());
        entry.setCategory((String) body.getOrDefault("category", "OTHER"));
        entry.setAddedBy(author);
        if (p.getExpenses() == null) p.setExpenses(new java.util.ArrayList<>());
        p.getExpenses().add(entry);
        // Recalculate spent
        double total = p.getExpenses().stream().mapToDouble(
            com.prowosma.backend.model.Project.BudgetEntry::getAmount).sum();
        p.setSpent(total);
        p.setUpdatedAt(java.time.LocalDateTime.now());
        return projectRepository.save(p);
    }

    public Project deleteExpense(String projectId, String expenseId) {
        Project p = getById(projectId);
        if (p.getExpenses() != null)
            p.getExpenses().removeIf(e -> expenseId.equals(e.getId()));
        double total = p.getExpenses() != null
            ? p.getExpenses().stream().mapToDouble(
                com.prowosma.backend.model.Project.BudgetEntry::getAmount).sum()
            : 0;
        p.setSpent(total);
        return projectRepository.save(p);
    }

    public Project updateBudget(String id, java.util.Map<String, Object> body) {
        Project p = getById(id);
        if (body.containsKey("budget"))
            p.setBudget(((Number) body.get("budget")).doubleValue());
        if (body.containsKey("currency"))
            p.setCurrency((String) body.get("currency"));
        p.setUpdatedAt(java.time.LocalDateTime.now());
        return projectRepository.save(p);
    }


    // ── ROI Engine ────────────────────────────────────────────

    public com.prowosma.backend.model.Project addRevenue(String id, java.util.Map<String, Object> body) {
        com.prowosma.backend.model.Project p = getById(id);
        com.prowosma.backend.model.Project.RevenueEntry entry =
            new com.prowosma.backend.model.Project.RevenueEntry();
        entry.setDescription((String) body.getOrDefault("description", ""));
        entry.setAmount(((Number) body.getOrDefault("amount", 0)).doubleValue());
        entry.setType((String) body.getOrDefault("type", "DIRECT"));
        if (p.getRevenueLog() == null) p.setRevenueLog(new java.util.ArrayList<>());
        p.getRevenueLog().add(entry);
        double total = p.getRevenueLog().stream().mapToDouble(
            com.prowosma.backend.model.Project.RevenueEntry::getAmount).sum();
        p.setActualRevenue(total);
        p.setUpdatedAt(java.time.LocalDateTime.now());
        return projectRepository.save(p);
    }

    public com.prowosma.backend.model.Project updateRoiSettings(String id, java.util.Map<String, Object> body) {
        com.prowosma.backend.model.Project p = getById(id);
        if (body.containsKey("expectedRevenue"))
            p.setExpectedRevenue(((Number) body.get("expectedRevenue")).doubleValue());
        if (body.containsKey("laborCost"))
            p.setLaborCost(((Number) body.get("laborCost")).doubleValue());
        if (body.containsKey("roiCategory"))
            p.setRoiCategory((String) body.get("roiCategory"));
        p.setUpdatedAt(java.time.LocalDateTime.now());
        return projectRepository.save(p);
    }

    public java.util.Map<String, Object> calculateRoi(String id) {
        com.prowosma.backend.model.Project p = getById(id);
        double spent        = p.getSpent()           != null ? p.getSpent()           : 0;
        double laborCost    = p.getLaborCost()        != null ? p.getLaborCost()       : 0;
        double budget       = p.getBudget()           != null ? p.getBudget()          : 0;
        double actualRev    = p.getActualRevenue()    != null ? p.getActualRevenue()   : 0;
        double expectedRev  = p.getExpectedRevenue()  != null ? p.getExpectedRevenue() : 0;
        double totalInvest  = spent + laborCost;
        double roi          = totalInvest > 0 ? ((actualRev - totalInvest) / totalInvest) * 100 : 0;
        double projectedRoi = totalInvest > 0 ? ((expectedRev - totalInvest) / totalInvest) * 100 : 0;
        double paybackMonths= actualRev > 0 ? (totalInvest / (actualRev / 12)) : -1;
        String health = roi >= 50 ? "EXCELLENT" : roi >= 20 ? "GOOD" : roi >= 0 ? "BREAK_EVEN" : "NEGATIVE";

        java.util.Map<String, Object> result = new java.util.LinkedHashMap<>();
        result.put("projectId",     id);
        result.put("projectName",   p.getName());
        result.put("budget",        budget);
        result.put("spent",         spent);
        result.put("laborCost",     laborCost);
        result.put("totalInvestment", totalInvest);
        result.put("actualRevenue", actualRev);
        result.put("expectedRevenue", expectedRev);
        result.put("roi",           Math.round(roi * 10.0) / 10.0);
        result.put("projectedRoi",  Math.round(projectedRoi * 10.0) / 10.0);
        result.put("paybackMonths", paybackMonths > 0 ? Math.round(paybackMonths * 10.0) / 10.0 : "N/A");
        result.put("roiHealth",     health);
        result.put("category",      p.getRoiCategory());
        result.put("revenueLog",    p.getRevenueLog() != null ? p.getRevenueLog() : java.util.List.of());
        return result;
    }

    public java.util.Map<String, Object> getPortfolioRoi() {
        String orgId = workspaceContext.getWorkspaceId();
        java.util.List<com.prowosma.backend.model.Project> projects = visibility.filterProjects(projectRepository.findByOrganizationId(orgId));
        double totalInvest = 0, totalRevenue = 0, totalBudget = 0;
        int positiveRoi = 0;
        java.util.List<java.util.Map<String, Object>> breakdown = new java.util.ArrayList<>();
        for (com.prowosma.backend.model.Project p : projects) {
            java.util.Map<String, Object> roi = calculateRoi(p.getId());
            double inv = ((Number) roi.get("totalInvestment")).doubleValue();
            double rev = ((Number) roi.get("actualRevenue")).doubleValue();
            double bud = ((Number) roi.get("budget")).doubleValue();
            totalInvest  += inv;
            totalRevenue += rev;
            totalBudget  += bud;
            if (((Number) roi.get("roi")).doubleValue() > 0) positiveRoi++;
            breakdown.add(java.util.Map.of(
                "name", p.getName(), "roi", roi.get("roi"),
                "health", roi.get("roiHealth"), "category", roi.getOrDefault("category","—")));
        }
        double portfolioRoi = totalInvest > 0
            ? Math.round(((totalRevenue - totalInvest) / totalInvest) * 1000.0) / 10.0 : 0;
        return java.util.Map.of(
            "totalInvestment", totalInvest, "totalRevenue", totalRevenue,
            "totalBudget", totalBudget, "portfolioRoi", portfolioRoi,
            "positiveRoiProjects", positiveRoi, "totalProjects", projects.size(),
            "breakdown", breakdown);
    }


    /**
     * Sets who is on the project team, with each person's project role and allocation. Body entries:
     * { email, projectRole, allocationPercent }. The emails become memberEmails (so team members can see a
     * members-only project); same permission as changing access.
     */
    public Project updateTeam(String id, List<java.util.Map<String, Object>> members, String requesterEmail) {
        Project existing = getById(id);
        visibility.requireCanManageProject(existing);
        List<java.util.Map<String, Object>> rows = members == null ? List.of() : members;
        if (rows.size() > 500) throw new org.springframework.web.server.ResponseStatusException(
                org.springframework.http.HttpStatus.BAD_REQUEST, "A project team can have at most 500 people.");
        List<String> emails = new java.util.ArrayList<>();
        for (java.util.Map<String, Object> r : rows) {
            Object e = r == null ? null : r.get("email");
            if (e instanceof String str && !str.isBlank()) emails.add(str.trim());
        }
        // Canonicalises the emails and rejects anyone who isn't in the workspace.
        visibility.applyAccessChange(existing, null, null, emails, null, null);

        java.util.Map<String, Project.TeamEntry> before = new java.util.HashMap<>();
        if (existing.getTeamDetails() != null)
            for (Project.TeamEntry t : existing.getTeamDetails())
                if (t.getEmail() != null) before.put(t.getEmail().toLowerCase(), t);

        java.util.Map<String, java.util.Map<String, Object>> input = new java.util.HashMap<>();
        for (java.util.Map<String, Object> r : rows)
            if (r != null && r.get("email") instanceof String str) input.put(str.trim().toLowerCase(), r);

        List<Project.TeamEntry> details = new java.util.ArrayList<>();
        for (String email : existing.getMemberEmails()) {
            String key = email.toLowerCase();
            Project.TeamEntry t = before.getOrDefault(key, null);
            if (t == null) {
                t = new Project.TeamEntry();
                t.setEmail(email);
                t.setAddedBy(requesterEmail);
            }
            t.setEmail(email);
            java.util.Map<String, Object> r = input.get(key);
            if (r != null) {
                t.setProjectRole(cleanRole(r.get("projectRole")));
                t.setAllocationPercent(cleanAllocation(r.get("allocationPercent")));
            }
            details.add(t);
        }
        existing.setTeamDetails(details);
        existing.setUpdatedAt(LocalDateTime.now());
        Project saved = projectRepository.save(existing);
        activityLogService.logFull("PROJECT", saved.getId(), saved.getName(),
                "PROJECT_TEAM_CHANGED", null, String.valueOf(details.size()), null,
                saved.getId(), null, null);
        return saved;
    }

    /** Team details for people still in memberEmails, in memberEmails order. */
    static List<Project.TeamEntry> pruneTeamDetails(List<String> memberEmails, List<Project.TeamEntry> details) {
        List<Project.TeamEntry> out = new java.util.ArrayList<>();
        if (memberEmails == null || details == null) return out;
        java.util.Map<String, Project.TeamEntry> byEmail = new java.util.HashMap<>();
        for (Project.TeamEntry t : details) if (t != null && t.getEmail() != null) byEmail.putIfAbsent(t.getEmail().toLowerCase(), t);
        for (String e : memberEmails) {
            Project.TeamEntry t = e == null ? null : byEmail.get(e.toLowerCase());
            if (t != null) out.add(t);
        }
        return out;
    }

    static String cleanRole(Object raw) {
        if (!(raw instanceof String s)) return null;
        String t = s.trim();
        if (t.isEmpty()) return null;
        return t.length() > 60 ? t.substring(0, 60) : t;
    }

    static Integer cleanAllocation(Object raw) {
        if (!(raw instanceof Number n)) return null;
        int v = (int) Math.round(n.doubleValue());
        return Math.max(0, Math.min(100, v));
    }
}

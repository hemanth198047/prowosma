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

    public List<Project> getAll() {
        return projectRepository.findByOrganizationId(workspaceContext.getWorkspaceId());
    }

    public Project getById(String id) {
        return projectRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Project not found"));
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

    public void delete(String id) {
        Project project = getById(id);
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
        return projectRepository.findByParentProjectId(parentId);
    }

    public List<Project> getRootProjects() {
        return projectRepository.findByParentProjectIdIsNull();
    }

    public int getProgress(String id) {
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
        java.util.List<com.prowosma.backend.model.Project> projects = projectRepository.findByOrganizationId(orgId);
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

}

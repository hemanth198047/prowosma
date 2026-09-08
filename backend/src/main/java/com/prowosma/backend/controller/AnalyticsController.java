package com.prowosma.backend.controller;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.ActivityLog;
import com.prowosma.backend.model.Goal;
import com.prowosma.backend.model.Project;
import com.prowosma.backend.model.Task;
import com.prowosma.backend.repository.*;
import com.prowosma.backend.service.ProjectService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/analytics")
@RequiredArgsConstructor
public class AnalyticsController {

    private final TaskRepository        taskRepository;
    private final ProjectRepository     projectRepository;
    private final GoalRepository        goalRepository;
    private final TeamMemberRepository  teamMemberRepository;
    private final ActivityLogRepository activityLogRepository;
    private final ProjectService        projectService;
    private final WorkspaceContext      workspaceContext;

    // ── Main analytics endpoint ────────────────────────────────
    @GetMapping
    public Map<String, Object> getAll() {
        String orgId = workspaceContext.getWorkspaceId();
        List<Task>    tasks    = taskRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();
        List<Project> projects = projectRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();
        List<Goal>    goals    = goalRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();
        LocalDateTime now      = LocalDateTime.now();

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("kpis",          buildKpis(tasks, projects, goals, now));
        result.put("velocity",      buildVelocity(orgId, now));
        result.put("burndown",      buildBurndown(tasks, now));
        result.put("capacity",      buildCapacity(tasks, orgId));
        result.put("projectHealth", buildProjectHealth(tasks, projects, now));
        result.put("tasksByStatus", buildTasksByStatus(tasks));
        result.put("tasksByPriority", buildTasksByPriority(tasks));
        result.put("completionTrend", buildCompletionTrend(orgId, now));
        return result;
    }

    // ── KPI cards ──────────────────────────────────────────────
    private Map<String, Object> buildKpis(List<Task> tasks, List<Project> projects,
                                           List<Goal> goals, LocalDateTime now) {
        long total      = tasks.size();
        long done       = tasks.stream().filter(t -> "DONE".equals(t.getStatus())).count();
        long inProgress = tasks.stream().filter(t -> "IN_PROGRESS".equals(t.getStatus())).count();
        long overdue    = tasks.stream()
                .filter(t -> t.getDueDate() != null
                          && t.getDueDate().isBefore(now)
                          && !"DONE".equals(t.getStatus())).count();

        // Avg task age in days (non-done tasks)
        double avgAge = tasks.stream()
                .filter(t -> !"DONE".equals(t.getStatus()) && t.getCreatedAt() != null)
                .mapToLong(t -> ChronoUnit.DAYS.between(t.getCreatedAt(), now))
                .average().orElse(0);

        // Most productive user this month (most TASK_COMPLETED logs)
        LocalDateTime monthStart = now.minusDays(30);
        List<ActivityLog> recentLogs = activityLogRepository
                .findByOrganizationIdAndCreatedAtBetweenOrderByCreatedAtDesc(
                        workspaceContext.getWorkspaceId(), monthStart, now);
        String topUser = recentLogs.stream()
                .filter(l -> "TASK_COMPLETED".equals(l.getAction()) || "DONE".equals(l.getNewValue()))
                .collect(Collectors.groupingBy(
                        l -> l.getPerformedBy() != null ? l.getPerformedBy() : "Unknown",
                        Collectors.counting()))
                .entrySet().stream()
                .max(Map.Entry.comparingByValue())
                .map(e -> e.getKey().contains("@") ? e.getKey().split("@")[0] : e.getKey())
                .orElse("—");

        long achievedGoals = goals.stream().filter(g -> "ACHIEVED".equals(g.getStatus())).count();

        Map<String, Object> kpis = new LinkedHashMap<>();
        kpis.put("totalTasks",      total);
        kpis.put("completedTasks",  done);
        kpis.put("completionRate",  total == 0 ? 0 : Math.round(done * 100.0 / total));
        kpis.put("inProgress",      inProgress);
        kpis.put("overdueTasks",    overdue);
        kpis.put("overdueRate",     total == 0 ? 0 : Math.round(overdue * 100.0 / total));
        kpis.put("avgTaskAgeDays",  Math.round(avgAge));
        kpis.put("topUser",         topUser);
        kpis.put("totalProjects",   projects.size());
        kpis.put("totalGoals",      goals.size());
        kpis.put("achievedGoals",   achievedGoals);
        kpis.put("goalSuccessRate", goals.isEmpty() ? 0 : Math.round(achievedGoals * 100.0 / goals.size()));
        return kpis;
    }

    // ── Velocity — tasks completed per week for last 8 weeks ──
    private List<Map<String, Object>> buildVelocity(String orgId, LocalDateTime now) {
        List<Map<String, Object>> weeks = new ArrayList<>();
        DateTimeFormatter fmt = DateTimeFormatter.ofPattern("MMM d");
        for (int i = 7; i >= 0; i--) {
            LocalDateTime base      = now.minusWeeks(i);
            LocalDateTime weekStart = base.with(java.time.temporal.TemporalAdjusters.previousOrSame(
                    java.time.DayOfWeek.MONDAY)).truncatedTo(ChronoUnit.DAYS);
            LocalDateTime weekEnd   = weekStart.plusWeeks(1);
            long completed = activityLogRepository.countByOrganizationIdAndActionAndCreatedAtBetween(
                    orgId, "TASK_COMPLETED", weekStart, weekEnd);
            long created   = activityLogRepository.countByOrganizationIdAndActionAndCreatedAtBetween(
                    orgId, "TASK_CREATED", weekStart, weekEnd);
            Map<String, Object> w = new LinkedHashMap<>();
            w.put("week",      weekStart.format(fmt));
            w.put("completed", completed);
            w.put("created",   created);
            weeks.add(w);
        }
        return weeks;
    }

    // ── Burndown — cumulative remaining tasks over last 30 days ─
    private List<Map<String, Object>> buildBurndown(List<Task> tasks, LocalDateTime now) {
        List<Map<String, Object>> data = new ArrayList<>();
        int total = tasks.size();
        DateTimeFormatter fmt = DateTimeFormatter.ofPattern("MMM d");
        for (int i = 29; i >= 0; i -= 2) {
            LocalDateTime day  = now.minusDays(i).truncatedTo(ChronoUnit.DAYS);
            long remaining = tasks.stream()
                    .filter(t -> !"DONE".equals(t.getStatus())
                              || (t.getUpdatedAt() != null && t.getUpdatedAt().isAfter(day)))
                    .count();
            // Ideal line
            double ideal = total - (total * (29.0 - i) / 29.0);
            Map<String, Object> d = new LinkedHashMap<>();
            d.put("date",      day.format(fmt));
            d.put("remaining", remaining);
            d.put("ideal",     (long) Math.max(0, ideal));
            data.add(d);
        }
        return data;
    }

    // ── Capacity — task count per team member ─────────────────
    private List<Map<String, Object>> buildCapacity(List<Task> tasks, String orgId) {
        // Group non-done tasks by assignee
        Map<String, Long> assigned = tasks.stream()
                .filter(t -> !"DONE".equals(t.getStatus())
                          && t.getAssigneeIds() != null
                          && !t.getAssigneeIds().isEmpty())
                .flatMap(t -> t.getAssigneeIds().stream()
                        .map(aid -> Map.entry(aid, t)))
                .collect(Collectors.groupingBy(Map.Entry::getKey, Collectors.counting()));

        long totalCompleted = tasks.stream().filter(t -> "DONE".equals(t.getStatus())).count();

        List<Map<String, Object>> result = new ArrayList<>();
        var members = teamMemberRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();
        for (var m : members) {
            long active    = assigned.getOrDefault(m.getId(), 0L);
            long completed = tasks.stream()
                    .filter(t -> "DONE".equals(t.getStatus())
                              && t.getAssigneeIds() != null
                              && t.getAssigneeIds().contains(m.getId()))
                    .count();
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("name",      m.getName() != null ? m.getName() : m.getEmail());
            entry.put("email",     m.getEmail());
            entry.put("active",    active);
            entry.put("completed", completed);
            entry.put("total",     active + completed);
            result.add(entry);
        }
        // Sort by active tasks descending
        result.sort((a, b) -> Long.compare((long) b.get("active"), (long) a.get("active")));
        return result;
    }

    // ── Project health scores ─────────────────────────────────
    private List<Map<String, Object>> buildProjectHealth(List<Task> tasks,
                                                          List<Project> projects,
                                                          LocalDateTime now) {
        return projects.stream().map(p -> {
            List<Task> pt = tasks.stream()
                    .filter(t -> p.getId().equals(t.getProjectId()))
                    .collect(Collectors.toList());
            long total    = pt.size();
            long done     = pt.stream().filter(t -> "DONE".equals(t.getStatus())).count();
            long overdue  = pt.stream()
                    .filter(t -> t.getDueDate() != null
                              && t.getDueDate().isBefore(now)
                              && !"DONE".equals(t.getStatus())).count();

            // Score: 0-100
            int completionScore = total == 0 ? 50 : (int)(done * 100 / total);
            int overdueDeduct   = (int) Math.min(40, overdue * 10);
            int score           = Math.max(0, Math.min(100, completionScore - overdueDeduct));

            String health;
            if (score >= 75)      health = "HEALTHY";
            else if (score >= 50) health = "AT_RISK";
            else                  health = "CRITICAL";

            Map<String, Object> h = new LinkedHashMap<>();
            h.put("id",         p.getId());
            h.put("name",       p.getName());
            h.put("color",      p.getColor());
            h.put("score",      score);
            h.put("health",     health);
            h.put("totalTasks", total);
            h.put("done",       done);
            h.put("overdue",    overdue);
            h.put("completion", total == 0 ? 0 : Math.round(done * 100.0 / total));
            return h;
        })
        .sorted((a, b) -> Integer.compare((int) b.get("score"), (int) a.get("score")))
        .collect(Collectors.toList());
    }

    // ── Tasks by status ───────────────────────────────────────
    private List<Map<String, Object>> buildTasksByStatus(List<Task> tasks) {
        Map<String, Long> counts = tasks.stream()
                .collect(Collectors.groupingBy(
                        t -> t.getStatus() != null ? t.getStatus() : "TODO",
                        Collectors.counting()));
        return List.of(
            Map.of("name", "To Do",       "value", counts.getOrDefault("TODO", 0L),       "color", "#6366f1"),
            Map.of("name", "In Progress", "value", counts.getOrDefault("IN_PROGRESS", 0L), "color", "#f59e0b"),
            Map.of("name", "Done",        "value", counts.getOrDefault("DONE", 0L),         "color", "#10b981")
        );
    }

    // ── Tasks by priority ─────────────────────────────────────
    private List<Map<String, Object>> buildTasksByPriority(List<Task> tasks) {
        Map<String, Long> counts = tasks.stream()
                .collect(Collectors.groupingBy(
                        t -> t.getPriority() != null ? t.getPriority() : "MEDIUM",
                        Collectors.counting()));
        return List.of(
            Map.of("name", "Low",    "value", counts.getOrDefault("LOW", 0L),    "color", "#10b981"),
            Map.of("name", "Medium", "value", counts.getOrDefault("MEDIUM", 0L), "color", "#f59e0b"),
            Map.of("name", "High",   "value", counts.getOrDefault("HIGH", 0L),   "color", "#ef4444")
        );
    }

    // ── Completion trend — 30-day daily completions ───────────
    private List<Map<String, Object>> buildCompletionTrend(String orgId, LocalDateTime now) {
        LocalDateTime start = now.minusDays(29);
        List<ActivityLog> logs = activityLogRepository
                .findByOrganizationIdAndCreatedAtBetweenOrderByCreatedAtDesc(orgId, start, now);
        DateTimeFormatter fmt = DateTimeFormatter.ofPattern("MMM d");
        Map<String, Long> byDay = logs.stream()
                .filter(l -> "TASK_COMPLETED".equals(l.getAction()))
                .collect(Collectors.groupingBy(
                        l -> l.getCreatedAt().format(fmt),
                        Collectors.counting()));
        List<Map<String, Object>> trend = new ArrayList<>();
        for (int i = 29; i >= 0; i--) {
            String day = now.minusDays(i).format(fmt);
            trend.add(Map.of("date", day, "completions", byDay.getOrDefault(day, 0L)));
        }
        return trend;
    }

    // ── D-2: Per-member workload detail ────────────────────────
    @GetMapping("/workload")
    public List<Map<String, Object>> getWorkload() {
        String orgId = workspaceContext.getWorkspaceId();
        List<Task> tasks = taskRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();
        var members = teamMemberRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();
        LocalDateTime now = LocalDateTime.now();

        List<Map<String, Object>> result = new ArrayList<>();
        for (var member : members) {
            String email = member.getEmail();
            String name  = member.getName() != null ? member.getName() : email;

            List<Task> assigned = tasks.stream()
                .filter(t -> t.getAssigneeIds() != null && t.getAssigneeIds().contains(email))
                .collect(java.util.stream.Collectors.toList());

            long total     = assigned.size();
            long done      = assigned.stream().filter(t -> "DONE".equals(t.getStatus())).count();
            long active    = assigned.stream().filter(t -> "IN_PROGRESS".equals(t.getStatus())).count();
            long todo      = assigned.stream().filter(t -> "TODO".equals(t.getStatus())).count();
            long overdue   = assigned.stream()
                .filter(t -> t.getDueDate() != null && t.getDueDate().isBefore(now) && !"DONE".equals(t.getStatus()))
                .count();
            int completionRate = total == 0 ? 0 : (int)((done * 100) / total);
            String loadLevel = active > 8 ? "HIGH" : active > 4 ? "MEDIUM" : "LOW";

            // Weekly completions for sparkline (last 6 weeks)
            List<Map<String, Object>> weekly = new ArrayList<>();
            for (int w = 5; w >= 0; w--) {
                LocalDateTime weekStart = now.minusWeeks(w).with(java.time.DayOfWeek.MONDAY).toLocalDate().atStartOfDay();
                LocalDateTime weekEnd   = weekStart.plusWeeks(1);
                long completed = assigned.stream()
                    .filter(t -> "DONE".equals(t.getStatus())
                        && t.getUpdatedAt() != null
                        && !t.getUpdatedAt().isBefore(weekStart)
                        && t.getUpdatedAt().isBefore(weekEnd))
                    .count();
                Map<String, Object> wk = new LinkedHashMap<>();
                wk.put("week", "W-" + w);
                wk.put("completed", completed);
                weekly.add(wk);
            }

            Map<String, Object> row = new LinkedHashMap<>();
            row.put("email",          email);
            row.put("name",           name);
            row.put("avatar",         name.substring(0, Math.min(2, name.length())).toUpperCase());
            row.put("role",           member.getRole());
            row.put("total",          total);
            row.put("done",           done);
            row.put("active",         active);
            row.put("todo",           todo);
            row.put("overdue",        overdue);
            row.put("completionRate", completionRate);
            row.put("loadLevel",      loadLevel);
            row.put("weekly",         weekly);
            result.add(row);
        }
        // sort by active tasks descending
        result.sort((a, b) -> Long.compare((Long)b.get("active"), (Long)a.get("active")));
        return result;
    }

    // ── D-1: Portfolio summary ──────────────────────────────────
    @GetMapping("/portfolio")
    public Map<String, Object> getPortfolio() {
        String orgId = workspaceContext.getWorkspaceId();
        List<Task>    tasks    = taskRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();
        List<Project> projects = projectRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();
        List<Goal>    goals    = goalRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();
        LocalDateTime now      = LocalDateTime.now();

        List<Map<String, Object>> projectData = new ArrayList<>();
        for (Project p : projects) {
            if (p.getParentProjectId() != null) continue; // only root projects
            List<Task> pTasks = tasks.stream()
                .filter(t -> p.getId().equals(t.getProjectId()))
                .collect(java.util.stream.Collectors.toList());
            long total    = pTasks.size();
            long done     = pTasks.stream().filter(t -> "DONE".equals(t.getStatus())).count();
            long overdue  = pTasks.stream()
                .filter(t -> t.getDueDate() != null && t.getDueDate().isBefore(now) && !"DONE".equals(t.getStatus()))
                .count();
            int health = total == 0 ? 100
                : (int)(done * 100 / total) - (int)(overdue * 50 / Math.max(1, total));
            health = Math.max(0, Math.min(100, health));
            String healthLabel = health >= 70 ? "HEALTHY" : health >= 40 ? "AT_RISK" : "CRITICAL";

            // Sub-projects
            List<String> subNames = projects.stream()
                .filter(sp -> p.getId().equals(sp.getParentProjectId()))
                .map(Project::getName).collect(java.util.stream.Collectors.toList());

            // Linked goals
            List<String> linkedGoalTitles = goals.stream()
                .filter(g -> p.getId().equals(g.getCustomFieldValues().getOrDefault("linkedProjectId", "")))
                .map(Goal::getTitle).collect(java.util.stream.Collectors.toList());

            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id",           p.getId());
            row.put("name",         p.getName());
            row.put("color",        p.getColor() != null ? p.getColor() : "#6366f1");
            row.put("status",       p.getStatus() != null ? p.getStatus() : "ACTIVE");
            row.put("totalTasks",   total);
            row.put("doneTasks",    done);
            row.put("overdueTasks", overdue);
            row.put("progress",     total == 0 ? 0 : (int)(done * 100 / total));
            row.put("health",       healthLabel);
            row.put("healthScore",  health);
            row.put("subProjects",  subNames);
            row.put("linkedGoals",  linkedGoalTitles);
            row.put("startDate",    p.getCreatedAt());
            row.put("endDate",      p.getDueDate());
            projectData.add(row);
        }

        // Summary
        int totalProjects  = projectData.size();
        long healthyCount  = projectData.stream().filter(p -> "HEALTHY".equals(p.get("health"))).count();
        long atRiskCount   = projectData.stream().filter(p -> "AT_RISK".equals(p.get("health"))).count();
        long criticalCount = projectData.stream().filter(p -> "CRITICAL".equals(p.get("health"))).count();
        int avgProgress    = projectData.isEmpty() ? 0
            : (int) projectData.stream().mapToInt(p -> (Integer)p.get("progress")).average().orElse(0);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("projects",     projectData);
        result.put("totalProjects",  totalProjects);
        result.put("healthyCount",   healthyCount);
        result.put("atRiskCount",    atRiskCount);
        result.put("criticalCount",  criticalCount);
        result.put("avgProgress",    avgProgress);
        result.put("totalTasks",     tasks.size());
        result.put("totalGoals",     goals.size());
        return result;
    }


    // ── Critical Path (item 5) ────────────────────────────────────
    @GetMapping("/critical-path/{projectId}")
    public Map<String, Object> getCriticalPath(@PathVariable String projectId) {
        List<Task> tasks = taskRepository.findByOrganizationId(workspaceContext.getWorkspaceId(), org.springframework.data.domain.PageRequest.of(0, 2000)).getContent()
            .stream().filter(t -> projectId.equals(t.getProjectId())).toList();

        if (tasks.isEmpty()) return Map.of("criticalPath", List.of(), "totalDuration", 0);

        // Build adjacency: id → task
        Map<String, Task> byId = new java.util.LinkedHashMap<>();
        tasks.forEach(t -> byId.put(t.getId(), t));

        // Compute earliest finish (EF) for each task via forward pass
        Map<String, Long> ef = new java.util.LinkedHashMap<>();
        Map<String, Long> es = new java.util.LinkedHashMap<>();

        java.util.function.Function<String, Long> getDuration = id -> {
            Task t = byId.get(id);
            if (t == null) return 1L;
            if (t.getStartDate() != null && t.getDueDate() != null)
                return java.time.temporal.ChronoUnit.DAYS.between(t.getStartDate(), t.getDueDate());
            return t.getStoryPoints() != null ? t.getStoryPoints().longValue() : 1L;
        };

        // Topological sort via DFS
        List<String> sorted = new java.util.ArrayList<>();
        java.util.Set<String> visited = new java.util.HashSet<>();
        java.util.function.Consumer<String>[] dfs = new java.util.function.Consumer[1];
        dfs[0] = id -> {
            if (visited.contains(id)) return;
            visited.add(id);
            Task t = byId.get(id);
            if (t != null && t.getBlockedByTaskIds() != null)
                t.getBlockedByTaskIds().forEach(dep -> dfs[0].accept(dep));
            sorted.add(id);
        };
        tasks.forEach(t -> dfs[0].accept(t.getId()));

        // Forward pass
        for (String id : sorted) {
            Task t = byId.get(id);
            long maxPredEF = 0;
            if (t != null && t.getBlockedByTaskIds() != null) {
                for (String dep : t.getBlockedByTaskIds()) {
                    maxPredEF = Math.max(maxPredEF, ef.getOrDefault(dep, 0L));
                }
            }
            es.put(id, maxPredEF);
            ef.put(id, maxPredEF + getDuration.apply(id));
        }

        // Find project end (max EF)
        long projectEnd = ef.values().stream().mapToLong(Long::longValue).max().orElse(0);

        // Backward pass to find LS/LF and float
        Map<String, Long> lf = new java.util.LinkedHashMap<>();
        Map<String, Long> ls = new java.util.LinkedHashMap<>();
        Map<String, Long> totalFloat = new java.util.LinkedHashMap<>();

        // Init all tasks with project end
        tasks.forEach(t -> lf.put(t.getId(), projectEnd));

        // Find tasks that are predecessors and update their LF
        for (Task t : tasks) {
            if (t.getBlockedByTaskIds() == null) continue;
            for (String predId : t.getBlockedByTaskIds()) {
                long lsOfSucc = lf.getOrDefault(t.getId(), projectEnd) - getDuration.apply(t.getId());
                lf.put(predId, Math.min(lf.getOrDefault(predId, projectEnd), lsOfSucc));
            }
        }

        for (String id : sorted) {
            long lfVal = lf.getOrDefault(id, projectEnd);
            ls.put(id, lfVal - getDuration.apply(id));
            totalFloat.put(id, ls.get(id) - es.getOrDefault(id, 0L));
        }

        // Critical path: tasks where float == 0
        List<Map<String, Object>> criticalTasks = new java.util.ArrayList<>();
        for (Task t : tasks) {
            long fl = totalFloat.getOrDefault(t.getId(), Long.MAX_VALUE);
            boolean isCritical = fl == 0;
            Map<String, Object> item = new java.util.LinkedHashMap<>();
            item.put("id",          t.getId());
            item.put("title",       t.getTitle());
            item.put("status",      t.getStatus());
            item.put("priority",    t.getPriority());
            item.put("critical",    isCritical);
            item.put("float",       fl);
            item.put("es",          es.getOrDefault(t.getId(), 0L));
            item.put("ef",          ef.getOrDefault(t.getId(), 0L));
            item.put("duration",    getDuration.apply(t.getId()));
            item.put("dependencies", t.getBlockedByTaskIds());
            criticalTasks.add(item);
        }

        // Sort: critical first, then by ES
        criticalTasks.sort((a, b) -> {
            boolean ca = (Boolean) a.get("critical");
            boolean cb = (Boolean) b.get("critical");
            if (ca != cb) return ca ? -1 : 1;
            return Long.compare((Long)a.get("es"), (Long)b.get("es"));
        });

        return Map.of(
            "criticalPath",  criticalTasks.stream().filter(t -> (Boolean)t.get("critical")).toList(),
            "allTasks",      criticalTasks,
            "totalDuration", projectEnd
        );
    }

}

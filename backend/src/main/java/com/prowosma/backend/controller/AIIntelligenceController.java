package com.prowosma.backend.controller;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.Task;
import com.prowosma.backend.model.Goal;
import com.prowosma.backend.model.Sprint;
import com.prowosma.backend.repository.*;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/ai/intelligence")
@Tag(name = "AI Intelligence", description = "Proactive AI-generated workspace insights")
@RequiredArgsConstructor
public class AIIntelligenceController {

    private final TaskRepository    taskRepository;
    private final GoalRepository    goalRepository;
    private final SprintRepository  sprintRepository;
    private final WorkspaceContext  workspaceContext;

    @GetMapping
    public Map<String, Object> getAllInsights() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("sprintRisks",     getSprintRisks());
        result.put("overdueItems",    getOverdueInsights());
        result.put("goalTrajectory",  getGoalTrajectory());
        result.put("bottlenecks",     detectBottlenecks());
        result.put("recommendations", getRecommendations());
        result.put("generatedAt",     LocalDateTime.now().toString());
        return result;
    }

    @GetMapping("/sprint-risks")
    public List<Map<String, Object>> getSprintRisks() {
        String orgId = workspaceContext.getWorkspaceId();
        List<Sprint> activeSprints = sprintRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent().stream()
            .filter(s -> "ACTIVE".equals(s.getStatus())).collect(Collectors.toList());

        List<Map<String, Object>> risks = new ArrayList<>();
        for (Sprint sprint : activeSprints) {
            List<Task> tasks = taskRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent().stream()
                .filter(t -> sprint.getId().equals(t.getSprintId())).collect(Collectors.toList());
            if (tasks.isEmpty()) continue;

            long total   = tasks.size();
            long done    = tasks.stream().filter(t -> "DONE".equals(t.getStatus())).count();
            long overdue = tasks.stream().filter(t -> t.getDueDate() != null
                && t.getDueDate().isBefore(LocalDateTime.now())
                && !"DONE".equals(t.getStatus())).count();
            double pct   = total > 0 ? (double) done / total * 100 : 0;
            int riskScore = (int) Math.min(100, (100 - pct) * 0.7 + overdue * 15);
            String level  = riskScore >= 70 ? "HIGH" : riskScore >= 40 ? "MEDIUM" : "LOW";

            if (riskScore >= 30) {
                Map<String, Object> r = new LinkedHashMap<>();
                r.put("sprintId",    sprint.getId());
                r.put("sprintName",  sprint.getName() != null ? sprint.getName() : "Sprint");
                r.put("riskScore",   riskScore);
                r.put("riskLevel",   level);
                r.put("totalTasks",  total);
                r.put("doneTasks",   done);
                r.put("overdueTasks",overdue);
                r.put("pctComplete", (long) Math.round(pct));
                r.put("insight",     level.equals("HIGH")
                    ? "Sprint is at high risk. " + overdue + " tasks are overdue."
                    : "Sprint needs attention — only " + Math.round(pct) + "% complete.");
                risks.add(r);
            }
        }
        risks.sort(Comparator.comparingInt(r -> -(int) r.get("riskScore")));
        return risks;
    }

    @GetMapping("/overdue")
    public Map<String, Object> getOverdueInsights() {
        String orgId = workspaceContext.getWorkspaceId();
        LocalDateTime now = LocalDateTime.now();

        List<Task> overdue = taskRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent().stream()
            .filter(t -> t.getDueDate() != null && t.getDueDate().isBefore(now)
                      && !"DONE".equals(t.getStatus()))
            .sorted(Comparator.comparing(Task::getDueDate))
            .limit(20).collect(Collectors.toList());

        long critical = overdue.stream().filter(t ->
            t.getDueDate() != null && t.getDueDate().isBefore(now.minusDays(7))).count();

        List<Map<String, Object>> taskList = new ArrayList<>();
        for (Task t : overdue) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id",          t.getId());
            item.put("title",       t.getTitle());
            item.put("dueDate",     t.getDueDate().toString());
            item.put("daysOverdue", (int) java.time.temporal.ChronoUnit.DAYS.between(t.getDueDate(), now));
            item.put("assigneeIds", t.getAssigneeIds() != null ? t.getAssigneeIds() : List.of());
            taskList.add(item);
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("totalOverdue",   overdue.size());
        result.put("criticalOverdue",critical);
        result.put("tasks",          taskList);
        result.put("insight",        overdue.size() > 0
            ? overdue.size() + " tasks are overdue. " + critical + " are critically late (7+ days)."
            : "No overdue tasks. Great work!");
        return result;
    }

    @GetMapping("/goal-trajectory")
    public List<Map<String, Object>> getGoalTrajectory() {
        String orgId = workspaceContext.getWorkspaceId();
        List<Goal> goals = goalRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent().stream()
            .filter(g -> "ACTIVE".equals(g.getStatus())).collect(Collectors.toList());

        List<Map<String, Object>> result = new ArrayList<>();
        for (Goal g : goals) {
            // Goal.progress is primitive int — no null check needed
            int progress = g.getProgress();
            String trajectory = progress >= 70 ? "ON_TRACK" : progress >= 40 ? "AT_RISK" : "OFF_TRACK";
            String rec = switch (trajectory) {
                case "AT_RISK"   -> "Review goal milestones and unblock dependencies.";
                case "OFF_TRACK" -> "Consider revising target or increasing resources.";
                default          -> "Keep it up — goal is on track.";
            };
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("goalId",         g.getId());
            item.put("title",          g.getTitle());
            item.put("progress",       progress);
            item.put("trajectory",     trajectory);
            item.put("recommendation", rec);
            result.add(item);
        }
        return result;
    }

    @GetMapping("/bottlenecks")
    public List<Map<String, Object>> detectBottlenecks() {
        String orgId = workspaceContext.getWorkspaceId();
        List<Task> active = taskRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent().stream()
            .filter(t -> !"DONE".equals(t.getStatus())).collect(Collectors.toList());

        Map<String, Long> load = new HashMap<>();
        for (Task t : active) {
            if (t.getAssigneeIds() == null) continue;
            for (String a : t.getAssigneeIds()) load.merge(a, 1L, Long::sum);
        }

        List<Map<String, Object>> result = new ArrayList<>();
        load.entrySet().stream()
            .filter(e -> e.getValue() > 5)
            .sorted(Map.Entry.<String, Long>comparingByValue().reversed())
            .forEach(e -> {
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("assignee",    e.getKey());
                item.put("activeTasks", e.getValue());
                item.put("severity",    e.getValue() > 10 ? "HIGH" : "MEDIUM");
                item.put("insight",     e.getKey() + " has " + e.getValue() + " active tasks — may be over-loaded.");
                result.add(item);
            });
        return result;
    }

    @GetMapping("/recommendations")
    public List<Map<String, Object>> getRecommendations() {
        String orgId = workspaceContext.getWorkspaceId();
        List<Map<String, Object>> recs = new ArrayList<>();
        List<Task> all = taskRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();

        long overdue = all.stream().filter(t -> t.getDueDate() != null
            && t.getDueDate().isBefore(LocalDateTime.now()) && !"DONE".equals(t.getStatus())).count();
        long todo    = all.stream().filter(t -> "TODO".equals(t.getStatus())).count();
        long done    = all.stream().filter(t -> "DONE".equals(t.getStatus())).count();

        if (overdue > 0) {
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("type","OVERDUE"); r.put("priority","HIGH");
            r.put("title","Address " + overdue + " overdue tasks");
            r.put("description","These tasks are past due and may be blocking other work.");
            r.put("action","Go to Tasks"); r.put("url","/tasks");
            recs.add(r);
        }
        if (todo > 10) {
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("type","BACKLOG"); r.put("priority","MEDIUM");
            r.put("title","Large backlog: " + todo + " unstarted tasks");
            r.put("description","Consider prioritising or reassigning backlog items.");
            r.put("action","View Kanban"); r.put("url","/kanban");
            recs.add(r);
        }
        long total = done + todo;
        if (total > 0 && (double) done / total < 0.3) {
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("type","VELOCITY"); r.put("priority","MEDIUM");
            r.put("title","Low completion rate (" + Math.round((double) done / total * 100) + "%)");
            r.put("description","Consider reviewing team workload and removing blockers.");
            r.put("action","View Analytics"); r.put("url","/analytics");
            recs.add(r);
        }
        return recs;
    }

    @GetMapping("/changelog")
    public Map<String, Object> generateChangelog(@RequestParam(defaultValue = "7") int days) {
        String orgId = workspaceContext.getWorkspaceId();
        LocalDateTime since = LocalDateTime.now().minusDays(days);
        List<Task> recent = taskRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent().stream()
            .filter(t -> t.getUpdatedAt() != null && t.getUpdatedAt().isAfter(since))
            .collect(Collectors.toList());

        long completed = recent.stream().filter(t -> "DONE".equals(t.getStatus())).count();
        long created   = recent.stream().filter(t -> t.getCreatedAt() != null
                          && t.getCreatedAt().isAfter(since)).count();

        List<Map<String, Object>> completedList = new ArrayList<>();
        recent.stream().filter(t -> "DONE".equals(t.getStatus())).limit(10).forEach(t -> {
            completedList.add(Map.of("id", t.getId(), "title", t.getTitle()));
        });

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("period",         days + " days");
        result.put("since",          since.toString());
        result.put("summary",        "In the last " + days + " days: " + completed + " tasks completed, "
                                     + created + " new tasks created.");
        result.put("tasksCompleted", completed);
        result.put("tasksCreated",   created);
        result.put("tasksUpdated",   (long) recent.size());
        result.put("completedTasks", completedList);
        return result;
    }
}

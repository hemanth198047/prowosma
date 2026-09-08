package com.prowosma.backend.controller;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.Goal;
import com.prowosma.backend.model.Project;
import com.prowosma.backend.model.Task;
import com.prowosma.backend.repository.GoalRepository;
import com.prowosma.backend.repository.ProjectRepository;
import com.prowosma.backend.repository.TaskRepository;
import com.prowosma.backend.service.ProjectService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/reports")
@RequiredArgsConstructor
public class ReportController {

    private final TaskRepository taskRepository;
    private final ProjectRepository projectRepository;
    private final GoalRepository goalRepository;
    private final ProjectService projectService;
    private final WorkspaceContext workspaceContext;
    @GetMapping("/summary")
    public Map<String, Object> getSummaryReport(
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to) {

        LocalDateTime fromDate = from != null ?
                LocalDateTime.parse(from) : LocalDateTime.now().minusMonths(1);
        LocalDateTime toDate = to != null ?
                LocalDateTime.parse(to) : LocalDateTime.now();

        List<Task> allTasks = taskRepository.findByOrganizationId(workspaceContext.getWorkspaceId(), org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();
        List<Project> allProjects = projectRepository.findByOrganizationId(workspaceContext.getWorkspaceId(), org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();
        List<Goal> allGoals = goalRepository.findByOrganizationId(workspaceContext.getWorkspaceId(), org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();

        List<Task> periodTasks = allTasks.stream()
                .filter(t -> t.getCreatedAt() != null &&
                        t.getCreatedAt().isAfter(fromDate) &&
                        t.getCreatedAt().isBefore(toDate))
                .collect(Collectors.toList());

        Map<String, Long> tasksByStatus = allTasks.stream()
                .collect(Collectors.groupingBy(Task::getStatus, Collectors.counting()));

        Map<String, Long> tasksByPriority = allTasks.stream()
                .collect(Collectors.groupingBy(Task::getPriority, Collectors.counting()));

        List<Map<String, Object>> projectSummaries = allProjects.stream()
                .map(p -> {
                    Map<String, Object> pm = new HashMap<>();
                    pm.put("name", p.getName());
                    pm.put("status", p.getStatus());
                    pm.put("progress", projectService.getProgress(p.getId()));
                    pm.put("dueDate", p.getDueDate());
                    long taskCount = allTasks.stream()
                            .filter(t -> p.getId().equals(t.getProjectId())).count();
                    long doneCount = allTasks.stream()
                            .filter(t -> p.getId().equals(t.getProjectId()) &&
                                    "DONE".equals(t.getStatus())).count();
                    pm.put("totalTasks", taskCount);
                    pm.put("doneTasks", doneCount);
                    return pm;
                }).collect(Collectors.toList());

        List<Map<String, Object>> goalSummaries = allGoals.stream()
                .map(g -> {
                    Map<String, Object> gm = new HashMap<>();
                    gm.put("title", g.getTitle());
                    gm.put("status", g.getStatus());
                    gm.put("progress", g.getProgress());
                    gm.put("targetDate", g.getTargetDate());
                    gm.put("subGoalCount", g.getSubGoals() != null ? g.getSubGoals().size() : 0);
                    return gm;
                }).collect(Collectors.toList());

        Map<String, Object> report = new HashMap<>();
        report.put("generatedAt", LocalDateTime.now());
        report.put("period", Map.of("from", fromDate, "to", toDate));
        report.put("totalTasks", allTasks.size());
        report.put("totalProjects", allProjects.size());
        report.put("totalGoals", allGoals.size());
        report.put("tasksByStatus", tasksByStatus);
        report.put("tasksByPriority", tasksByPriority);
        report.put("projectSummaries", projectSummaries);
        report.put("goalSummaries", goalSummaries);
        report.put("periodTasks", periodTasks.size());
        report.put("completionRate", allTasks.isEmpty() ? 0 :
                (int) ((tasksByStatus.getOrDefault("DONE", 0L) * 100) / allTasks.size()));
        report.put("overdueCount", allTasks.stream()
                .filter(t -> t.getDueDate() != null &&
                        t.getDueDate().isBefore(LocalDateTime.now()) &&
                        !"DONE".equals(t.getStatus())).count());
        return report;
    }
}
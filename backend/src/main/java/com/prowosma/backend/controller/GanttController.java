package com.prowosma.backend.controller;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.Task;
import com.prowosma.backend.repository.TaskRepository;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/gantt")
@Tag(name = "Gantt", description = "Gantt chart data and date write-back")
@RequiredArgsConstructor
public class GanttController {

    private final TaskRepository   taskRepository;
    private final WorkspaceContext workspaceContext;

    private List<Task> tasksForProject(String orgId, String projectId) {
        // TaskRepository has findByOrganizationId + findByProjectId — combine with filter
        if (projectId != null) {
            return taskRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent().stream()
                .filter(t -> projectId.equals(t.getProjectId()))
                .collect(Collectors.toList());
        }
        return taskRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();
    }

    @GetMapping
    public Map<String, Object> getGanttData(@RequestParam(required = false) String projectId) {
        String orgId = workspaceContext.getWorkspaceId();
        List<Task> tasks = tasksForProject(orgId, projectId);

        List<Map<String, Object>> rows = tasks.stream().map(t -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id",           t.getId());
            row.put("title",        t.getTitle());
            row.put("projectId",    t.getProjectId());
            row.put("status",       t.getStatus());
            row.put("priority",     t.getPriority());
            row.put("assigneeIds",  t.getAssigneeIds());
            row.put("startDate",    t.getStartDate());
            row.put("dueDate",      t.getDueDate());
            row.put("progress",     computeProgress(t));
            row.put("dependencies", t.getBlockedByTaskIds());
            row.put("parentTaskId", t.getParentTaskId());
            row.put("sprintId",     t.getSprintId());
            return row;
        }).collect(Collectors.toList());

        return Map.of("tasks", rows, "totalTasks", rows.size(), "projectId", projectId);
    }

    @PatchMapping("/tasks/{id}/dates")
    @SuppressWarnings("unchecked")
    public ResponseEntity<?> updateDates(@PathVariable String id,
                                          @RequestBody Map<String, String> body) {
        Optional<Task> opt = taskRepository.findById(id);
        if (opt.isEmpty()) return ResponseEntity.notFound().build();
        Task task = opt.get();
        if (body.containsKey("startDate") && body.get("startDate") != null)
            task.setStartDate(LocalDateTime.parse(body.get("startDate")));
        if (body.containsKey("dueDate") && body.get("dueDate") != null)
            task.setDueDate(LocalDateTime.parse(body.get("dueDate")));
        task.setUpdatedAt(LocalDateTime.now());
        taskRepository.save(task);
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("id",        task.getId());
        resp.put("startDate", task.getStartDate() != null ? task.getStartDate().toString() : null);
        resp.put("dueDate",   task.getDueDate()   != null ? task.getDueDate().toString()   : null);
        resp.put("message",   "Dates updated");
        return ResponseEntity.ok(resp);
    }

    @PostMapping("/shift")
    public Map<String, Object> shiftDates(@RequestBody Map<String, Object> body) {
        String projectId = (String) body.get("projectId");
        int days = body.get("days") instanceof Number ? ((Number) body.get("days")).intValue() : 0;
        List<Task> tasks = tasksForProject(workspaceContext.getWorkspaceId(), projectId);
        int updated = 0;
        for (Task t : tasks) {
            boolean changed = false;
            if (t.getStartDate() != null) { t.setStartDate(t.getStartDate().plusDays(days)); changed = true; }
            if (t.getDueDate()   != null) { t.setDueDate(t.getDueDate().plusDays(days));     changed = true; }
            if (changed) { t.setUpdatedAt(LocalDateTime.now()); taskRepository.save(t); updated++; }
        }
        return Map.of("shifted", updated, "days", days, "projectId", projectId != null ? projectId : "all");
    }

    @GetMapping("/conflicts")
    public List<Map<String, Object>> detectConflicts(@RequestParam(required = false) String projectId) {
        List<Task> tasks = tasksForProject(workspaceContext.getWorkspaceId(), projectId);
        Map<String, Task> taskMap = tasks.stream().collect(Collectors.toMap(Task::getId, t -> t));
        List<Map<String, Object>> conflicts = new ArrayList<>();
        for (Task t : tasks) {
            if (t.getBlockedByTaskIds() == null || t.getStartDate() == null) continue;
            for (String blockerId : t.getBlockedByTaskIds()) {
                Task blocker = taskMap.get(blockerId);
                if (blocker == null || blocker.getDueDate() == null) continue;
                if (t.getStartDate().isBefore(blocker.getDueDate())) {
                    conflicts.add(Map.of(
                        "taskId",       t.getId(),
                        "taskTitle",    t.getTitle(),
                        "blockerId",    blockerId,
                        "blockerTitle", blocker.getTitle(),
                        "conflict",     "Task starts before blocker ends",
                        "blockerDue",   blocker.getDueDate().toString()
                    ));
                }
            }
        }
        return conflicts;
    }

    @GetMapping("/velocity")
    public List<Map<String, Object>> velocity(@RequestParam(required = false) String projectId) {
        List<Task> tasks = tasksForProject(workspaceContext.getWorkspaceId(), projectId);
        Map<String, Integer> vm = new LinkedHashMap<>();
        for (Task t : tasks) {
            if (t.getSprintId() == null || t.getStoryPoints() == null || !"DONE".equals(t.getStatus())) continue;
            vm.merge(t.getSprintId(), t.getStoryPoints(), Integer::sum);
        }
        return vm.entrySet().stream()
            .map(e -> Map.<String, Object>of("sprintId", e.getKey(), "completedPoints", e.getValue()))
            .collect(Collectors.toList());
    }

    private int computeProgress(Task t) {
        if ("DONE".equals(t.getStatus()))        return 100;
        if ("IN_PROGRESS".equals(t.getStatus())) return 50;
        return 0;
    }
}

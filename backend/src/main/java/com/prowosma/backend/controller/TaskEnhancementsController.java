package com.prowosma.backend.controller;
import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.Task;
import com.prowosma.backend.repository.TaskRepository;
import com.prowosma.backend.service.NotificationService;
import com.prowosma.backend.util.PagedResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import java.time.LocalDateTime;
import java.util.*;

@RestController @RequestMapping("/api/tasks") @RequiredArgsConstructor
public class TaskEnhancementsController {
    private final TaskRepository      taskRepo;
    private final NotificationService notifService;
    private final WorkspaceContext    ws;
    private final com.prowosma.backend.service.VisibilityService visibility;

    /** The task, or 404 if it doesn't exist or the caller may not see it. Every by-id operation below starts here. */
    private Task visible(String id) {
        Task t = taskRepo.findById(id).orElseThrow(() -> new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.NOT_FOUND, "Task not found"));
        visibility.requireTaskVisible(t);
        return t;
    }

    /** Changing who watches a task changes who can see it, so doing it for someone else needs the allocate capability. */
    private void requireMayChangeWatcher(String email, Authentication auth) {
        if (!visibility.isRestricted()) return;
        if (auth != null && email != null && email.equalsIgnoreCase(auth.getName())) return;
        visibility.requireCapability(com.prowosma.backend.access.AccessConstants.CAP_ALLOCATE_TASKS);
    }

    @PostMapping("/{id}/subtasks")
    public Task addSubtask(@PathVariable String id, @RequestBody Task sub, Authentication auth) {
        Task parent = visible(id);
        visibility.requireCapability(com.prowosma.backend.access.AccessConstants.CAP_CREATE_TASK);
        sub.setOrganizationId(ws.getWorkspaceId());
        sub.setParentTaskId(id);
        sub.setProjectId(parent.getProjectId());
        sub.setSprintId(parent.getSprintId());
        sub.setCreatedBy(auth.getName());
        sub.setCreatedAt(LocalDateTime.now()); sub.setUpdatedAt(LocalDateTime.now());
        sub = taskRepo.save(sub);
        if (parent.getSubtaskIds() == null) parent.setSubtaskIds(new ArrayList<>());
        parent.getSubtaskIds().add(sub.getId());
        parent.setUpdatedAt(LocalDateTime.now());
        taskRepo.save(parent);
        return sub;
    }

    @GetMapping("/{id}/subtasks")
    public PagedResponse<Task> getSubtasks(
            @PathVariable String id,
            @RequestParam(defaultValue = "0")  int page,
            @RequestParam(defaultValue = "50") int size) {
        // Scoped to parentTaskId — no full-org scan
        visible(id);                                          // the parent must be visible to the caller
        var all = visibility.filterTasks(taskRepo.findByParentTaskId(id).stream()
                .filter(t -> ws.getWorkspaceId() != null && ws.getWorkspaceId().equals(t.getOrganizationId())).toList());
        return PagedResponse.ofList(all, page, Math.min(size, 200));
    }

    @PatchMapping("/{id}/checklist")
    public Task updateChecklist(@PathVariable String id, @RequestBody Map<String, Object> body) {
        return Optional.of(visible(id)).map(t -> {
            if (body.containsKey("checklist")) {
                @SuppressWarnings("unchecked")
                List<Map<String,Object>> items = (List<Map<String,Object>>) body.get("checklist");
                List<Task.ChecklistItem> cl = new ArrayList<>();
                items.forEach(m -> {
                    Task.ChecklistItem ci = new Task.ChecklistItem();
                    if (m.get("id")       != null) ci.setId((String)m.get("id"));
                    if (m.get("text")     != null) ci.setText((String)m.get("text"));
                    if (m.get("checked")  != null) ci.setChecked((Boolean)m.get("checked"));
                    if (m.get("assignee") != null) ci.setAssignee((String)m.get("assignee"));
                    cl.add(ci);
                });
                t.setChecklist(cl);
            }
            t.setUpdatedAt(LocalDateTime.now());
            return taskRepo.save(t);
        }).orElseThrow();
    }

    @PostMapping("/{id}/checklist")
    public Task addChecklistItem(@PathVariable String id, @RequestBody Task.ChecklistItem item) {
        return Optional.of(visible(id)).map(t -> {
            if (t.getChecklist() == null) t.setChecklist(new ArrayList<>());
            t.getChecklist().add(item);
            t.setUpdatedAt(LocalDateTime.now());
            return taskRepo.save(t);
        }).orElseThrow();
    }

    @PatchMapping("/{id}/checklist/{itemId}/toggle")
    public Task toggleChecklistItem(@PathVariable String id, @PathVariable String itemId) {
        return Optional.of(visible(id)).map(t -> {
            if (t.getChecklist() != null)
                t.getChecklist().stream().filter(i -> itemId.equals(i.getId())).findFirst()
                    .ifPresent(i -> i.setChecked(!i.isChecked()));
            t.setUpdatedAt(LocalDateTime.now());
            return taskRepo.save(t);
        }).orElseThrow();
    }

    @PostMapping("/{id}/watchers/{email}")
    public Task addWatcher(@PathVariable String id, @PathVariable String email, Authentication auth) {
        requireMayChangeWatcher(email, auth);
        return Optional.of(visible(id)).map(t -> {
            if (t.getWatcherIds() == null) t.setWatcherIds(new ArrayList<>());
            if (!t.getWatcherIds().contains(email)) t.getWatcherIds().add(email);
            t.setUpdatedAt(LocalDateTime.now());
            return taskRepo.save(t);
        }).orElseThrow();
    }

    @DeleteMapping("/{id}/watchers/{email}")
    public Task removeWatcher(@PathVariable String id, @PathVariable String email, Authentication auth) {
        requireMayChangeWatcher(email, auth);
        return Optional.of(visible(id)).map(t -> {
            if (t.getWatcherIds() != null) t.getWatcherIds().remove(email);
            t.setUpdatedAt(LocalDateTime.now());
            return taskRepo.save(t);
        }).orElseThrow();
    }

    @PostMapping("/{id}/relationships")
    public Task addRelationship(@PathVariable String id, @RequestBody Task.TaskRelationship rel) {
        return Optional.of(visible(id)).map(t -> {
            if (t.getRelationships() == null) t.setRelationships(new ArrayList<>());
            t.getRelationships().add(rel);
            // If BLOCKS: also add BLOCKED_BY on target
            if ("BLOCKS".equals(rel.getType())) {
                taskRepo.findById(rel.getTargetTaskId()).filter(visibility::canSeeTask).ifPresent(target -> {
                    Task.TaskRelationship reverse = new Task.TaskRelationship();
                    reverse.setType("BLOCKED_BY"); reverse.setTargetTaskId(id);
                    if (target.getRelationships() == null) target.setRelationships(new ArrayList<>());
                    target.getRelationships().add(reverse);
                    target.setUpdatedAt(LocalDateTime.now());
                    taskRepo.save(target);
                });
            }
            t.setUpdatedAt(LocalDateTime.now());
            return taskRepo.save(t);
        }).orElseThrow();
    }

    @DeleteMapping("/{id}/relationships/{relId}")
    public Task removeRelationship(@PathVariable String id, @PathVariable String relId) {
        return Optional.of(visible(id)).map(t -> {
            if (t.getRelationships() != null)
                t.setRelationships(t.getRelationships().stream().filter(r->!relId.equals(r.getId())).toList());
            t.setUpdatedAt(LocalDateTime.now());
            return taskRepo.save(t);
        }).orElseThrow();
    }

    @PatchMapping("/{id}/sla")
    public Task setSla(@PathVariable String id, @RequestBody Map<String, Object> body) {
        return Optional.of(visible(id)).map(t -> {
            if (body.containsKey("slaHours")) {
                int hours = ((Number) body.get("slaHours")).intValue();
                t.setSlaHours(hours);
                t.setSlaDeadline(LocalDateTime.now().plusHours(hours));
                t.setSlaStatus("ON_TRACK");
            }
            t.setUpdatedAt(LocalDateTime.now());
            return taskRepo.save(t);
        }).orElseThrow();
    }

    @PatchMapping("/{id}/goal-link")
    public Task linkGoal(@PathVariable String id, @RequestBody Map<String, Object> body) {
        return Optional.of(visible(id)).map(t -> {
            if (body.containsKey("linkedGoalId")) t.setLinkedGoalId((String)body.get("linkedGoalId"));
            if (body.containsKey("goalContributionWeight"))
                t.setGoalContributionWeight(((Number)body.get("goalContributionWeight")).intValue());
            t.setUpdatedAt(LocalDateTime.now());
            return taskRepo.save(t);
        }).orElseThrow();
    }
}

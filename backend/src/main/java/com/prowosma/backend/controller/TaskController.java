package com.prowosma.backend.controller;

import com.prowosma.backend.model.Attachment;
import com.prowosma.backend.model.Comment;
import com.prowosma.backend.model.Task;
import com.prowosma.backend.model.TimeLog;
import com.prowosma.backend.service.TaskService;
import com.prowosma.backend.util.PagedResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/tasks")
@Tag(name = "Task APIs", description = "Task management")
@RequiredArgsConstructor
public class TaskController {

    private final TaskService taskService;

    // ── Paginated list (default) ──────────────────────────────
    @GetMapping
    @Operation(summary = "Get all tasks — paginated")
    public PagedResponse<Task> getAll(
            @RequestParam(defaultValue = "0")   int page,
            @RequestParam(defaultValue = "50")  int size,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String projectId,
            @RequestParam(defaultValue = "createdAt") String sortBy,
            @RequestParam(defaultValue = "desc")       String sortDir) {

        Sort sort = "asc".equalsIgnoreCase(sortDir)
                ? Sort.by(sortBy).ascending()
                : Sort.by(sortBy).descending();
        PageRequest pr = PageRequest.of(page, Math.min(size, 200), sort);
        return taskService.getAllPaged(pr, status, projectId);
    }

    // ── Legacy unpaged (kept for internal service calls) ─────
    @GetMapping("/all")
    @Operation(summary = "Get all tasks without pagination — internal use only")
    public List<Task> getAllUnpaged() {
        return taskService.getAll();
    }

    @GetMapping("/{id}")
    public Task getById(@PathVariable String id) {
        return taskService.getById(id);
    }

    @GetMapping("/project/{projectId}")
    @Operation(summary = "Get tasks by project — paginated")
    public PagedResponse<Task> getByProject(
            @PathVariable String projectId,
            @RequestParam(defaultValue = "0")  int page,
            @RequestParam(defaultValue = "50") int size) {
        PageRequest pr = PageRequest.of(page, Math.min(size, 200),
                Sort.by("createdAt").descending());
        return taskService.getByProjectPaged(projectId, pr);
    }

    @PostMapping
    public Task create(@Valid @RequestBody Task task) {
        return taskService.create(task);
    }

    @PutMapping("/{id}")
    public Task update(@PathVariable String id, @Valid @RequestBody Task task) {
        return taskService.update(id, task);
    }

    /**
     * Partial update — apply only the fields actually present in the
     * request body, leaving everything else untouched. Takes a raw field
     * map rather than a full Task object specifically so it can tell the
     * difference between "this field wasn't sent" (leave alone) and "this
     * field was explicitly sent as null" (clear it) — e.g. removing a
     * task's project or SLA target. A plain null-check on a deserialized
     * Task object can't make that distinction, which previously meant
     * several fields (project, assignees, tags, description, type,
     * severity) were silently no-ops through this endpoint even though it
     * returned 200 OK.
     */
    @PatchMapping("/{id}")
    public Task patch(@PathVariable String id, @RequestBody Map<String, Object> fields) {
        Task existing = taskService.getById(id);

        if (fields.containsKey("status"))      existing.setStatus((String) fields.get("status"));
        if (fields.containsKey("priority"))    existing.setPriority((String) fields.get("priority"));
        if (fields.containsKey("title"))       existing.setTitle((String) fields.get("title"));
        if (fields.containsKey("description")) existing.setDescription((String) fields.get("description"));
        if (fields.containsKey("projectId"))   existing.setProjectId((String) fields.get("projectId"));
        if (fields.containsKey("sprintId"))    existing.setSprintId((String) fields.get("sprintId"));
        if (fields.containsKey("type"))        existing.setType((String) fields.get("type"));
        if (fields.containsKey("severity"))    existing.setSeverity((String) fields.get("severity"));

        if (fields.containsKey("dueDate")) {
            Object v = fields.get("dueDate");
            existing.setDueDate(v == null ? null : java.time.LocalDateTime.parse(v.toString().replace("Z", "")));
        }
        if (fields.containsKey("slaHours")) {
            Object v = fields.get("slaHours");
            existing.setSlaHours(v == null ? null : ((Number) v).intValue());
        }
        if (fields.containsKey("tags")) {
            @SuppressWarnings("unchecked")
            var v = (java.util.List<String>) fields.get("tags");
            existing.setTags(v != null ? v : new java.util.ArrayList<>());
        }
        if (fields.containsKey("assigneeIds")) {
            @SuppressWarnings("unchecked")
            var v = (java.util.List<String>) fields.get("assigneeIds");
            existing.setAssigneeIds(v != null ? v : new java.util.ArrayList<>());
        }
        if (fields.containsKey("customFieldValues")) {
            @SuppressWarnings("unchecked")
            var v = (java.util.Map<String, String>) fields.get("customFieldValues");
            existing.setCustomFieldValues(v != null ? v : new java.util.HashMap<>());
        }

        return taskService.update(id, existing);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, String>> delete(@PathVariable String id) {
        taskService.delete(id);
        return ResponseEntity.ok(Map.of("message", "Task deleted"));
    }

    // ── Comments ─────────────────────────────────────────────
    @PostMapping("/{id}/comments")
    public Task addComment(@PathVariable String id,
                            @RequestBody Comment comment,
                            Authentication auth) {
        if (auth != null) comment.setAuthor(auth.getName());
        return taskService.addComment(id, comment);
    }

    @DeleteMapping("/{id}/comments/{commentId}")
    public Task deleteComment(@PathVariable String id,
                               @PathVariable String commentId) {
        return taskService.deleteComment(id, commentId);
    }

    @PostMapping("/{id}/comments/{commentId}/reactions")
    public Task toggleReaction(@PathVariable String id,
                                @PathVariable String commentId,
                                @RequestBody Map<String, String> body,
                                Authentication auth) {
        String emoji = body.get("emoji");
        String user  = auth != null ? auth.getName() : "anonymous";
        return taskService.toggleReaction(id, commentId, emoji, user);
    }

    // ── Time logs ─────────────────────────────────────────────
    @PostMapping("/{id}/timelogs")
    public Task addTimeLog(@PathVariable String id, @RequestBody TimeLog timeLog) {
        return taskService.addTimeLog(id, timeLog);
    }

    @GetMapping("/{id}/timelogs/total")
    public Map<String, Object> getTotalMinutes(@PathVariable String id) {
        return Map.of("totalMinutes", taskService.getTotalMinutes(id));
    }

    @DeleteMapping("/{id}/timelogs/{timeLogId}")
    public Task deleteTimeLog(@PathVariable String id,
                               @PathVariable String timeLogId) {
        return taskService.deleteTimeLog(id, timeLogId);
    }

    // ── Attachments ───────────────────────────────────────────
    @PostMapping("/{id}/attachments")
    public Task addAttachment(@PathVariable String id,
                               @RequestParam("file") MultipartFile file,
                               Authentication auth) throws IOException {
        return taskService.addAttachment(id, file, auth != null ? auth.getName() : null);
    }

    @GetMapping("/attachments/{fileName}")
    public ResponseEntity<?> getAttachment(
            @PathVariable String fileName) throws IOException {
        // S3 (or any cloud) provider: redirect to a short-lived signed URL
        // rather than proxying potentially-large file bytes through this
        // app server. Local provider: unchanged from before — serve the
        // file directly as a FileSystemResource.
        var presignedUrl = taskService.getAttachmentDownloadUrl(fileName);
        if (presignedUrl.isPresent()) {
            return ResponseEntity.status(302).header("Location", presignedUrl.get()).build();
        }

        var path     = taskService.getFilePath(fileName);
        var resource = new org.springframework.core.io.FileSystemResource(path);
        return ResponseEntity.ok()
                .header("Content-Disposition", "attachment; filename=\"" + path.getFileName() + "\"")
                .body(resource);
    }

    @DeleteMapping("/{id}/attachments/{attachmentId}")
    public Task deleteAttachment(@PathVariable String id,
                                  @PathVariable String attachmentId) throws IOException {
        return taskService.deleteAttachment(id, attachmentId);
    }

    // ── Dependencies ──────────────────────────────────────────
    @PostMapping("/{id}/dependencies")
    public Task addDependency(@PathVariable String id,
                               @RequestBody Map<String, String> body) {
        return taskService.addDependency(id, body.get("blockedByTaskId"));
    }

    @GetMapping("/{id}/dependencies")
    public Map<String, Object> getDependencies(@PathVariable String id) {
        return taskService.getDependencyInfo(id);
    }

    @DeleteMapping("/{id}/dependencies/{blockedByTaskId}")
    public Task removeDependency(@PathVariable String id,
                                  @PathVariable String blockedByTaskId) {
        return taskService.removeDependency(id, blockedByTaskId);
    }
}

package com.prowosma.backend.service;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.Attachment;
import com.prowosma.backend.model.Comment;
import com.prowosma.backend.model.Task;
import com.prowosma.backend.model.TimeLog;
import com.prowosma.backend.repository.TaskRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;

@Slf4j
@Service
@RequiredArgsConstructor
public class TaskService {

    private final TaskRepository taskRepository;
    private final ProjectService projectService;
    private final ActivityLogService activityLogService;
    private final RealtimeService realtimeService;
    private final FileStorageService fileStorageService;
    private final NotificationService notificationService;
    private final WorkspaceContext workspaceContext;
    private final VisibilityService visibility;

    public List<Task> getByProjectId(String projectId) {
        if (visibility.isRestricted()) return visibility.visibleTasks(workspaceContext.getWorkspaceId(), null, projectId);
        return taskRepository.findByProjectId(projectId);
    }
    public List<Task> getAll() {
        if (visibility.isRestricted()) return visibility.visibleTasks(workspaceContext.getWorkspaceId(), null, null);
        return taskRepository.findByOrganizationId(workspaceContext.getWorkspaceId());
    }
    public List<Task> getByStatus(String status) {
        if (visibility.isRestricted()) return visibility.visibleTasks(workspaceContext.getWorkspaceId(), status, null);
        return taskRepository.findByStatus(status);
    }
    public List<Task> search(String keyword) {
        List<Task> found = taskRepository.findByTitleContainingIgnoreCase(keyword);
        if (!visibility.isRestricted()) return found;
        return found.stream().filter(t -> workspaceContext.getWorkspaceId() != null
                && workspaceContext.getWorkspaceId().equals(t.getOrganizationId()) && visibility.canSeeTask(t))
                .collect(java.util.stream.Collectors.toList());
    }
    public Task getById(String id) {
        Task t = taskRepository.findById(id).orElseThrow(() -> new RuntimeException("Task not found: " + id));
        visibility.requireTaskVisible(t);
        return t;
    }

    public Task create(Task task) {
        task.setCreatedAt(LocalDateTime.now());
        task.setUpdatedAt(LocalDateTime.now());
        task.setOrganizationId(workspaceContext.getWorkspaceId());
        if (task.getCreatedBy() == null || task.getCreatedBy().isBlank()) {
            var auth = org.springframework.security.core.context.SecurityContextHolder.getContext().getAuthentication();
            if (auth != null && auth.isAuthenticated() && !"anonymousUser".equals(auth.getPrincipal())) task.setCreatedBy(auth.getName());
        }
        if (visibility.isRestricted()) {
            // the creator decides who may delete the task, so a restricted caller can't name somebody else
            var who = org.springframework.security.core.context.SecurityContextHolder.getContext().getAuthentication();
            if (who != null && who.isAuthenticated()) task.setCreatedBy(who.getName());
            visibility.requireCapability(com.prowosma.backend.access.AccessConstants.CAP_CREATE_TASK);
            // the project must be one the caller can see (404 otherwise, same as an unknown project)
            if (task.getProjectId() != null && !task.getProjectId().isBlank()) projectService.getById(task.getProjectId());
            // handing work to somebody else is a separate capability from creating it
            var scope = visibility.current();
            boolean assignsOthers = task.getAssigneeIds() != null && task.getAssigneeIds().stream()
                    .anyMatch(a -> a != null && !a.equals(scope.memberId()));
            if (assignsOthers) visibility.requireCapability(com.prowosma.backend.access.AccessConstants.CAP_ALLOCATE_TASKS);
        }
        Task saved = taskRepository.save(task);

        // Everything below is a side effect of a task that's already
        // successfully saved above — logging it, syncing a linked goal's
        // progress, notifying, broadcasting over the websocket. None of
        // these failing should turn this request into an error response:
        // the task genuinely was created, so telling the client otherwise
        // is actively misleading and (worse) invites a confused retry —
        // clicking Save again on a form that "failed" — which creates a
        // second, duplicate task, since the first one silently succeeded
        // despite the error shown. activityLogService.logFull and
        // realtimeService.broadcast already guard their own internals this
        // way; syncGoalProgress and notificationService.create did not.
        activityLogService.logFull("TASK", saved.getId(), saved.getTitle(),
                "TASK_CREATED", null, saved.getTitle(), null,
                saved.getProjectId(), saved.getId(), null);
        if (saved.getProjectId() != null) {
            try {
                projectService.syncGoalProgress(saved.getProjectId());
            } catch (Exception e) {
                log.warn("syncGoalProgress failed after creating task {}: {}", saved.getId(), e.getMessage());
            }
        }
        try {
            notificationService.create("Task Created", "New task: " + saved.getTitle(),
                    "SUCCESS", "TASK", saved.getId());
        } catch (Exception e) {
            log.warn("notificationService.create failed after creating task {}: {}", saved.getId(), e.getMessage());
        }
        realtimeService.broadcast(workspaceContext.getWorkspaceId(), "TASK_CREATED",
                "TASK", saved.getId(), saved.getTitle(), null,
                "New task created: " + saved.getTitle());
        return saved;
    }

    /**
     * Throws unless the caller may make the assignment / project move carried by {@code patched}
     * (a copy of the stored task with the PATCH applied). Call before persisting.
     */
    public void assertPatchAllowed(Task patched) {
        if (!visibility.isRestricted()) return;
        Task stored = getById(patched.getId());
        java.util.Set<String> before = new java.util.HashSet<>(stored.getAssigneeIds() == null ? List.of() : stored.getAssigneeIds());
        java.util.Set<String> after  = new java.util.HashSet<>(patched.getAssigneeIds() == null ? List.of() : patched.getAssigneeIds());
        if (!before.equals(after)) visibility.requireCapability(com.prowosma.backend.access.AccessConstants.CAP_ALLOCATE_TASKS);
        String newProject = patched.getProjectId();
        if (newProject != null && !newProject.isBlank() && !newProject.equals(stored.getProjectId())) projectService.getById(newProject);
    }

    /**
     * Persists the fields update() does not copy (project, sprint, type, severity, SLA target, assignees,
     * custom fields) from a PATCHed copy. update() reloads the task and copies only six fields, so these
     * changes would otherwise be dropped even though the PATCH answers 200.
     */
    public Task applyPatchedFields(Task patched) {
        assertPatchAllowed(patched);
        Task stored = getById(patched.getId());
        stored.setProjectId(patched.getProjectId());
        stored.setSprintId(patched.getSprintId());
        stored.setType(patched.getType());
        stored.setSeverity(patched.getSeverity());
        stored.setSlaHours(patched.getSlaHours());
        stored.setAssigneeIds(patched.getAssigneeIds());
        stored.setCustomFieldValues(patched.getCustomFieldValues());
        stored.setUpdatedAt(LocalDateTime.now());
        return taskRepository.save(stored);
    }

    public Task update(String id, Task updated) {
        Task existing = getById(id);
        String oldStatus   = existing.getStatus();
        String oldPriority = existing.getPriority();
        String oldTitle    = existing.getTitle();

        existing.setTitle(updated.getTitle());
        existing.setDescription(updated.getDescription());
        existing.setStatus(updated.getStatus());
        existing.setPriority(updated.getPriority());
        existing.setDueDate(updated.getDueDate());
        existing.setTags(updated.getTags());
        existing.setUpdatedAt(LocalDateTime.now());
        Task saved = taskRepository.save(existing);

        // Same reasoning as create() above: the task is already saved by
        // this point, so nothing from here down should be able to turn a
        // successful update into an error response — that's what was
        // letting a confused retry create a duplicate task after a
        // "failed" save that had actually already gone through.
        String eventType; String message;
        if (!oldStatus.equals(saved.getStatus())) {
            eventType = "DONE".equals(saved.getStatus()) ? "TASK_COMPLETED" : "TASK_STATUS_CHANGED";
            message   = "\"" + saved.getTitle() + "\" → " + saved.getStatus();
            activityLogService.logFull("TASK", saved.getId(), saved.getTitle(),
                    eventType, oldStatus, saved.getStatus(), null,
                    saved.getProjectId(), saved.getId(), null);
            try {
                notificationService.create("Task Status Changed", saved.getTitle() + " → " + saved.getStatus(), "INFO", "TASK", saved.getId());
            } catch (Exception e) {
                log.warn("notificationService.create failed after updating task {}: {}", saved.getId(), e.getMessage());
            }
        } else if (!oldPriority.equals(saved.getPriority())) {
            eventType = "TASK_PRIORITY_CHANGED";
            message   = "Priority of \"" + saved.getTitle() + "\" changed to " + saved.getPriority();
            activityLogService.logFull("TASK", saved.getId(), saved.getTitle(),
                    eventType, oldPriority, saved.getPriority(), null,
                    saved.getProjectId(), saved.getId(), null);
        } else {
            eventType = "TASK_UPDATED";
            message   = "\"" + saved.getTitle() + "\" was updated";
            activityLogService.logFull("TASK", saved.getId(), saved.getTitle(),
                    eventType, oldTitle, saved.getTitle(), null,
                    saved.getProjectId(), saved.getId(), null);
        }
        realtimeService.broadcast(workspaceContext.getWorkspaceId(), eventType,
                "TASK", saved.getId(), saved.getTitle(), null, message);

        if (saved.getProjectId() != null) {
            try {
                projectService.syncGoalProgress(saved.getProjectId());
            } catch (Exception e) {
                log.warn("syncGoalProgress failed after updating task {}: {}", saved.getId(), e.getMessage());
            }
        }
        return saved;
    }

    public List<Task> getByProject(String projectId) { return getByProjectId(projectId); }

    public Task updateRaw(String id, Task updated) {
        updated.setUpdatedAt(LocalDateTime.now());
        return taskRepository.save(updated);
    }

    public void delete(String id) {
        Task task = getById(id);
        visibility.requireCanDeleteTask(task);
        activityLogService.logFull("TASK", id, task.getTitle(),
                "TASK_DELETED", task.getTitle(), null, null,
                task.getProjectId(), id, null);
        realtimeService.broadcast(workspaceContext.getWorkspaceId(), "TASK_DELETED",
                "TASK", id, task.getTitle(), null, "Task deleted: " + task.getTitle());
        taskRepository.deleteById(id);
    }

    public void processRecurringTasks() {
        LocalDateTime now = LocalDateTime.now();
        for (Task task : taskRepository.findByStatus("DONE")) {
            if (task.getRecurrence() == null || "NONE".equals(task.getRecurrence())) continue;
            LocalDateTime base = task.getDueDate() != null ? task.getDueDate() : now;
            LocalDateTime nextDue = switch (task.getRecurrence()) {
                case "DAILY"   -> base.plusDays(1);
                case "WEEKLY"  -> base.plusWeeks(1);
                case "MONTHLY" -> base.plusMonths(1);
                default -> null;
            };
            if (nextDue != null && nextDue.isBefore(now)) {
                Task newTask = new Task();
                newTask.setTitle(task.getTitle()); newTask.setDescription(task.getDescription());
                newTask.setProjectId(task.getProjectId()); newTask.setPriority(task.getPriority());
                newTask.setTags(task.getTags()); newTask.setRecurrence(task.getRecurrence());
                newTask.setStatus("TODO"); newTask.setDueDate(nextDue);
                newTask.setCreatedAt(now); newTask.setUpdatedAt(now);
                newTask.setOrganizationId(workspaceContext.getWorkspaceId());
                taskRepository.save(newTask);
                task.setRecurrence("NONE"); task.setUpdatedAt(now);
                taskRepository.save(task);
            }
        }
    }

    public Task addComment(String id, Comment comment) {
        Task task = getById(id);
        if (task.getComments() == null) task.setComments(new java.util.ArrayList<>());
        task.getComments().add(comment);
        task.setUpdatedAt(LocalDateTime.now());
        activityLogService.logFull("TASK", task.getId(), task.getTitle(),
                "TASK_UPDATED", null, "Comment added", null,
                task.getProjectId(), task.getId(), null);
        realtimeService.broadcast(workspaceContext.getWorkspaceId(), "TASK_COMMENTED",
                "TASK", task.getId(), task.getTitle(), null,
                "Comment added to \"" + task.getTitle() + "\"");
        return taskRepository.save(task);
    }

    public Task deleteComment(String id, String commentId) {
        Task task = getById(id);
        task.getComments().removeIf(c -> c.getId().equals(commentId));
        task.setUpdatedAt(LocalDateTime.now());
        return taskRepository.save(task);
    }

    public Task addTimeLog(String id, TimeLog timeLog) {
        Task task = getById(id);
        if (task.getTimeLogs() == null) task.setTimeLogs(new java.util.ArrayList<>());
        task.getTimeLogs().add(timeLog);
        task.setUpdatedAt(LocalDateTime.now());
        activityLogService.logFull("TASK", task.getId(), task.getTitle(),
                "TIME_LOGGED", null, timeLog.getMinutes() + " min",
                null, task.getProjectId(), task.getId(), null);
        return taskRepository.save(task);
    }

    public Task deleteTimeLog(String id, String timeLogId) {
        Task task = getById(id);
        task.getTimeLogs().removeIf(t -> t.getId().equals(timeLogId));
        task.setUpdatedAt(LocalDateTime.now());
        return taskRepository.save(task);
    }

    public int getTotalMinutes(String id) {
        Task task = getById(id);
        if (task.getTimeLogs() == null) return 0;
        return task.getTimeLogs().stream().mapToInt(TimeLog::getMinutes).sum();
    }

    public Task addAttachment(String id, org.springframework.web.multipart.MultipartFile file,
                              String uploadedBy) throws java.io.IOException {
        Task task = getById(id);
        if (task.getAttachments() == null) task.setAttachments(new java.util.ArrayList<>());
        String fileName = fileStorageService.store(file);
        Attachment attachment = new Attachment();
        attachment.setFileName(fileName); attachment.setOriginalName(file.getOriginalFilename());
        attachment.setFileType(file.getContentType()); attachment.setFileSize(file.getSize());
        attachment.setUploadedBy(uploadedBy != null ? uploadedBy : "User");
        task.getAttachments().add(attachment);
        task.setUpdatedAt(LocalDateTime.now());
        activityLogService.logFull("TASK", task.getId(), task.getTitle(),
                "TASK_UPDATED", null, "Attachment added: " + file.getOriginalFilename(),
                uploadedBy, task.getProjectId(), task.getId(), null);
        return taskRepository.save(task);
    }

    public Task deleteAttachment(String id, String attachmentId) throws java.io.IOException {
        Task task = getById(id);
        task.getAttachments().stream().filter(a -> a.getId().equals(attachmentId)).findFirst()
                .ifPresent(a -> { try { fileStorageService.delete(a.getFileName()); } catch (java.io.IOException e) { e.printStackTrace(); } });
        task.getAttachments().removeIf(a -> a.getId().equals(attachmentId));
        task.setUpdatedAt(LocalDateTime.now());
        return taskRepository.save(task);
    }

    public java.nio.file.Path getFilePath(String fileName) {
        return fileStorageService.localPath(fileName).orElseThrow(() ->
            new IllegalStateException("This deployment uses cloud file storage — " +
                "use getAttachmentDownloadUrl() instead of getFilePath()."));
    }

    /**
     * S3 provider: a short-lived signed URL. Local provider: empty — the
     * caller (TaskController) falls back to serving the file directly via
     * getFilePath() + FileSystemResource instead, exactly as before.
     */
    public java.util.Optional<String> getAttachmentDownloadUrl(String fileName) {
        return fileStorageService.presignedDownloadUrl(fileName, java.time.Duration.ofMinutes(10));
    }

    public Task addDependency(String id, String blockedByTaskId) {
        if (id.equals(blockedByTaskId)) throw new RuntimeException("Task cannot depend on itself");
        Task task = getById(id); Task blocker = getById(blockedByTaskId);
        if (task.getBlockedByTaskIds() == null) task.setBlockedByTaskIds(new java.util.ArrayList<>());
        if (task.getBlockedByTaskIds().contains(blockedByTaskId)) throw new RuntimeException("Dependency already exists");
        task.getBlockedByTaskIds().add(blockedByTaskId);
        task.setUpdatedAt(LocalDateTime.now());
        activityLogService.logFull("TASK", task.getId(), task.getTitle(),
                "TASK_BLOCKED", null, "Blocked by: " + blocker.getTitle(), null,
                task.getProjectId(), task.getId(), null);
        return taskRepository.save(task);
    }

    public Task removeDependency(String id, String blockedByTaskId) {
        Task task = getById(id);
        task.getBlockedByTaskIds().remove(blockedByTaskId);
        task.setUpdatedAt(LocalDateTime.now());
        activityLogService.logFull("TASK", task.getId(), task.getTitle(),
                "TASK_UNBLOCKED", blockedByTaskId, null, null,
                task.getProjectId(), task.getId(), null);
        return taskRepository.save(task);
    }

    public java.util.Map<String, Object> getDependencyInfo(String id) {
        Task task = getById(id);
        java.util.List<Task> blockedBy = new java.util.ArrayList<>();
        if (task.getBlockedByTaskIds() != null)
            task.getBlockedByTaskIds().forEach(bid -> taskRepository.findById(bid).filter(visibility::canSeeTask).ifPresent(blockedBy::add));
        List<Task> blocking = taskRepository.findByOrganizationId(workspaceContext.getWorkspaceId()).stream()
                .filter(t -> t.getBlockedByTaskIds() != null && t.getBlockedByTaskIds().contains(id))
                .filter(visibility::canSeeTask)
                .collect(java.util.stream.Collectors.toList());
        boolean isBlocked = blockedBy.stream().anyMatch(t -> !"DONE".equals(t.getStatus()));
        java.util.Map<String, Object> result = new java.util.HashMap<>();
        result.put("blockedBy", blockedBy); result.put("blocking", blocking); result.put("isBlocked", isBlocked);
        return result;
    }

    // ── A-10: Comment reactions ───────────────────────────────────

    public Task toggleReaction(String taskId, String commentId, String emoji, String userEmail) {
        Task task = getById(taskId);
        task.getComments().stream()
            .filter(c -> commentId.equals(c.getId())).findFirst()
            .ifPresent(c -> {
                if (c.getReactions() == null) c.setReactions(new java.util.LinkedHashMap<>());
                java.util.List<String> users = c.getReactions()
                    .computeIfAbsent(emoji, k -> new java.util.ArrayList<>());
                if (users.contains(userEmail)) users.remove(userEmail);
                else                           users.add(userEmail);
                if (users.isEmpty()) c.getReactions().remove(emoji);
            });
        task.setUpdatedAt(java.time.LocalDateTime.now());
        return taskRepository.save(task);
    }


    // ── Paginated queries (Fix-1) ─────────────────────────────
    public com.prowosma.backend.util.PagedResponse<Task> getAllPaged(
            org.springframework.data.domain.PageRequest pr,
            String status, String projectId) {
        String orgId = workspaceContext.getWorkspaceId();
        if (visibility.isRestricted()) {
            return com.prowosma.backend.util.PagedResponse.of(visibility.visibleTasksPage(orgId, status, projectId, pr));
        }
        if (projectId != null && !projectId.isBlank()) {
            return com.prowosma.backend.util.PagedResponse.of(
                    taskRepository.findByProjectId(projectId, pr));
        }
        if (status != null && !status.isBlank()) {
            return com.prowosma.backend.util.PagedResponse.of(
                    taskRepository.findByOrganizationIdAndStatus(orgId, status.toUpperCase(), pr));
        }
        return com.prowosma.backend.util.PagedResponse.of(
                taskRepository.findByOrganizationId(orgId, pr));
    }

    public com.prowosma.backend.util.PagedResponse<Task> getByProjectPaged(
            String projectId,
            org.springframework.data.domain.PageRequest pr) {
        if (visibility.isRestricted()) {
            return com.prowosma.backend.util.PagedResponse.of(
                    visibility.visibleTasksPage(workspaceContext.getWorkspaceId(), null, projectId, pr));
        }
        return com.prowosma.backend.util.PagedResponse.of(
                taskRepository.findByProjectId(projectId, pr));
    }
}


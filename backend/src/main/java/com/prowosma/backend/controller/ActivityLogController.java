package com.prowosma.backend.controller;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.ActivityLog;
import com.prowosma.backend.repository.ActivityLogRepository;
import io.swagger.v3.oas.annotations.tags.Tag;
import com.prowosma.backend.util.PagedResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.*;

@RestController
@RequestMapping("/api/activity-logs")
@Tag(name = "Activity Logs", description = "Audit trail and activity history")
@RequiredArgsConstructor
public class ActivityLogController {

    private final ActivityLogRepository activityLogRepository;
    private final WorkspaceContext      workspaceContext;
    private final com.prowosma.backend.service.ActivityLogService activityLogService;
    private final com.prowosma.backend.service.VisibilityService visibility;
    private final org.springframework.data.mongodb.core.MongoTemplate mongo;
    private final com.prowosma.backend.repository.TaskRepository tasks;
    private final com.prowosma.backend.repository.TeamMemberRepository teamMembers;
    private final com.prowosma.backend.repository.UserRepository users;

    /** The kind of change, for the history filters. */
    static String kindOf(String action) {
        String a = action == null ? "" : action.toUpperCase(Locale.ROOT);
        return switch (a) {
            case "TASK_CREATED", "TASK_AUTO_CREATED", "TASK_ADDED" -> "CREATED";
            case "TASK_STATUS_CHANGED", "TASK_COMPLETED", "TASK_BLOCKED", "TASK_UNBLOCKED" -> "STATUS";
            case "TASK_ASSIGNED", "TASK_UNASSIGNED" -> "ASSIGNMENT";
            case "TASK_PRIORITY_CHANGED" -> "PRIORITY";
            case "TASK_DUE_CHANGED" -> "DUE";
            case "TASK_COMMENTED" -> "COMMENT";
            case "FILE_ATTACHED" -> "FILE";
            case "TIME_LOGGED", "TIME_APPROVED" -> "TIME";
            case "TASK_RENAMED", "TASK_DESCRIPTION_CHANGED", "TASK_UPDATED" -> "DETAILS";
            case "TASK_DELETED", "TASK_REMOVED" -> "DELETED";
            default -> "OTHER";
        };
    }

    /**
     * One task's history, and nothing else: entries recorded for this task (by taskId, or as the entity), newest first,
     * each with its kind. Filtering by person / kind / time happens in the History window, so it's instant.
     */
    @GetMapping("/task/{taskId}")
    public Map<String, Object> taskHistory(@PathVariable String taskId) {
        String orgId = workspaceContext.getWorkspaceId();
        var task = tasks.findById(taskId).filter(t -> orgId != null && orgId.equals(t.getOrganizationId()))
                .orElseThrow(() -> new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.NOT_FOUND, "Task not found"));
        visibility.requireTaskVisible(task);
        var q = new org.springframework.data.mongodb.core.query.Query(
                org.springframework.data.mongodb.core.query.Criteria.where("organizationId").is(orgId).orOperator(
                        org.springframework.data.mongodb.core.query.Criteria.where("taskId").is(taskId),
                        org.springframework.data.mongodb.core.query.Criteria.where("entityId").is(taskId)))
                .with(org.springframework.data.domain.Sort.by(org.springframework.data.domain.Sort.Direction.DESC, "createdAt")).limit(2000);
        List<Map<String, Object>> entries = new ArrayList<>();
        // People's real names (the log stores an email; its display name is often just the part before the @).
        Map<String, String> names = new HashMap<>();
        teamMembers.findByOrganizationId(orgId).forEach(m -> { if (m.getEmail() != null && m.getName() != null) names.put(m.getEmail().toLowerCase(Locale.ROOT), m.getName()); });
        for (ActivityLog l : mongo.find(q, ActivityLog.class)) {
            Map<String, Object> e = new LinkedHashMap<>();
            e.put("id", l.getId());
            e.put("at", l.getCreatedAt());
            e.put("action", l.getAction());
            e.put("kind", kindOf(l.getAction()));
            String by = l.getPerformedBy() != null ? l.getPerformedBy() : l.getActor();
            e.put("by", by == null ? "System" : by);
            String key = by == null ? null : by.toLowerCase(Locale.ROOT);
            String name = key == null ? null : names.computeIfAbsent(key, k -> users.findByEmail(k).map(u -> u.getName()).filter(n -> n != null && !n.isBlank()).orElse(null));
            e.put("byName", name != null ? name : l.getPerformedByName() != null ? l.getPerformedByName() : (by == null ? "System" : by));
            e.put("oldValue", l.getOldValue());
            e.put("newValue", l.getNewValue());
            entries.add(e);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("taskId", task.getId());
        out.put("taskTitle", task.getTitle());
        out.put("entries", entries);
        return out;
    }

    /** Restricted callers see entries about tasks and projects they can see. Everything else (team, workspace, goals ...) is hidden. */
    private boolean canSeeLog(com.prowosma.backend.service.VisibilityService.EntityVisibility ev, ActivityLog log) {
        if (!ev.restricted()) return true;
        if (log.getTaskId() != null && !log.getTaskId().isBlank()) return ev.canSee("TASK", log.getTaskId());
        String t = log.getEntityType() == null ? "" : log.getEntityType().trim().toUpperCase(Locale.ROOT);
        if (t.equals("TASK") || t.equals("PROJECT")) return ev.canSee(t, log.getEntityId());
        if (log.getProjectId() != null && !log.getProjectId().isBlank()) return ev.canSee("PROJECT", log.getProjectId());
        return false;
    }

    @GetMapping
    public PagedResponse<ActivityLog> getAll(
            @RequestParam(defaultValue = "50") int limit,
            @RequestParam(defaultValue = "0")  int page,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime to,
            @RequestParam(required = false) String taskId,
            @RequestParam(required = false) String projectId,
            @RequestParam(required = false) String goalId) {
        String orgId = workspaceContext.getWorkspaceId();
        PageRequest pr = PageRequest.of(page, Math.min(limit, 200));
        // One task / project / goal's history: only its own entries (these parameters used to be ignored, so a task's
        // "activity" showed the whole workspace's log).
        if (taskId != null || projectId != null || goalId != null) {
            String field = taskId != null ? "taskId" : projectId != null ? "projectId" : "goalId";
            String value = taskId != null ? taskId : projectId != null ? projectId : goalId;
            var q = new org.springframework.data.mongodb.core.query.Query(
                    org.springframework.data.mongodb.core.query.Criteria.where("organizationId").is(orgId).orOperator(
                            org.springframework.data.mongodb.core.query.Criteria.where(field).is(value),
                            org.springframework.data.mongodb.core.query.Criteria.where("entityId").is(value)))
                    .with(org.springframework.data.domain.Sort.by(org.springframework.data.domain.Sort.Direction.DESC, "createdAt")).limit(2000);
            var ev = visibility.entityVisibility();
            List<ActivityLog> own = mongo.find(q, ActivityLog.class).stream().filter(l -> canSeeLog(ev, l)).toList();
            return PagedResponse.ofList(own, page, Math.min(limit, 200));
        }
        if (visibility.isRestricted()) {
            // filter the newest entries, then page what is left (a database page would be filtered after the fact and come up short)
            var ev = visibility.entityVisibility();
            List<ActivityLog> source = (from != null && to != null)
                    ? activityLogRepository.findByOrganizationIdAndCreatedAtBetweenOrderByCreatedAtDesc(orgId, from, to)
                    : activityLogRepository.findByOrganizationIdOrderByCreatedAtDesc(orgId, PageRequest.of(0, 2000));
            List<ActivityLog> mine = source.stream().filter(l -> canSeeLog(ev, l)).toList();
            return PagedResponse.ofList(mine, page, Math.min(limit, 200));
        }
        if (from != null && to != null) {
            var dated = activityLogRepository.findByOrganizationIdAndCreatedAtBetweenOrderByCreatedAtDesc(orgId, from, to);
            return PagedResponse.ofList(dated, page, Math.min(limit, 200));
        }
        return PagedResponse.ofList(
                activityLogRepository.findByOrganizationIdOrderByCreatedAtDesc(orgId, pr),
                page, Math.min(limit, 200));
    }

    @GetMapping("/{id}")
    public ActivityLog getById(@PathVariable String id) {
        return activityLogRepository.findById(id)
                .filter(l -> canSeeLog(visibility.entityVisibility(), l))
                .orElseThrow(() -> new RuntimeException("Activity log not found: " + id));
    }

    /**
     * Full change history for a single entity — powers the "History &
     * Traceability" view (e.g. a meeting action item's status history
     * across meetings). activityLogService.getByEntity() itself has no
     * workspace filter, so — same defensive pattern already used by
     * DecisionController.getByDoc() — results are filtered to the
     * caller's workspace here before being returned.
     */
    @GetMapping("/entity/{entityType}/{entityId}")
    public List<ActivityLog> getByEntity(@PathVariable String entityType, @PathVariable String entityId) {
        String orgId = workspaceContext.getWorkspaceId();
        var ev = visibility.entityVisibility();
        return activityLogService.getByEntity(entityType, entityId).stream()
                .filter(log -> orgId != null && orgId.equals(log.getOrganizationId()))
                .filter(log -> canSeeLog(ev, log))
                .toList();
    }

    @GetMapping("/export/csv")
    public ResponseEntity<String> exportCsv(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime to) {
        String orgId = workspaceContext.getWorkspaceId();
        List<ActivityLog> logs = (from != null && to != null)
                ? activityLogRepository.findByOrganizationIdAndCreatedAtBetweenOrderByCreatedAtDesc(orgId, from, to)
                : activityLogRepository.findByOrganizationIdOrderByCreatedAtDesc(orgId, PageRequest.of(0, 10000));

        StringBuilder csv = new StringBuilder("Date,Time,Performed By,Action,Entity Type,Entity,Details\n");
        java.time.format.DateTimeFormatter dateFmt = java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd");
        java.time.format.DateTimeFormatter timeFmt = java.time.format.DateTimeFormatter.ofPattern("HH:mm:ss");
        for (ActivityLog log : logs) {
            LocalDateTime ts = log.getCreatedAt();
            String performedBy = log.getPerformedBy() != null ? log.getPerformedBy() : log.getActor();
            csv.append(String.format("%s,%s,%s,%s,%s,%s,%s\n",
                    safe(ts != null ? ts.format(dateFmt) : ""),
                    safe(ts != null ? ts.format(timeFmt) : ""),
                    safe(performedBy),
                    safe(log.getAction()),
                    safe(log.getEntityType()),
                    safe(log.getEntityTitle()),    // field: entityTitle
                    safe(log.getDetails())         // field: details
            ));
        }
        return ResponseEntity.ok()
                .header("Content-Type", "text/csv")
                .header("Content-Disposition", "attachment; filename=\"audit-log.csv\"")
                .body(csv.toString());
    }

    /**
     * Verifies this workspace's audit log hash chain (see
     * ActivityLogService.attachHashChain's own comments for the design
     * and its documented known limitation). Returns the ID of the first
     * entry where the chain breaks, or a clean result if it's intact.
     *
     * A broken chain means one of two things: (a) a record was modified
     * or deleted outside the application (direct database access bypassing
     * the append-only repository interface entirely), or (b) the known,
     * documented concurrent-write race in attachHashChain — see that
     * method's comments for how to tell the difference (the benign race
     * only ever produces an isolated single break with a legitimate
     * concurrent entry nearby in time; a malicious deletion produces a
     * gap with no such explanation).
     */
    @GetMapping("/verify-integrity")
    public Map<String, Object> verifyIntegrity() {
        String orgId = workspaceContext.getWorkspaceId();
        var brokenAt = activityLogService.verifyChainIntegrity(orgId);
        return brokenAt.<Map<String, Object>>map(id -> Map.of(
                        "intact", false,
                        "brokenAtEntryId", id,
                        "message", "Chain integrity check failed at entry " + id + " — see this endpoint's own " +
                                "documentation for how to distinguish a benign concurrent-write race from genuine tampering."
                ))
                .orElseGet(() -> Map.of(
                        "intact", true,
                        "message", "Full audit trail hash chain verified intact for this workspace."
                ));
    }

    @GetMapping("/summary")
    public Map<String, Object> summary() {
        String orgId = workspaceContext.getWorkspaceId();
        List<ActivityLog> recent = activityLogRepository
                .findByOrganizationIdOrderByCreatedAtDesc(orgId, PageRequest.of(0, 1000));
        long total = activityLogRepository.countByOrganizationId(orgId);
        long today = recent.stream().filter(l -> l.getCreatedAt() != null &&
                l.getCreatedAt().toLocalDate().isEqual(LocalDateTime.now().toLocalDate())).count();
        Map<String, Long> byAction = new LinkedHashMap<>();
        recent.forEach(l -> { if (l.getAction() != null) byAction.merge(l.getAction(), 1L, Long::sum); });
        return Map.of("total", total, "today", today, "byAction", byAction);
    }

    private String safe(Object v) {
        if (v == null) return "";
        return "\"" + v.toString().replace("\"", "\"\"") + "\"";
    }
}
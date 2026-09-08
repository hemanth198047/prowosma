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

    @GetMapping
    public PagedResponse<ActivityLog> getAll(
            @RequestParam(defaultValue = "50") int limit,
            @RequestParam(defaultValue = "0")  int page,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime to) {
        String orgId = workspaceContext.getWorkspaceId();
        PageRequest pr = PageRequest.of(page, Math.min(limit, 200));
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
        return activityLogService.getByEntity(entityType, entityId).stream()
                .filter(log -> orgId != null && orgId.equals(log.getOrganizationId()))
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
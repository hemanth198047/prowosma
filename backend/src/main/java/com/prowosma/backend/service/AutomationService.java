package com.prowosma.backend.service;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.*;
import com.prowosma.backend.repository.*;
import com.prowosma.backend.service.ActivityLogService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.*;

@Slf4j
@Service
@RequiredArgsConstructor
public class AutomationService {

    private final AutomationRepository     automationRepository;
    private final ApprovalRequestRepository approvalRepository;
    private final TaskRepository           taskRepository;
    private final NotificationService      notificationService;
    private final WorkspaceContext         workspaceContext;
    private final ActivityLogService      activityLogService;

    // ── CRUD ─────────────────────────────────────────────────────

    public List<Automation> getAll() {
        return automationRepository.findByOrganizationId(workspaceContext.getWorkspaceId());
    }

    public Automation getById(String id) {
        return automationRepository.findById(id)
            .orElseThrow(() -> new RuntimeException("Automation not found: " + id));
    }

    public Automation create(Automation a, String author) {
        a.setOrganizationId(workspaceContext.getWorkspaceId());
        a.setCreatedBy(author);
        a.setCreatedAt(LocalDateTime.now());
        a.setUpdatedAt(LocalDateTime.now());
        // Assign IDs to conditions and actions
        if (a.getConditions() != null)
            a.getConditions().forEach(c -> { if (c.getId() == null) c.setId(UUID.randomUUID().toString()); });
        if (a.getActions() != null)
            a.getActions().forEach(ac -> { if (ac.getId() == null) ac.setId(UUID.randomUUID().toString()); });
        Automation saved = automationRepository.save(a);
        activityLogService.log("AUTOMATION", saved.getId(), saved.getName(),
                "CREATED", null, saved.getName(), author);
        return saved;
    }

    public Automation update(String id, Automation patch) {
        Automation existing = getById(id);
        if (patch.getName()        != null) existing.setName(patch.getName());
        if (patch.getDescription() != null) existing.setDescription(patch.getDescription());
        if (patch.getTriggerType() != null) existing.setTriggerType(patch.getTriggerType());
        if (patch.getTriggerConfig()!= null) existing.setTriggerConfig(patch.getTriggerConfig());
        if (patch.getConditions()  != null) existing.setConditions(patch.getConditions());
        if (patch.getActions()     != null) existing.setActions(patch.getActions());
        if (patch.getConditionOperator() != null) existing.setConditionOperator(patch.getConditionOperator());
        existing.setEnabled(patch.isEnabled());
        existing.setUpdatedAt(LocalDateTime.now());
        return automationRepository.save(existing);
    }

    public void delete(String id) {
        getById(id); // verify exists
        activityLogService.log("AUTOMATION", id, id,
                "DELETED", null, null, null);
        automationRepository.deleteById(id);
    }

    public Automation toggle(String id) {
        Automation a = getById(id);
        a.setEnabled(!a.isEnabled());
        a.setUpdatedAt(LocalDateTime.now());
        Automation saved = automationRepository.save(a);
        activityLogService.log("AUTOMATION", saved.getId(), saved.getName(),
                "TOGGLED", null, String.valueOf(saved.isEnabled()), null);
        return saved;
    }

    // ── Execution engine ─────────────────────────────────────────

    /**
     * Called by controllers when a trigger event occurs.
     * Finds matching automations, evaluates conditions, runs actions.
     */
    public void trigger(String triggerType, String entityType, String entityId,
                        Map<String, Object> context) {
        String orgId = workspaceContext.getWorkspaceId();
        if (orgId == null) return;

        List<Automation> candidates = automationRepository
            .findByOrganizationIdAndTriggerType(orgId, triggerType)
            .stream().filter(Automation::isEnabled).toList();

        for (Automation automation : candidates) {
            try {
                if (evaluateConditions(automation, context)) {
                    executeActions(automation, entityType, entityId, context);
                    logExecution(automation, entityType, entityId, true, "OK");
                }
            } catch (Exception e) {
                log.warn("Automation {} failed: {}", automation.getId(), e.getMessage());
                logExecution(automation, entityType, entityId, false, e.getMessage());
            }
        }
    }

    private boolean evaluateConditions(Automation automation, Map<String, Object> ctx) {
        List<Automation.Condition> conditions = automation.getConditions();
        if (conditions == null || conditions.isEmpty()) return true;

        boolean isAnd = !"OR".equals(automation.getConditionOperator());
        for (Automation.Condition c : conditions) {
            boolean result = evaluateCondition(c, ctx);
            if (isAnd && !result) return false;
            if (!isAnd && result)  return true;
        }
        return isAnd; // AND: all passed | OR: none passed
    }

    private boolean evaluateCondition(Automation.Condition c, Map<String, Object> ctx) {
        Object actual = ctx.get(c.getField());
        String actualStr = actual != null ? actual.toString() : "";
        String expected  = c.getValue() != null ? c.getValue() : "";

        return switch (c.getOperator()) {
            case "equals"        -> actualStr.equalsIgnoreCase(expected);
            case "not_equals"    -> !actualStr.equalsIgnoreCase(expected);
            case "contains"      -> actualStr.toLowerCase().contains(expected.toLowerCase());
            case "is_empty"      -> actualStr.isBlank();
            case "is_not_empty"  -> !actualStr.isBlank();
            default              -> true;
        };
    }

    private void executeActions(Automation automation, String entityType,
                                String entityId, Map<String, Object> ctx) {
        for (Automation.Action action : automation.getActions()) {
            Map<String, Object> cfg = action.getConfig() != null ? action.getConfig() : Map.of();
            switch (action.getType()) {
                case "SEND_NOTIFICATION" -> {
                    String msg = interpolate((String) cfg.getOrDefault("message", "Automation triggered"), ctx);
                    notificationService.create(
                        (String) cfg.getOrDefault("title", automation.getName()),
                        msg, "INFO", entityType, entityId);
                }
                case "CHANGE_STATUS" -> {
                    if ("TASK".equals(entityType)) {
                        taskRepository.findById(entityId).ifPresent(t -> {
                            t.setStatus((String) cfg.getOrDefault("status", t.getStatus()));
                            t.setUpdatedAt(LocalDateTime.now());
                            taskRepository.save(t);
                        });
                    }
                }
                case "CHANGE_PRIORITY" -> {
                    if ("TASK".equals(entityType)) {
                        taskRepository.findById(entityId).ifPresent(t -> {
                            t.setPriority((String) cfg.getOrDefault("priority", t.getPriority()));
                            t.setUpdatedAt(LocalDateTime.now());
                            taskRepository.save(t);
                        });
                    }
                }
                case "ADD_TAG" -> {
                    if ("TASK".equals(entityType)) {
                        String tag = (String) cfg.getOrDefault("tag", "");
                        taskRepository.findById(entityId).ifPresent(t -> {
                            if (t.getTags() == null) t.setTags(new ArrayList<>());
                            if (!t.getTags().contains(tag)) t.getTags().add(tag);
                            taskRepository.save(t);
                        });
                    }
                }
                case "POST_COMMENT" -> {
                    if ("TASK".equals(entityType)) {
                        String text = interpolate((String) cfg.getOrDefault("comment", ""), ctx);
                        taskRepository.findById(entityId).ifPresent(t -> {
                            Comment comment = new Comment();
                            comment.setId(UUID.randomUUID().toString());
                            comment.setAuthor("Automation: " + automation.getName());
                            comment.setText(text);
                            comment.setCreatedAt(LocalDateTime.now());
                            if (t.getComments() == null) t.setComments(new ArrayList<>());
                            t.getComments().add(comment);
                            taskRepository.save(t);
                        });
                    }
                }
                case "REQUEST_APPROVAL" -> {
                    createApprovalFromAction(automation, entityType, entityId, cfg, ctx);
                }
                default -> log.debug("Unknown action type: {}", action.getType());
            }
        }
        automation.setRunCount(automation.getRunCount() + 1);
        automation.setLastRunAt(LocalDateTime.now());
        automationRepository.save(automation);
    }

    private String interpolate(String template, Map<String, Object> ctx) {
        String result = template;
        for (Map.Entry<String, Object> e : ctx.entrySet()) {
            result = result.replace("{{" + e.getKey() + "}}", e.getValue() != null ? e.getValue().toString() : "");
        }
        return result;
    }

    private void createApprovalFromAction(Automation automation, String entityType,
                                          String entityId, Map<String, Object> cfg,
                                          Map<String, Object> ctx) {
        ApprovalRequest req = new ApprovalRequest();
        req.setOrganizationId(workspaceContext.getWorkspaceId());
        req.setTitle(interpolate((String) cfg.getOrDefault("title", "Approval Required"), ctx));
        req.setDescription(interpolate((String) cfg.getOrDefault("description", ""), ctx));
        req.setRequestedBy((String) ctx.getOrDefault("actor", "system"));
        req.setEntityType(entityType);
        req.setEntityId(entityId);
        req.setAutomationId(automation.getId());
        req.setChainType((String) cfg.getOrDefault("chainType", "SEQUENTIAL"));
        req.setSlaHours(((Number) cfg.getOrDefault("slaHours", 24)).intValue());
        req.setEscalateTo((String) cfg.getOrDefault("escalateTo", null));
        req.setEscalateAt(LocalDateTime.now().plusHours(req.getSlaHours()));

        // Build approver steps from config
        @SuppressWarnings("unchecked")
        List<String> approvers = (List<String>) cfg.getOrDefault("approvers", List.of());
        List<ApprovalRequest.ApprovalStep> steps = new ArrayList<>();
        for (int i = 0; i < approvers.size(); i++) {
            ApprovalRequest.ApprovalStep step = new ApprovalRequest.ApprovalStep();
            step.setId(UUID.randomUUID().toString());
            step.setOrder(i + 1);
            step.setApproverEmail(approvers.get(i));
            step.setStatus("PENDING");
            steps.add(step);
        }
        req.setSteps(steps);
        approvalRepository.save(req);

        notificationService.create(
            "Approval Required: " + req.getTitle(),
            "Please review and approve this request",
            "WARNING", entityType, entityId);
    }

    private void logExecution(Automation automation, String entityType,
                              String entityId, boolean success, String message) {
        Automation.ExecutionLog log = new Automation.ExecutionLog();
        log.setId(UUID.randomUUID().toString());
        log.setEntityType(entityType);
        log.setEntityId(entityId);
        log.setSuccess(success);
        log.setMessage(message);
        log.setExecutedAt(LocalDateTime.now());

        List<Automation.ExecutionLog> logs = automation.getRecentLogs();
        if (logs == null) logs = new ArrayList<>();
        logs.add(0, log);
        if (logs.size() > 20) logs = logs.subList(0, 20);
        automation.setRecentLogs(logs);
        if (!success) automation.setFailCount(automation.getFailCount() + 1);
    }

    // ── Approval workflow ────────────────────────────────────────

    public List<ApprovalRequest> getAllApprovals() {
        return approvalRepository.findByOrganizationId(workspaceContext.getWorkspaceId());
    }

    public ApprovalRequest getApprovalById(String id) {
        return approvalRepository.findById(id)
            .orElseThrow(() -> new RuntimeException("Approval not found"));
    }

    public ApprovalRequest createApproval(ApprovalRequest req, String author) {
        req.setOrganizationId(workspaceContext.getWorkspaceId());
        req.setRequestedBy(author);
        req.setCreatedAt(LocalDateTime.now());
        req.setUpdatedAt(LocalDateTime.now());
        req.setEscalateAt(LocalDateTime.now().plusHours(req.getSlaHours() > 0 ? req.getSlaHours() : 24));

        // Assign step IDs
        if (req.getSteps() != null) {
            int order = 1;
            for (ApprovalRequest.ApprovalStep step : req.getSteps()) {
                if (step.getId() == null) step.setId(UUID.randomUUID().toString());
                step.setOrder(order++);
                step.setStatus("PENDING");
            }
        }
        return approvalRepository.save(req);
    }

    public ApprovalRequest respond(String approvalId, String stepId,
                                   String decision, String comment, String responder) {
        ApprovalRequest req = getApprovalById(approvalId);
        if (!"PENDING".equals(req.getStatus()) && !"ESCALATED".equals(req.getStatus()))
            throw new RuntimeException("Approval already resolved");

        ApprovalRequest.ApprovalStep step = req.getSteps().stream()
            .filter(s -> stepId.equals(s.getId())).findFirst()
            .orElseThrow(() -> new RuntimeException("Step not found"));

        step.setStatus(decision); // APPROVED or REJECTED
        step.setComment(comment);
        step.setRespondedAt(LocalDateTime.now());

        if ("REJECTED".equals(decision)) {
            req.setStatus("REJECTED");
            req.setResolvedAt(LocalDateTime.now());
            req.setResolvedBy(responder);
            req.setRejectionReason(comment);
        } else {
            // Check if all required steps are approved
            boolean allDone = req.getSteps().stream()
                .allMatch(s -> "APPROVED".equals(s.getStatus()) || "SKIPPED".equals(s.getStatus()));
            if (allDone) {
                req.setStatus("APPROVED");
                req.setResolvedAt(LocalDateTime.now());
                req.setResolvedBy(responder);
            } else if ("SEQUENTIAL".equals(req.getChainType())) {
                req.setCurrentStep(req.getCurrentStep() + 1);
            }
        }

        req.setUpdatedAt(LocalDateTime.now());
        return approvalRepository.save(req);
    }

    public ApprovalRequest escalate(String approvalId) {
        ApprovalRequest req = getApprovalById(approvalId);
        req.setStatus("ESCALATED");
        req.setUpdatedAt(LocalDateTime.now());
        if (req.getEscalateTo() != null) {
            notificationService.create(
                "Approval Escalated: " + req.getTitle(),
                "This approval has been escalated to you",
                "WARNING", req.getEntityType(), req.getEntityId());
        }
        return approvalRepository.save(req);
    }

    // ── Workflow Versioning ───────────────────────────────────

    public Automation saveVersion(String id, String note, String author) {
        Automation a = automationRepository.findById(id)
            .orElseThrow(() -> new RuntimeException("Automation not found"));
        try {
            com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
            mapper.registerModule(new com.fasterxml.jackson.datatype.jsr310.JavaTimeModule());
            String snapshot = mapper.writeValueAsString(a);
            Automation.AutomationVersion v = new Automation.AutomationVersion();
            v.setVersion(a.getVersion());
            v.setChangedBy(author);
            v.setChangeNote(note.isEmpty() ? "Version " + a.getVersion() : note);
            v.setSnapshot(snapshot);
            v.setSavedAt(java.time.LocalDateTime.now());
            if (a.getVersionHistory() == null) a.setVersionHistory(new ArrayList<>());
            a.getVersionHistory().add(0, v);
            // Keep last 10 versions
            if (a.getVersionHistory().size() > 10)
                a.setVersionHistory(a.getVersionHistory().subList(0, 10));
            a.setVersion(a.getVersion() + 1);
            a.setUpdatedAt(java.time.LocalDateTime.now());
            Automation saved = automationRepository.save(a);
        activityLogService.log("AUTOMATION", saved.getId(), saved.getName(),
                "CREATED", null, saved.getName(), author);
        return saved;
        } catch (Exception e) {
            throw new RuntimeException("Failed to save version: " + e.getMessage());
        }
    }

    public List<Automation.AutomationVersion> getVersions(String id) {
        Automation a = automationRepository.findById(id)
            .orElseThrow(() -> new RuntimeException("Automation not found"));
        return a.getVersionHistory() != null ? a.getVersionHistory() : List.of();
    }

    public Automation restoreVersion(String id, String versionId, String author) {
        Automation a = automationRepository.findById(id)
            .orElseThrow(() -> new RuntimeException("Automation not found"));
        Automation.AutomationVersion target = (a.getVersionHistory() != null
            ? a.getVersionHistory() : List.<Automation.AutomationVersion>of()).stream()
            .filter(v -> versionId.equals(v.getId()))
            .findFirst()
            .orElseThrow(() -> new RuntimeException("Version not found"));
        try {
            com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
            mapper.registerModule(new com.fasterxml.jackson.datatype.jsr310.JavaTimeModule());
            Automation restored = mapper.readValue(target.getSnapshot(), Automation.class);
            restored.setId(id);
            restored.setUpdatedAt(java.time.LocalDateTime.now());
            restored.setVersion(a.getVersion() + 1);
            // Save current as version before restoring
            saveVersion(id, "Auto-saved before restore to v" + target.getVersion(), author);
            return automationRepository.save(restored);
        } catch (Exception e) {
            throw new RuntimeException("Failed to restore version: " + e.getMessage());
        }
    }

}

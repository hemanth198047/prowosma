package com.prowosma.backend.service;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.*;
import com.prowosma.backend.repository.*;
import com.prowosma.backend.service.ActivityLogService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.*;

/**
 * BPM Engine — executes BpmProcess instances node by node.
 * Supports: TRIGGER, CONDITION, AI_STEP (human-in-the-loop), HUMAN_APPROVAL, ACTION, FORK, END
 */
@Service
@RequiredArgsConstructor
public class BpmService {

    private final BpmProcessRepository  processRepo;
    private final BpmInstanceRepository instanceRepo;
    private final AIService             aiService;
    private final NotificationService   notificationService;
    private final TaskRepository        taskRepository;
    private final WorkspaceContext      workspaceContext;
    private final ActivityLogService activityLogService;

    // ── Process CRUD ─────────────────────────────────────────

    public List<BpmProcess> getProcesses() {
        return processRepo.findByOrganizationId(workspaceContext.getWorkspaceId());
    }

    public BpmProcess getProcess(String id) {
        return processRepo.findById(id).orElseThrow(() -> new RuntimeException("BPM process not found"));
    }

    public BpmProcess saveProcess(BpmProcess p, String author) {
        p.setOrganizationId(workspaceContext.getWorkspaceId());
        p.setCreatedBy(author);
        p.setUpdatedAt(LocalDateTime.now());
        if (p.getCreatedAt() == null) p.setCreatedAt(LocalDateTime.now());
BpmProcess saved = processRepo.save(p);
        activityLogService.log("BPM_PROCESS", saved.getId(), saved.getName(),
                "CREATED", null, saved.getName(), author);
        return saved;
    }

    public void deleteProcess(String id) {
        activityLogService.log("BPM_PROCESS", id, id, "DELETED", null, null, null);
        processRepo.deleteById(id);
    }

    // ── Instance management ───────────────────────────────────

    public List<BpmInstance> getInstances(String processId) {
        String orgId = workspaceContext.getWorkspaceId();
        return processId != null
            ? instanceRepo.findByOrganizationIdAndProcessId(orgId, processId)
            : instanceRepo.findByOrganizationId(orgId);
    }

    public BpmInstance getInstance(String id) {
        return instanceRepo.findById(id).orElseThrow(() -> new RuntimeException("BPM instance not found"));
    }

    /** Start a new process instance */
    public BpmInstance startProcess(String processId, Map<String, Object> variables, String startedBy) {
        BpmProcess process = getProcess(processId);

        BpmInstance instance = new BpmInstance();
        instance.setOrganizationId(workspaceContext.getWorkspaceId());
        instance.setProcessId(processId);
        instance.setProcessName(process.getName());
        instance.setStartedBy(startedBy);
        instance.setVariables(variables != null ? new LinkedHashMap<>(variables) : new LinkedHashMap<>());
        instance.setStartedAt(LocalDateTime.now());
        instance.setStatus("RUNNING");

        // Find TRIGGER node to start
        BpmProcess.BpmNode startNode = process.getNodes().stream()
            .filter(n -> "TRIGGER".equals(n.getType()))
            .findFirst()
            .orElse(process.getNodes().isEmpty() ? null : process.getNodes().get(0));

        if (startNode != null) {
            instance.setCurrentNodeId(startNode.getId());
        }

        instance = instanceRepo.save(instance);
        process.setRunCount(process.getRunCount() + 1);
        processRepo.save(process);

        // Auto-execute non-human nodes
        instance = executeCurrentNode(instance, process);
        return instance;
    }

    /** Human provides decision on a WAITING_HUMAN node */
    public BpmInstance humanDecide(String instanceId, String nodeId,
                                   String decision, String comment, String decidedBy) {
        BpmInstance instance = getInstance(instanceId);
        BpmProcess  process  = getProcess(instance.getProcessId());

        // Update the waiting node in history
        instance.getHistory().stream()
            .filter(h -> nodeId.equals(h.getNodeId()) && "WAITING".equals(h.getStatus()))
            .findFirst()
            .ifPresent(h -> {
                h.setStatus("COMPLETED");
                h.setHumanDecision(decision);
                h.setHumanComment(comment);
                h.setDecidedBy(decidedBy);
                h.setCompletedAt(LocalDateTime.now());
                h.getOutput().put("decision", decision);
            });

        instance.getVariables().put("lastHumanDecision", decision);
        instance.getVariables().put("lastHumanComment",  comment);
        instance.setStatus("RUNNING");

        // Advance to next node based on decision
        BpmProcess.BpmNode currentNode = findNode(process, nodeId);
        String nextNodeId = resolveNextNode(process, nodeId, decision, instance.getVariables());
        if (nextNodeId != null) {
            instance.setCurrentNodeId(nextNodeId);
            instance = instanceRepo.save(instance);
            instance = executeCurrentNode(instance, process);
        } else {
            instance.setStatus("COMPLETED");
            instance.setCompletedAt(LocalDateTime.now());
            instance = instanceRepo.save(instance);
        }
        return instance;
    }

    /** AI override: human disagrees with AI output and provides correction */
    public BpmInstance aiOverride(String instanceId, String nodeId,
                                   String overrideValue, String reason, String overriddenBy) {
        BpmInstance instance = getInstance(instanceId);

        instance.getHistory().stream()
            .filter(h -> nodeId.equals(h.getNodeId()))
            .findFirst()
            .ifPresent(h -> {
                h.setHumanDecision("OVERRIDE");
                h.setHumanComment("Override: " + reason);
                h.setDecidedBy(overriddenBy);
                h.getOutput().put("originalAiOutput", h.getAiOutput());
                h.getOutput().put("overrideValue", overrideValue);
                h.setAiOutput(overrideValue + " [human override]");
            });

        instance.getVariables().put("aiOverride_" + nodeId, overrideValue);
        notificationService.create(
            "🔧 AI Override Applied",
            overriddenBy + " overrode AI output on process: " + instance.getProcessName(),
            "WARNING", "BPM", instanceId
        );
        return instanceRepo.save(instance);
    }

    // ── Node execution engine ─────────────────────────────────

    private BpmInstance executeCurrentNode(BpmInstance instance, BpmProcess process) {
        int maxSteps = 20; // prevent infinite loops
        while (maxSteps-- > 0 && "RUNNING".equals(instance.getStatus())) {
            String nodeId = instance.getCurrentNodeId();
            if (nodeId == null) { instance.setStatus("COMPLETED"); break; }

            BpmProcess.BpmNode node = findNode(process, nodeId);
            if (node == null) { instance.setStatus("COMPLETED"); break; }

            BpmInstance.NodeExecution exec = new BpmInstance.NodeExecution();
            exec.setNodeId(node.getId());
            exec.setNodeLabel(node.getLabel());
            exec.setNodeType(node.getType());
            exec.setStartedAt(LocalDateTime.now());

            switch (node.getType()) {
                case "TRIGGER" -> {
                    exec.setStatus("COMPLETED");
                    exec.getOutput().put("triggeredAt", LocalDateTime.now().toString());
                    instance.getHistory().add(exec);
                    String next = resolveNextNode(process, nodeId, null, instance.getVariables());
                    instance.setCurrentNodeId(next);
                }
                case "END" -> {
                    exec.setStatus("COMPLETED");
                    instance.getHistory().add(exec);
                    instance.setStatus("COMPLETED");
                    instance.setCompletedAt(LocalDateTime.now());
                    notificationService.create(
                        "✅ Process Completed: " + instance.getProcessName(),
                        "BPM process completed successfully",
                        "SUCCESS", "BPM", instance.getId()
                    );
                }
                case "ACTION" -> {
                    executeActionNode(node, instance);
                    exec.setStatus("COMPLETED");
                    instance.getHistory().add(exec);
                    String next = resolveNextNode(process, nodeId, null, instance.getVariables());
                    instance.setCurrentNodeId(next);
                }
                case "CONDITION" -> {
                    String outcome = evaluateCondition(node, instance.getVariables());
                    exec.setStatus("COMPLETED");
                    exec.getOutput().put("outcome", outcome);
                    instance.getHistory().add(exec);
                    String next = resolveNextNode(process, nodeId, outcome, instance.getVariables());
                    instance.setCurrentNodeId(next);
                }
                case "AI_STEP" -> {
                    String aiOut = executeAiStep(node, instance);
                    exec.setAiOutput(aiOut);
                    exec.setStatus("COMPLETED");
                    exec.getOutput().put("aiOutput", aiOut);
                    instance.getHistory().add(exec);
                    instance.getVariables().put("ai_" + node.getId(), aiOut);
                    // Pause for human review if configured
                    Map<String, Object> cfg = node.getConfig() != null ? node.getConfig() : Map.of();
                    boolean requiresReview = (Boolean) cfg.getOrDefault("requiresHumanReview", false);
                    if (requiresReview) {
                        instance.setStatus("WAITING_HUMAN");
                        exec.setStatus("WAITING");
                        notificationService.create(
                            "👁 AI Step Needs Review: " + node.getLabel(),
                            "AI generated output for '" + node.getLabel() + "' — please review before continuing",
                            "WARNING", "BPM", instance.getId()
                        );
                        instance = instanceRepo.save(instance);
                        return instance;
                    }
                    String next = resolveNextNode(process, nodeId, null, instance.getVariables());
                    instance.setCurrentNodeId(next);
                }
                case "HUMAN_APPROVAL" -> {
                    exec.setStatus("WAITING");
                    instance.getHistory().add(exec);
                    instance.setStatus("WAITING_HUMAN");
                    Map<String, Object> cfg = node.getConfig() != null ? node.getConfig() : Map.of();
                    String approvers = (String) cfg.getOrDefault("approvers", "");
                    notificationService.create(
                        "⏸ Human Decision Required: " + node.getLabel(),
                        "Process '" + instance.getProcessName() + "' is waiting for your decision on: " + node.getLabel(),
                        "WARNING", "BPM", instance.getId()
                    );
                    instance = instanceRepo.save(instance);
                    return instance;
                }
                case "FORK" -> {
                    exec.setStatus("COMPLETED");
                    instance.getHistory().add(exec);
                    // FORK runs all outgoing transitions; for simplicity follow first
                    String next = resolveNextNode(process, nodeId, null, instance.getVariables());
                    instance.setCurrentNodeId(next);
                }
                default -> {
                    exec.setStatus("COMPLETED");
                    instance.getHistory().add(exec);
                    String next = resolveNextNode(process, nodeId, null, instance.getVariables());
                    instance.setCurrentNodeId(next);
                }
            }
            instance = instanceRepo.save(instance);
        }
        return instance;
    }

    private String executeAiStep(BpmProcess.BpmNode node, BpmInstance instance) {
        Map<String, Object> cfg = node.getConfig() != null ? node.getConfig() : Map.of();
        String prompt  = (String) cfg.getOrDefault("prompt", "Analyse and provide a recommendation.");
        String context = "Process: " + instance.getProcessName()
            + "\nVariables: " + instance.getVariables().toString()
            + "\nHistory: " + instance.getHistory().size() + " steps completed";

        try {
            return aiService.ask(node.getLabel() + " — " + prompt, context);
        } catch (Exception e) {
            return "AI unavailable: " + e.getMessage()
                + ". Fallback: Manual review recommended for " + node.getLabel();
        }
    }

    private void executeActionNode(BpmProcess.BpmNode node, BpmInstance instance) {
        Map<String, Object> cfg = node.getConfig() != null ? node.getConfig() : Map.of();
        String actionType = (String) cfg.getOrDefault("actionType", "NOTIFY");
        switch (actionType) {
            case "NOTIFY" -> notificationService.create(
                interpolate((String) cfg.getOrDefault("title", node.getLabel()), instance.getVariables()),
                interpolate((String) cfg.getOrDefault("message", "Process step completed"), instance.getVariables()),
                "INFO", "BPM", instance.getId()
            );
            case "UPDATE_TASK_STATUS" -> {
                String taskId = (String) instance.getVariables().get("taskId");
                if (taskId != null) {
                    taskRepository.findById(taskId).ifPresent(t -> {
                        t.setStatus((String) cfg.getOrDefault("status", "IN_PROGRESS"));
                        t.setUpdatedAt(LocalDateTime.now());
                        taskRepository.save(t);
                    });
                }
            }
            default -> { /* no-op */ }
        }
    }

    private String evaluateCondition(BpmProcess.BpmNode node, Map<String, Object> variables) {
        Map<String, Object> cfg = node.getConfig() != null ? node.getConfig() : Map.of();
        String field    = (String) cfg.getOrDefault("field",    "");
        String operator = (String) cfg.getOrDefault("operator", "exists");
        String value    = (String) cfg.getOrDefault("value",    "");
        Object actual   = variables.get(field);
        if (actual == null) return "false";
        return switch (operator) {
            case "equals"     -> value.equals(actual.toString()) ? "true" : "false";
            case "not_equals" -> !value.equals(actual.toString()) ? "true" : "false";
            case "contains"   -> actual.toString().contains(value) ? "true" : "false";
            case "gt"         -> { try { yield Double.parseDouble(actual.toString()) > Double.parseDouble(value) ? "true" : "false"; } catch (Exception e) { yield "false"; } }
            case "lt"         -> { try { yield Double.parseDouble(actual.toString()) < Double.parseDouble(value) ? "true" : "false"; } catch (Exception e) { yield "false"; } }
            default           -> "true";
        };
    }

    private String resolveNextNode(BpmProcess process, String fromNodeId,
                                   String outcome, Map<String, Object> variables) {
        return process.getTransitions().stream()
            .filter(t -> fromNodeId.equals(t.getFromNodeId()))
            .filter(t -> t.getCondition() == null || t.getCondition().isEmpty()
                || (outcome != null && outcome.equalsIgnoreCase(t.getCondition()))
                || "true".equalsIgnoreCase(t.getCondition()))
            .map(BpmProcess.BpmTransition::getToNodeId)
            .findFirst()
            .orElse(null);
    }

    private BpmProcess.BpmNode findNode(BpmProcess process, String nodeId) {
        return process.getNodes().stream()
            .filter(n -> nodeId.equals(n.getId()))
            .findFirst().orElse(null);
    }

    private String interpolate(String template, Map<String, Object> vars) {
        String result = template;
        for (Map.Entry<String, Object> e : vars.entrySet())
            result = result.replace("{{" + e.getKey() + "}}", e.getValue() != null ? e.getValue().toString() : "");
        return result;
    }
}

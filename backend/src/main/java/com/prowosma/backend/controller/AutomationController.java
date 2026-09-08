package com.prowosma.backend.controller;

import com.prowosma.backend.model.Automation;
import com.prowosma.backend.model.ApprovalRequest;
import com.prowosma.backend.service.AutomationService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/automations")
@Tag(name = "Automation APIs")
@RequiredArgsConstructor
public class AutomationController {

    private final AutomationService automationService;

    // ── Automations CRUD ─────────────────────────────────────────

    @GetMapping
    @Operation(summary = "Get all automations")
    public List<Automation> getAll() {
        return automationService.getAll();
    }

    @GetMapping("/{id}")
    @Operation(summary = "Get automation by ID")
    public Automation getById(@PathVariable String id) {
        return automationService.getById(id);
    }

    @PostMapping
    @Operation(summary = "Create an automation")
    public Automation create(@RequestBody Automation automation, Authentication auth) {
        return automationService.create(automation, auth.getName());
    }

    @PutMapping("/{id}")
    @Operation(summary = "Update an automation")
    public Automation update(@PathVariable String id, @RequestBody Automation patch) {
        return automationService.update(id, patch);
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "Delete an automation")
    public ResponseEntity<Map<String, String>> delete(@PathVariable String id) {
        automationService.delete(id);
        return ResponseEntity.ok(Map.of("message", "Deleted"));
    }

    @PatchMapping("/{id}/toggle")
    @Operation(summary = "Enable or disable an automation")
    public Automation toggle(@PathVariable String id) {
        return automationService.toggle(id);
    }

    // ── Manual trigger (for testing) ─────────────────────────────

    @PostMapping("/{id}/test")
    @Operation(summary = "Test-run an automation manually")
    public ResponseEntity<Map<String, String>> test(@PathVariable String id,
                                                     @RequestBody(required = false) Map<String, Object> context,
                                                     Authentication auth) {
        Automation automation = automationService.getById(id);
        automationService.trigger(
            automation.getTriggerType(),
            "TEST", "test-entity",
            context != null ? context : Map.of("actor", auth.getName())
        );
        return ResponseEntity.ok(Map.of("message", "Test triggered"));
    }

    // ── Approval requests ────────────────────────────────────────

    @GetMapping("/approvals")
    @Operation(summary = "Get all approval requests")
    public List<ApprovalRequest> getAllApprovals() {
        return automationService.getAllApprovals();
    }

    @GetMapping("/approvals/{id}")
    @Operation(summary = "Get approval request by ID")
    public ApprovalRequest getApproval(@PathVariable String id) {
        return automationService.getApprovalById(id);
    }

    @PostMapping("/approvals")
    @Operation(summary = "Create a manual approval request")
    public ApprovalRequest createApproval(@RequestBody ApprovalRequest req, Authentication auth) {
        return automationService.createApproval(req, auth.getName());
    }

    @PostMapping("/approvals/{id}/respond")
    @Operation(summary = "Respond to an approval step (APPROVED or REJECTED)")
    public ApprovalRequest respond(@PathVariable String id,
                                   @RequestBody Map<String, String> body,
                                   Authentication auth) {
        return automationService.respond(
            id,
            body.get("stepId"),
            body.get("decision"),  // APPROVED | REJECTED
            body.getOrDefault("comment", ""),
            auth.getName()
        );
    }

    @PostMapping("/approvals/{id}/escalate")
    @Operation(summary = "Manually escalate an approval")
    public ApprovalRequest escalate(@PathVariable String id) {
        return automationService.escalate(id);
    }

    // ── Workflow Versioning ───────────────────────────────────

    @PostMapping("/{id}/versions")
    @Operation(summary = "Save a version snapshot of an automation")
    public com.prowosma.backend.model.Automation saveVersion(
            @PathVariable String id,
            @RequestBody java.util.Map<String, String> body,
            org.springframework.security.core.Authentication auth) {
        return automationService.saveVersion(id, body.getOrDefault("note",""), auth.getName());
    }

    @GetMapping("/{id}/versions")
    @Operation(summary = "Get version history of an automation")
    public java.util.List<com.prowosma.backend.model.Automation.AutomationVersion> getVersions(
            @PathVariable String id) {
        return automationService.getVersions(id);
    }

    @PostMapping("/{id}/versions/{versionId}/restore")
    @Operation(summary = "Restore automation to a previous version")
    public com.prowosma.backend.model.Automation restoreVersion(
            @PathVariable String id,
            @PathVariable String versionId,
            org.springframework.security.core.Authentication auth) {
        return automationService.restoreVersion(id, versionId, auth.getName());
    }

}

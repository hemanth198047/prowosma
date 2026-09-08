package com.prowosma.backend.controller;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.service.BillingService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;

/**
 * Billing API — real Stripe-backed subscription management.
 *
 * Endpoints:
 *   GET  /api/billing            — current plan, seats, status, invoices for this workspace
 *   GET  /api/billing/plans      — all available plans and what they include
 *   POST /api/billing/checkout   — start a real Stripe Checkout session for a plan upgrade
 *   POST /api/billing/portal     — open the real Stripe Billing Portal (update card, cancel, invoice history)
 *   POST /api/billing/cancel     — cancel at the end of the current billing period
 *   POST /api/billing/resume     — undo a pending cancellation
 *
 * Plan state only ever changes via the Stripe webhook (see
 * StripeWebhookController) — these endpoints kick off real Stripe flows,
 * they never set the plan directly, so there's no way to grant yourself
 * a paid plan by calling the API without actually paying.
 */
@RestController
@RequestMapping("/api/billing")
@Tag(name = "Billing", description = "Real Stripe-backed subscription management")
@RequiredArgsConstructor
public class BillingController {

    private final BillingService billingService;
    private final WorkspaceContext workspaceContext;

    @GetMapping
    @Operation(summary = "Get current billing/subscription summary for this workspace")
    public Map<String, Object> getSummary() {
        return billingService.getSummary(requireWorkspace());
    }

    @GetMapping("/plans")
    @Operation(summary = "List all available plans and what each includes")
    public Object getPlans() {
        return billingService.listPlans();
    }

    @PostMapping("/start-trial")
    @Operation(summary = "Start a real 14-day Pro trial - no card required, one-time per workspace")
    public ResponseEntity<?> startTrial() {
        try {
            return ResponseEntity.ok(billingService.startTrial(requireWorkspace()));
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error", e.getMessage()));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/checkout")
    @Operation(summary = "Start a real Stripe Checkout session for a plan upgrade")
    public ResponseEntity<?> checkout(@RequestBody Map<String, Object> body, Authentication auth) {
        String planId = String.valueOf(body.get("planId"));
        int seats = body.get("seats") != null ? Integer.parseInt(String.valueOf(body.get("seats"))) : 5;
        String email = auth != null ? auth.getName() : null;
        try {
            return ResponseEntity.ok(billingService.startCheckout(requireWorkspace(), planId, seats, email));
        } catch (IllegalStateException | IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.PAYMENT_REQUIRED).body(Map.of("error", e.getMessage()));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/portal")
    @Operation(summary = "Open the real Stripe Billing Portal for this workspace")
    public ResponseEntity<?> portal() {
        try {
            return ResponseEntity.ok(billingService.openPortal(requireWorkspace()));
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.PAYMENT_REQUIRED).body(Map.of("error", e.getMessage()));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/cancel")
    @Operation(summary = "Cancel the subscription at the end of the current billing period")
    public ResponseEntity<?> cancel() {
        try {
            billingService.requestCancelAtPeriodEnd(requireWorkspace(), true);
            return ResponseEntity.ok(Map.of("message", "Your subscription will cancel at the end of the current billing period."));
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/resume")
    @Operation(summary = "Undo a pending cancellation")
    public ResponseEntity<?> resume() {
        try {
            billingService.requestCancelAtPeriodEnd(requireWorkspace(), false);
            return ResponseEntity.ok(Map.of("message", "Cancellation reversed — your subscription will continue renewing."));
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    private String requireWorkspace() {
        String workspaceId = workspaceContext.getWorkspaceId();
        if (workspaceId == null || workspaceId.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "X-Workspace-Id header is required");
        }
        return workspaceId;
    }
}

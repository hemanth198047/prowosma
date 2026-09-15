package com.prowosma.backend.controller;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.service.BillingService;
import com.prowosma.backend.service.InvitationService;
import com.prowosma.backend.model.Invitation;
import com.prowosma.backend.repository.InvitationRepository;
import com.prowosma.backend.repository.UserRepository;
import com.prowosma.backend.util.PagedResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDateTime;
import java.util.*;

/**
 * Invitation API — full CRUD + bulk operations.
 *
 * All endpoints are scoped to the active workspace via X-Workspace-Id header.
 *
 * Endpoints:
 *   GET    /api/invitations                    — list invitations (filterable by status)
 *   POST   /api/invitations                    — send invitation
 *   GET    /api/invitations/stats              — count by status
 *   DELETE /api/invitations/all                — delete ALL invitations in workspace
 *   DELETE /api/invitations/pending            — delete only PENDING invitations
 *   DELETE /api/invitations/expired            — delete only EXPIRED invitations
 *   GET    /api/invitations/validate/{token}   — validate an invite token
 *   POST   /api/invitations/accept/{token}     — accept an invitation
 *   POST   /api/invitations/{id}/resend        — resend invitation email
 *   PATCH  /api/invitations/{id}/expire        — manually expire an invitation
 *   DELETE /api/invitations/{id}               — revoke a single invitation
 */
@RestController
@RequestMapping("/api/invitations")
@Tag(
    name = "Invitations",
    description = """
        Manage workspace invitations.
        
        **Flow:**
        1. OWNER/ADMIN sends an invitation → status = PENDING
        2. Invitee receives email, clicks link → validates token
        3. Invitee accepts → status = ACCEPTED, TeamMember record created
        
        **Statuses:** PENDING · ACCEPTED · REVOKED · EXPIRED
        """
)
@RequiredArgsConstructor
public class InvitationController {

    private final InvitationRepository invitationRepository;
    private final UserRepository       userRepository;
    private final WorkspaceContext     workspaceContext;
    private final InvitationService    invitationService;
    private final BillingService       billingService;

    // ── List ─────────────────────────────────────────────────────

    @GetMapping
    @Operation(
        summary = "List invitations",
        description = "Returns invitations for the active workspace. Filter by status: PENDING, ACCEPTED, REVOKED, EXPIRED. Defaults to PENDING."
    )
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Invitations returned"),
        @ApiResponse(responseCode = "400", description = "Invalid status value")
    })
    public PagedResponse<Invitation> getAll(
            @Parameter(description = "Filter by status. One of: PENDING, ACCEPTED, REVOKED, EXPIRED, ALL")
            @RequestParam(defaultValue = "PENDING") String status,
            @RequestParam(defaultValue = "0")  int page,
            @RequestParam(defaultValue = "50") int size) {

        String wsId = workspaceContext.getWorkspaceId();
        List<Invitation> items = "ALL".equalsIgnoreCase(status)
                ? invitationRepository.findByWorkspaceId(wsId)
                : invitationRepository.findByWorkspaceIdAndStatus(wsId, status.toUpperCase());
        return PagedResponse.ofList(items, page, Math.min(size, 200));
    }

    // ── Stats ─────────────────────────────────────────────────────

    @GetMapping("/stats")
    @Operation(
        summary = "Invitation statistics",
        description = "Returns counts of invitations grouped by status for the active workspace."
    )
    public Map<String, Object> getStats() {
        String wsId = workspaceContext.getWorkspaceId();
        List<Invitation> all = invitationRepository.findByWorkspaceId(wsId);

        long pending  = all.stream().filter(i -> "PENDING".equals(i.getStatus())).count();
        long accepted = all.stream().filter(i -> "ACCEPTED".equals(i.getStatus())).count();
        long revoked  = all.stream().filter(i -> "REVOKED".equals(i.getStatus())).count();
        long expired  = all.stream().filter(i -> "EXPIRED".equals(i.getStatus())).count();

        return Map.of(
            "total",    all.size(),
            "pending",  pending,
            "accepted", accepted,
            "revoked",  revoked,
            "expired",  expired
        );
    }

    // ── Send ─────────────────────────────────────────────────────

    @PostMapping
    @Operation(
        summary = "Send an invitation",
        description = "Sends a workspace invitation to an email address. Returns 400 if a PENDING invitation already exists for that email."
    )
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Invitation created"),
        @ApiResponse(responseCode = "400", description = "Pending invitation already exists for this email")
    })
    public ResponseEntity<?> invite(
            @io.swagger.v3.oas.annotations.parameters.RequestBody(
                description = "Invitation payload",
                content = @Content(schema = @Schema(example = """
                    {"email": "user@example.com", "role": "MEMBER"}
                    """)))
            @RequestBody Map<String, String> body,
            Authentication auth) {

        String email       = body.get("email");
        String role        = body.getOrDefault("role", "MEMBER");
        String workspaceId = workspaceContext.getWorkspaceId();

        if (email == null || email.isBlank())
            return ResponseEntity.badRequest().body(Map.of("error", "Email is required"));

        try {
            billingService.assertSeatAvailable(workspaceId);
        } catch (RuntimeException e) {
            return ResponseEntity.status(HttpStatus.PAYMENT_REQUIRED).body(Map.of("error", e.getMessage()));
        }

        try {
            Invitation saved = invitationService.invite(workspaceId, email, role,
                    auth != null ? auth.getName() : "system");
            return ResponseEntity.ok(Map.of(
                "id",        saved.getId(),
                "email",     email,
                "role",      role,
                "token",     saved.getToken(),
                "status",    "PENDING",
                "message",   "Invitation sent to " + email,
                "expiresAt", saved.getExpiresAt().toString()
            ));
        } catch (RuntimeException e) {
            // "Only the workspace Owner can invite someone as Admin" (see
            // InvitationService.invite) reads correctly as 403; everything
            // else here (duplicate pending invite, bad workspace, etc.)
            // stays a 400 same as before.
            String msg = e.getMessage() != null ? e.getMessage() : "";
            HttpStatus status = msg.contains("Only the workspace Owner")
                    ? HttpStatus.FORBIDDEN : HttpStatus.BAD_REQUEST;
            return ResponseEntity.status(status).body(Map.of("error", e.getMessage()));
        }
    }


    // ── Bulk Delete ───────────────────────────────────────────────

    @DeleteMapping("/all")
    @Operation(
        summary = "Delete ALL invitations",
        description = "Permanently deletes every invitation in the active workspace regardless of status (PENDING, ACCEPTED, REVOKED, EXPIRED). This action cannot be undone."
    )
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "All invitations deleted"),
        @ApiResponse(responseCode = "403", description = "Insufficient permissions")
    })
    public ResponseEntity<Map<String, Object>> deleteAll() {
        String wsId = workspaceContext.getWorkspaceId();
        List<Invitation> all = invitationRepository.findByWorkspaceId(wsId);
        int count = all.size();
        invitationRepository.deleteAll(all);
        return ResponseEntity.ok(Map.of(
            "deleted", count,
            "message", "Deleted " + count + " invitation(s) from workspace"
        ));
    }

    @DeleteMapping("/pending")
    @Operation(
        summary = "Delete all PENDING invitations",
        description = "Permanently deletes all invitations with status PENDING in the active workspace. Accepted and revoked invitations are not affected."
    )
    public ResponseEntity<Map<String, Object>> deletePending() {
        String wsId = workspaceContext.getWorkspaceId();
        List<Invitation> pending = invitationRepository
                .findByWorkspaceIdAndStatus(wsId, "PENDING");
        int count = pending.size();
        invitationRepository.deleteAll(pending);
        return ResponseEntity.ok(Map.of(
            "deleted", count,
            "message", "Deleted " + count + " pending invitation(s)"
        ));
    }

    @DeleteMapping("/expired")
    @Operation(
        summary = "Delete all EXPIRED invitations",
        description = "Permanently deletes all invitations with status EXPIRED in the active workspace."
    )
    public ResponseEntity<Map<String, Object>> deleteExpired() {
        String wsId = workspaceContext.getWorkspaceId();
        // Also mark any PENDING invitations past expiry as EXPIRED first
        List<Invitation> all = invitationRepository.findByWorkspaceId(wsId);
        LocalDateTime now = LocalDateTime.now();
        List<Invitation> toDelete = new ArrayList<>();
        List<Invitation> toUpdate = new ArrayList<>();
        for (Invitation inv : all) {
            if ("EXPIRED".equals(inv.getStatus())) {
                toDelete.add(inv);
            } else if ("PENDING".equals(inv.getStatus())
                    && inv.getExpiresAt() != null
                    && inv.getExpiresAt().isBefore(now)) {
                inv.setStatus("EXPIRED");
                toUpdate.add(inv);
                toDelete.add(inv);
            }
        }
        if (!toUpdate.isEmpty()) invitationRepository.saveAll(toUpdate);
        invitationRepository.deleteAll(toDelete);
        return ResponseEntity.ok(Map.of(
            "deleted", toDelete.size(),
            "message", "Deleted " + toDelete.size() + " expired invitation(s)"
        ));
    }

    // ── Validate token ────────────────────────────────────────────

    /**
     * GET /api/invitations/info?token=xxx
     * Called by AcceptInvite.jsx on page load to show invitation details.
     */
    @GetMapping("/info")
    @Operation(
        summary = "Get invitation details by token (query param)",
        description = "Called by the AcceptInvite page to load invitation info before the user submits the form."
    )
    public ResponseEntity<?> getInfo(@RequestParam String token) {
        return invitationRepository.findByToken(token).map(inv -> {
            if ("ACCEPTED".equals(inv.getStatus()))
                return ResponseEntity.badRequest().body(
                    java.util.Map.of("error", "Invitation already used"));
            if ("REVOKED".equals(inv.getStatus()))
                return ResponseEntity.badRequest().body(
                    java.util.Map.of("error", "Invitation has been revoked"));
            if (inv.getExpiresAt() != null && inv.getExpiresAt().isBefore(java.time.LocalDateTime.now())) {
                inv.setStatus("EXPIRED");
                invitationRepository.save(inv);
                return ResponseEntity.badRequest().body(
                    java.util.Map.of("error", "Invitation has expired"));
            }
            java.util.Map<String, Object> result = new java.util.HashMap<>();
            result.put("email",         inv.getEmail());
            result.put("workspaceId",   inv.getWorkspaceId());
            result.put("workspaceName", inv.getWorkspaceName() != null ? inv.getWorkspaceName() : "");
            result.put("role",          inv.getRole() != null ? inv.getRole() : "MEMBER");
            result.put("invitedBy",     inv.getInvitedByEmail() != null ? inv.getInvitedByEmail() : "");
            result.put("expiresAt",     inv.getExpiresAt() != null ? inv.getExpiresAt().toString() : null);
            result.put("valid",         true);
            // AcceptInvite.jsx uses this to default to "Already Have Account"
            // instead of "New Account" — matters when a prior attempt already
            // created the user (e.g. register() succeeded but a later step in
            // the same flow failed), since retrying "New Account" would just
            // hit a confusing "Email already registered" error instead.
            result.put("accountExists", userRepository.existsByEmail(inv.getEmail()));
            return ResponseEntity.ok(result);
        }).orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/validate/{token}")
    @Operation(
        summary = "Validate an invitation token",
        description = "Called from the AcceptInvite page. Returns invitation details if the token is valid and not expired."
    )
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Token is valid"),
        @ApiResponse(responseCode = "400", description = "Already used or expired"),
        @ApiResponse(responseCode = "404", description = "Token not found")
    })
    public ResponseEntity<?> validate(@PathVariable String token) {
        Optional<Invitation> opt = invitationRepository.findByToken(token);
        if (opt.isEmpty()) return ResponseEntity.notFound().build();
        Invitation inv = opt.get();
        if ("ACCEPTED".equals(inv.getStatus()))
            return ResponseEntity.badRequest().body(Map.of("error", "Invitation already used"));
        if ("REVOKED".equals(inv.getStatus()))
            return ResponseEntity.badRequest().body(Map.of("error", "Invitation has been revoked"));
        if (inv.getExpiresAt() != null && inv.getExpiresAt().isBefore(LocalDateTime.now())) {
            inv.setStatus("EXPIRED");
            invitationRepository.save(inv);
            return ResponseEntity.badRequest().body(Map.of("error", "Invitation has expired"));
        }
        return ResponseEntity.ok(Map.of(
            "email",       inv.getEmail(),
            "workspaceId", inv.getWorkspaceId(),
            "role",        inv.getRole(),
            "invitedBy",   inv.getInvitedBy(),
            "expiresAt",   inv.getExpiresAt() != null ? inv.getExpiresAt().toString() : null,
            "valid",       true
        ));
    }

    // ── Accept ────────────────────────────────────────────────────

    /**
     * Accept via JSON body — called by AcceptInvite.jsx
     * Body: { "token": "...", "name": "...", "password": "..." }
     */
    @PostMapping("/accept")
    @Operation(
        summary = "Accept an invitation (body)",
        description = "Called by the AcceptInvite page. Accepts token + name + password in the request body. Creates the user account if new, adds them as a team member, and returns workspace info."
    )
    public ResponseEntity<?> acceptByBody(@RequestBody Map<String, String> body) {
        String token    = body.get("token");
        String name     = body.getOrDefault("name", "");
        String password = body.getOrDefault("password", "");
        if (token == null || token.isBlank())
            return ResponseEntity.badRequest().body(Map.of("error", "Token is required"));
        try {
            var result = invitationService.accept(token, name, password);
            return ResponseEntity.ok(result);
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Accept via path param — for direct API / Swagger use
     * POST /api/invitations/accept/{token}
     */
    @PostMapping("/accept/{token}")
    @Operation(
        summary = "Accept an invitation (path param)",
        description = "Alternative accept endpoint using token in the URL. Useful for direct API calls. Provide name and password in the request body if the user doesn't have an account yet."
    )
    public ResponseEntity<?> acceptByPath(
            @PathVariable String token,
            @RequestBody(required = false) Map<String, String> body) {
        String name     = body != null ? body.getOrDefault("name", "")     : "";
        String password = body != null ? body.getOrDefault("password", "") : "";
        try {
            var result = invitationService.accept(token, name, password);
            return ResponseEntity.ok(result);
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    // ── Resend ────────────────────────────────────────────────────

    @PostMapping("/{id}/resend")
    @Operation(
        summary = "Resend invitation email",
        description = "Resets the expiry to 7 days from now and triggers the invitation email again."
    )
    public ResponseEntity<?> resend(@PathVariable String id) {
        return invitationRepository.findById(id).map(inv -> {
            if ("ACCEPTED".equals(inv.getStatus()))
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Cannot resend an already accepted invitation");
            inv.setExpiresAt(LocalDateTime.now().plusDays(7));
            inv.setStatus("PENDING");
            invitationRepository.save(inv);
            try {
                invitationService.resend(inv.getId());
            } catch (RuntimeException e) {
                return ResponseEntity.badRequest().body(Map.<String, String>of("error", e.getMessage()));
            }
            return ResponseEntity.ok(Map.of(
                "message",   "Invitation resent to " + inv.getEmail(),
                "expiresAt", inv.getExpiresAt().toString()
            ));
        }).orElse(ResponseEntity.notFound().build());
    }

    // ── Expire ────────────────────────────────────────────────────

    @PatchMapping("/{id}/expire")
    @Operation(
        summary = "Manually expire an invitation",
        description = "Sets the invitation status to EXPIRED immediately. Useful for invalidating an invite without deleting it."
    )
    public ResponseEntity<?> expire(@PathVariable String id) {
        return invitationRepository.findById(id).map(inv -> {
            inv.setStatus("EXPIRED");
            invitationRepository.save(inv);
            return ResponseEntity.ok(Map.of("message", "Invitation expired", "id", id));
        }).orElse(ResponseEntity.notFound().build());
    }

    // ── Revoke (single) ───────────────────────────────────────────

    @DeleteMapping("/{id}")
    @Operation(
        summary = "Revoke a single invitation",
        description = "Sets the invitation status to REVOKED. The record is kept for audit purposes. Use DELETE /all or DELETE /pending to permanently remove records."
    )
    public ResponseEntity<Map<String, String>> revoke(@PathVariable String id) {
        return invitationRepository.findById(id).map(inv -> {
            inv.setStatus("REVOKED");
            invitationRepository.save(inv);
            return ResponseEntity.ok(Map.of(
                "message", "Invitation revoked",
                "email",   inv.getEmail()
            ));
        }).orElse(ResponseEntity.notFound().build());
    }
}

package com.prowosma.backend.service;

import com.prowosma.backend.model.Invitation;
import com.prowosma.backend.model.TeamMember;
import com.prowosma.backend.model.User;
import com.prowosma.backend.model.Workspace;
import com.prowosma.backend.repository.InvitationRepository;
import com.prowosma.backend.repository.TeamMemberRepository;
import com.prowosma.backend.repository.UserRepository;
import com.prowosma.backend.repository.WorkspaceRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class InvitationService {

    private final InvitationRepository  invitationRepository;
    private final TeamMemberRepository  teamMemberRepository;
    private final UserRepository        userRepository;
    private final WorkspaceRepository   workspaceRepository;
    private final PasswordEncoder       passwordEncoder;
    private final EmailService          emailService;
    private final ActivityLogService    activityLogService;

    @Value("${app.frontend.url:http://localhost:5173}")
    private String frontendUrl;

    // ── Create & send invitation ──────────────────────────────
    public Invitation invite(String workspaceId, String email,
                             String role, String invitedByEmail) {
        // Check for existing pending invite
        invitationRepository
                .findByEmailAndWorkspaceIdAndStatus(email, workspaceId, "PENDING")
                .ifPresent(existing -> {
                    throw new RuntimeException(
                            "An invitation is already pending for " + email);
                });

        Workspace workspace = workspaceRepository.findById(workspaceId)
                .orElseThrow(() -> new RuntimeException("Workspace not found"));

        // Only the workspace Owner can invite someone straight in as an
        // Admin. Without this, any Admin could invite more Admins and the
        // set of Admins only ever grows — which is exactly the "everyone
        // who accepts an invite ends up Admin" problem reported by early
        // testers. A plain Admin can still invite Members/Viewers.
        if ("ADMIN".equalsIgnoreCase(role)) {
            boolean inviterIsOwner = invitedByEmail != null &&
                    invitedByEmail.equalsIgnoreCase(workspace.getOwnerEmail());
            if (!inviterIsOwner) {
                throw new RuntimeException(
                        "Only the workspace Owner can invite someone as Admin. " +
                        "Invite them as Member or Viewer, or ask the Owner to send this invite.");
            }
        }

        Invitation inv = new Invitation();
        inv.setWorkspaceId(workspaceId);
        inv.setWorkspaceName(orFallback(workspace.getName(), "your workspace"));
        inv.setEmail(email);
        inv.setRole(role);
        inv.setToken(UUID.randomUUID().toString());
        inv.setStatus("PENDING");
        inv.setInvitedByEmail(orFallback(invitedByEmail, "system"));
        inv.setCreatedAt(LocalDateTime.now());
        inv.setExpiresAt(LocalDateTime.now().plusDays(7));

        Invitation saved = invitationRepository.save(inv);
        sendInviteEmail(saved);
        activityLogService.logFull("TEAM", saved.getId(), email,
                "USER_INVITED", null, email, invitedByEmail,
                workspaceId, null, null);  // pass workspaceId as projectId for orgId fallback
        return saved;
    }

    // ── List pending invitations for a workspace ──────────────
    public List<Invitation> getPending(String workspaceId) {
        return invitationRepository.findByWorkspaceIdAndStatus(
                workspaceId, "PENDING");
    }

    // ── Accept invitation via magic link ──────────────────────
    public Map<String, Object> accept(String token, String name,
                                      String password) {
        // 1. Find invitation
        Invitation inv = invitationRepository.findByToken(token)
                .orElseThrow(() -> new RuntimeException("Invalid or expired invitation link"));

        // 2. Validate status
        if (!"PENDING".equals(inv.getStatus()))
            throw new RuntimeException("This invitation has already been used or cancelled");

        // 3. Validate expiry (null-safe)
        if (inv.getExpiresAt() != null && inv.getExpiresAt().isBefore(LocalDateTime.now()))
            throw new RuntimeException("This invitation has expired");

        // 4. Validate required fields exist on invitation
        if (inv.getWorkspaceId() == null)
            throw new RuntimeException("Invalid invitation: missing workspace");
        if (inv.getEmail() == null)
            throw new RuntimeException("Invalid invitation: missing email");

        // 5. Create or load user
        User user;
        if (!userRepository.existsByEmail(inv.getEmail())) {
            if (name == null || name.isBlank())
                throw new RuntimeException("Name is required to create your account");
            if (password == null || password.length() < 6)
                throw new RuntimeException("Password must be at least 6 characters");
            user = new User();
            user.setName(name.trim());
            user.setEmail(inv.getEmail());
            user.setPassword(passwordEncoder.encode(password));
            user.setOrganizationId(inv.getWorkspaceId());
            userRepository.save(user);
        } else {
            user = userRepository.findByEmail(inv.getEmail())
                    .orElseThrow(() -> new RuntimeException("User not found"));
        }

        // 6. Add as team member (idempotent) — or sync role if a
        // TeamMember record for this email+workspace already exists.
        //
        // The "already a member" case matters more than it looks: e.g. a
        // stale/duplicate membership from an earlier failed attempt, or a
        // person who was re-invited with a different role than they had
        // before. Previously this branch did nothing at all, silently
        // leaving the OLD role in place even though the invitation being
        // accepted right now says something different — so a person could
        // end up staying (or ending up) an Admin even after being
        // re-invited as a Member.
        try {
            Optional<TeamMember> existing = teamMemberRepository
                    .findByEmailAndOrganizationId(inv.getEmail(), inv.getWorkspaceId());
            String invitedRole = inv.getRole() != null ? inv.getRole() : "MEMBER";
            if (existing.isEmpty()) {
                TeamMember member = new TeamMember();
                member.setName(user.getName());
                member.setEmail(inv.getEmail());
                member.setRole(invitedRole);
                member.setOrganizationId(inv.getWorkspaceId());
                member.setColor("#" + String.format("%06x",
                        (inv.getEmail().hashCode() & 0xffffff) | 0x400000));
                teamMemberRepository.save(member);
            } else {
                TeamMember member = existing.get();
                // The workspace Owner's row (if one even exists as a
                // TeamMember) is never touched by an invitation accept.
                if (!"OWNER".equals(member.getRole()) && !invitedRole.equals(member.getRole())) {
                    member.setRole(invitedRole);
                    teamMemberRepository.save(member);
                }
            }
        } catch (Exception e) {
            throw new RuntimeException("Failed to add you as a team member: " + e.getMessage());
        }

        // 7. Mark invitation accepted
        inv.setStatus("ACCEPTED");
        inv.setAcceptedAt(LocalDateTime.now());
        inv.setAcceptedBy(inv.getEmail());
        invitationRepository.save(inv);

        // 8. Log (non-critical — never crash accept flow over a logging error)
        try {
            activityLogService.logFull("TEAM", inv.getId(), inv.getEmail(),
                    "WORKSPACE_JOINED", null, inv.getRole(), inv.getEmail(),
                    inv.getWorkspaceId(), null, null); // workspaceId as projectId for orgId fallback
        } catch (Exception ignored) {}

        // 9. Load workspace info for frontend (null-safe)
        Workspace ws = null;
        try {
            ws = workspaceRepository.findById(inv.getWorkspaceId()).orElse(null);
        } catch (Exception ignored) {}

        // 10. Build response — use HashMap, never Map.of() (Map.of crashes on null values)
        java.util.Map<String, Object> result = new java.util.HashMap<>();
        result.put("message",       "Invitation accepted successfully");
        result.put("email",         inv.getEmail());
        result.put("workspaceId",   inv.getWorkspaceId());
        result.put("workspaceName", inv.getWorkspaceName() != null ? inv.getWorkspaceName() : "");
        result.put("role",          inv.getRole() != null ? inv.getRole() : "MEMBER");
        result.put("workspace",     ws != null ? ws : new java.util.HashMap<>());
        return result;
    }

    // ── Cancel invitation ─────────────────────────────────────
    public void cancel(String id) {
        Invitation inv = invitationRepository.findById(id)
                .orElseThrow(() -> new RuntimeException(
                        "Invitation not found"));
        inv.setStatus("CANCELLED");
        invitationRepository.save(inv);
    }

    // ── Resend invitation email ───────────────────────────────
    public void resend(String id) {
        Invitation inv = invitationRepository.findById(id)
                .orElseThrow(() -> new RuntimeException(
                        "Invitation not found"));
        // Refresh the workspace name from the current record rather than
        // trusting whatever was frozen on this invitation when it was first
        // created — this is what let a genuinely-null/renamed workspace
        // name get stuck and resent forever instead of self-correcting.
        workspaceRepository.findById(inv.getWorkspaceId())
                .ifPresent(ws -> inv.setWorkspaceName(orFallback(ws.getName(), "your workspace")));
        inv.setToken(UUID.randomUUID().toString());
        inv.setExpiresAt(LocalDateTime.now().plusDays(7));
        invitationRepository.save(inv);
        sendInviteEmail(inv);
    }

    // ── Send branded HTML invite email ─────────────────────────
    private void sendInviteEmail(Invitation inv) {
        String acceptUrl = frontendUrl + "/invite/accept?token=" + inv.getToken();
        // Final safety net: even a pre-existing invitation record that
        // already has a null/blank workspaceName stored (from before this
        // fix existed) gets a sane fallback here rather than literally
        // printing "null" in a user-facing email.
        String safeWorkspaceName = orFallback(inv.getWorkspaceName(), "your workspace");
        // Resolved fresh every send (not baked in at creation time) so a
        // resend picks up the inviter's current display name/role even if
        // it wasn't known — or has since changed — when the invite was
        // first created.
        String inviterDisplay = resolveInviterDisplay(inv.getWorkspaceId(), inv.getInvitedByEmail());
        String html = buildInviteHtml(inv, acceptUrl, safeWorkspaceName, inviterDisplay);

        boolean delivered = emailService.sendHtmlEmail(
                inv.getEmail(),
                inv.getEmail(),
                "You're invited to join " + safeWorkspaceName + " on Prowosma",
                html
        );

        if (!delivered) {
            // The invitation itself was already saved — it's genuinely
            // pending, and "Resend" will work once email is fixed — but the
            // person who clicked "Send" needs to know the email did NOT
            // actually go out, instead of seeing a false "success" message.
            throw new RuntimeException(
                    "The invitation was created, but the email to " + inv.getEmail() +
                    " could not be delivered. This usually means email sending isn't " +
                    "configured on the server yet (GMAIL_USERNAME / GMAIL_APP_PASSWORD). " +
                    "Check the backend console for the exact error, then use \"Resend\" once it's fixed.");
        }
    }

    /**
     * Turns a raw inviter email into something natural to read in the
     * invite email: "Hemanth Kumar K (workspace admin)" instead of a bare
     * email address, or a generic "A workspace admin" only when we truly
     * have nothing better (e.g. very old records, or the inviter's account
     * was deleted since).
     */
    private String resolveInviterDisplay(String workspaceId, String invitedByEmail) {
        if (invitedByEmail == null || invitedByEmail.isBlank() || "system".equalsIgnoreCase(invitedByEmail)) {
            return "A workspace admin";
        }

        String roleLabel = teamMemberRepository.findByEmailAndOrganizationId(invitedByEmail, workspaceId)
                .map(tm -> "OWNER".equalsIgnoreCase(tm.getRole()) ? "workspace owner" : "workspace admin")
                .orElse("workspace admin");

        return userRepository.findByEmail(invitedByEmail)
                .map(User::getName)
                .filter(name -> name != null && !name.isBlank())
                .map(name -> name + " (" + roleLabel + ")")
                // No display name on file for this email — still more useful
                // to show the actual address than a fully generic phrase.
                .orElse(invitedByEmail + " (" + roleLabel + ")");
    }

    /** Never lets a blank/null value leak into user-facing text. */
    private String orFallback(String value, String fallback) {
        return (value != null && !value.isBlank()) ? value : fallback;
    }

    private String buildInviteHtml(Invitation inv, String acceptUrl, String workspaceName, String invitedBy) {
        return """
            <div style="font-family:Arial,sans-serif;max-width:520px;
                        margin:0 auto;padding:32px;background:#fff;">
              <div style="margin-bottom:24px;">
                <span style="font-size:26px;font-weight:900;
                             background:linear-gradient(135deg,#0ea5e9,#6366f1);
                             -webkit-background-clip:text;
                             -webkit-text-fill-color:transparent;">
                  Prowosma
                </span>
              </div>
              <h2 style="font-size:22px;color:#0f172a;margin-bottom:8px;">
                You've been invited to join <strong>%s</strong>
              </h2>
              <p style="color:#64748b;font-size:15px;line-height:1.6;
                        margin-bottom:24px;">
                <strong>%s</strong> has invited you to collaborate.<br/>
                Your role will be: <strong>%s</strong>
              </p>
              <a href="%s"
                 style="display:inline-block;padding:14px 32px;
                        background:#0ea5e9;color:#fff;text-decoration:none;
                        border-radius:8px;font-weight:700;font-size:15px;">
                Accept Invitation →
              </a>
              <p style="color:#94a3b8;font-size:12px;margin-top:32px;
                        border-top:1px solid #e2e8f0;padding-top:16px;">
                This link expires in 7 days.<br/>
                If you didn't expect this invitation, you can ignore this email.
              </p>
            </div>
            """.formatted(
                workspaceName,
                invitedBy,
                inv.getRole(),
                acceptUrl);
    }
}
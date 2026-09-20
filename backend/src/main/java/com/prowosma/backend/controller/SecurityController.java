package com.prowosma.backend.controller;

import com.prowosma.backend.model.User;
import com.prowosma.backend.repository.TaskRepository;
import com.prowosma.backend.repository.ProjectRepository;
import com.prowosma.backend.repository.GoalRepository;
import com.prowosma.backend.repository.UserRepository;
import com.prowosma.backend.repository.TeamMemberRepository;
import com.prowosma.backend.repository.WorkspaceRepository;
import com.prowosma.backend.service.TwoFactorService;
import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.repository.ActivityLogRepository;
import com.prowosma.backend.util.PagedResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import jakarta.servlet.http.HttpServletRequest;
import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/security")
@RequiredArgsConstructor
public class SecurityController {

    private final UserRepository     userRepository;
    private final ActivityLogRepository activityLogRepository;
    private final TwoFactorService   twoFactorService;
    private final TaskRepository     taskRepository;
    private final ProjectRepository  projectRepository;
    private final GoalRepository     goalRepository;
    private final WorkspaceContext   workspaceContext;
    private final TeamMemberRepository teamMemberRepository;
    private final WorkspaceRepository  workspaceRepository;

    /**
     * The users of the caller's workspace: its owner plus its team members.
     *
     * The security dashboard endpoints below used to call userRepository.findAll(), so
     * a workspace admin saw EVERY user on the platform — emails, IP addresses and
     * devices included — across all workspaces. No workspace selected => no users.
     */
    private List<User> workspaceUsers() {
        String orgId = workspaceContext.getWorkspaceId();
        if (orgId == null) return List.of();
        Set<String> emails = new LinkedHashSet<>();
        workspaceRepository.findById(orgId).map(ws -> ws.getOwnerEmail()).ifPresent(emails::add);
        teamMemberRepository.findByOrganizationId(orgId).forEach(m -> {
            if (m.getEmail() != null) emails.add(m.getEmail());
        });
        return emails.stream()
                .map(userRepository::findByEmail)
                .flatMap(Optional::stream)
                .toList();
    }

    private final com.prowosma.backend.repository.WorkspaceConfigRepository workspaceConfigRepository;

    // ── 2FA: begin setup — generate secret + QR ──────────────
    @PostMapping("/2fa/setup")
    public Map<String, Object> setup2fa(Authentication auth) {
        User user = getUser(auth);
        String secret = twoFactorService.generateSecret();
        // Store secret temporarily (not enabled until verified)
        user.setTwoFactorSecret(secret);
        userRepository.save(user);

        String uri   = twoFactorService.buildOtpAuthUri(secret, user.getEmail(), "Prowosma");
        String qrUrl = twoFactorService.buildQrUrl(uri);

        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("secret", secret);
        resp.put("qrUrl",  qrUrl);
        resp.put("uri",    uri);
        return resp;
    }

    // ── 2FA: verify code and enable ───────────────────────────
    @PostMapping("/2fa/verify")
    public ResponseEntity<?> verify2fa(@RequestBody Map<String, String> body, Authentication auth) {
        User   user = getUser(auth);
        String code = body.get("code");
        if (user.getTwoFactorSecret() == null)
            return ResponseEntity.badRequest().body(Map.of("error", "Run setup first"));
        if (!twoFactorService.verify(user.getTwoFactorSecret(), code))
            return ResponseEntity.badRequest().body(Map.of("error", "Invalid code"));
        user.setTwoFactorEnabled(true);
        userRepository.save(user);
        return ResponseEntity.ok(Map.of("message", "2FA enabled", "enabled", true));
    }

    // ── 2FA: disable ──────────────────────────────────────────
    @PostMapping("/2fa/disable")
    public ResponseEntity<?> disable2fa(@RequestBody Map<String, String> body, Authentication auth) {
        User   user = getUser(auth);
        String code = body.get("code");
        if (user.isTwoFactorEnabled() && !twoFactorService.verify(user.getTwoFactorSecret(), code))
            return ResponseEntity.badRequest().body(Map.of("error", "Invalid code — enter your current 2FA code to disable"));
        user.setTwoFactorEnabled(false);
        user.setTwoFactorSecret(null);
        userRepository.save(user);
        return ResponseEntity.ok(Map.of("message", "2FA disabled", "enabled", false));
    }

    // ── 2FA: status ───────────────────────────────────────────
    @GetMapping("/2fa/status")
    public Map<String, Object> get2faStatus(Authentication auth) {
        User user = getUser(auth);
        return Map.of("enabled", user.isTwoFactorEnabled());
    }

    // ── Sessions: list active sessions ────────────────────────
    @GetMapping("/sessions")
    public List<User.LoginSession> getSessions(Authentication auth) {
        User user = getUser(auth);
        return user.getLoginSessions() != null ? user.getLoginSessions() : List.of();
    }

    // ── Sessions: record login (called from AuthService) ──────
    @PostMapping("/sessions/record")
    public ResponseEntity<?> recordSession(@RequestBody Map<String, String> body, Authentication auth) {
        User user = getUser(auth);
        recordSessionForUser(user, body.get("ipAddress"), body.get("userAgent"), true);
        return ResponseEntity.ok(Map.of("ok", true));
    }

    // ── Sessions: revoke a specific session ───────────────────
    @DeleteMapping("/sessions/{sessionId}")
    public ResponseEntity<?> revokeSession(@PathVariable String sessionId, Authentication auth) {
        User user = getUser(auth);
        if (user.getLoginSessions() != null)
            user.getLoginSessions().removeIf(s -> s.getId().equals(sessionId));
        userRepository.save(user);
        return ResponseEntity.ok(Map.of("message", "Session revoked"));
    }

    // ── Sessions: revoke all except current ───────────────────
    @DeleteMapping("/sessions")
    public ResponseEntity<?> revokeAllSessions(Authentication auth) {
        User user = getUser(auth);
        if (user.getLoginSessions() != null)
            user.getLoginSessions().removeIf(s -> !s.isCurrent());
        userRepository.save(user);
        return ResponseEntity.ok(Map.of("message", "All other sessions revoked"));
    }

    // ── GDPR: export all user data ────────────────────────────
    @GetMapping("/gdpr/export")
    public Map<String, Object> exportData(Authentication auth) {
        User   user  = getUser(auth);
        String orgId = workspaceContext.getWorkspaceId();

        // Record export request
        user.setGdprExportRequestedAt(LocalDateTime.now());
        userRepository.save(user);

        Map<String, Object> export = new LinkedHashMap<>();
        export.put("exportedAt",  LocalDateTime.now().toString());
        export.put("dataRegion",  workspaceRepository.findById(orgId)
                .map(com.prowosma.backend.model.Workspace::getDataRegion).orElse("UNSET"));
        export.put("profile", Map.of(
                "id",    user.getId(),
                "name",  user.getName(),
                "email", user.getEmail(),
                "role",  user.getRole(),
                "createdAt", user.getCreatedAt() != null ? user.getCreatedAt().toString() : null
        ));
        export.put("tasks",    taskRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent().stream()
                .filter(t -> user.getEmail().equals(t.getCreatedBy()) ||
                            (t.getAssigneeIds() != null && t.getAssigneeIds().contains(user.getId())))
                .map(t -> Map.of("id", t.getId(), "title", t.getTitle(), "status", t.getStatus()))
                .collect(Collectors.toList()));
        export.put("projects", projectRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent().stream()
                .filter(p -> user.getEmail().equals(p.getCreatedBy()))
                .map(p -> Map.of("id", p.getId(), "name", p.getName()))
                .collect(Collectors.toList()));
        export.put("sessions", user.getLoginSessions() != null ? user.getLoginSessions() : List.of());
        return export;
    }

    // ── GDPR: request deferred account deletion ───────────────────
    // Previously this endpoint told the user "Your account will be
    // permanently deleted within 30 days" without recording the request
    // anywhere or scheduling anything to actually happen — a real, false
    // compliance claim (the prior code's own comment admitted it: "In a
    // real app this would trigger a deletion workflow"). Now genuinely
    // schedules it — see GdprDeletionSchedulerService, which performs the
    // real deletion once gdprDeletionScheduledFor is reached.
    @PostMapping("/gdpr/delete-request")
    public ResponseEntity<?> requestDeletion(Authentication auth) {
        User user = getUser(auth);
        LocalDateTime scheduledFor = LocalDateTime.now().plusDays(30);
        user.setGdprDeletionRequestedAt(LocalDateTime.now());
        user.setGdprDeletionScheduledFor(scheduledFor);
        userRepository.save(user);

        return ResponseEntity.ok(Map.of(
            "message", "Deletion request received. Your account will be permanently deleted on "
                + scheduledFor.toLocalDate() + " unless you cancel this request before then.",
            "requestedAt", user.getGdprDeletionRequestedAt().toString(),
            "scheduledFor", scheduledFor.toString()
        ));
    }

    // ── GDPR: cancel a pending deferred deletion request ──────────
    @PostMapping("/gdpr/delete-request/cancel")
    public ResponseEntity<?> cancelDeletionRequest(Authentication auth) {
        User user = getUser(auth);
        if (user.getGdprDeletionScheduledFor() == null) {
            return ResponseEntity.badRequest().body(Map.of("message", "No deletion request is pending."));
        }
        user.setGdprDeletionRequestedAt(null);
        user.setGdprDeletionScheduledFor(null);
        userRepository.save(user);
        return ResponseEntity.ok(Map.of("message", "Deletion request cancelled. Your account will not be deleted."));
    }

    // ── Helper ────────────────────────────────────────────────
    private User getUser(Authentication auth) {
        return userRepository.findByEmail(auth.getName())
                .orElseThrow(() -> new RuntimeException("User not found"));
    }

    /** @return the id of the newly created session — embed this in the issued JWT (see JwtUtil.generateToken(email, sessionId)) so revocation/timeout/concurrency-cap enforcement can actually target this specific session. */
    public String recordSessionForUser(User user, String ip, String ua, boolean current) {
        if (user.getLoginSessions() == null)
            user.setLoginSessions(new ArrayList<>());
        // Mark all existing as not-current
        user.getLoginSessions().forEach(s -> s.setCurrent(false));

        // Enforce the workspace's concurrency cap (if configured) by
        // evicting the oldest session(s) before adding the new one — this
        // now genuinely logs those devices out, since JwtFilter validates
        // each request's session id against this same list.
        int cap = maxConcurrentSessionsFor(user.getEmail());
        if (cap > 0 && user.getLoginSessions().size() >= cap) {
            user.getLoginSessions().sort(Comparator.comparing(User.LoginSession::getCreatedAt));
            int toRemove = user.getLoginSessions().size() - cap + 1;
            for (int i = 0; i < toRemove && !user.getLoginSessions().isEmpty(); i++) {
                user.getLoginSessions().remove(0);
            }
        }

        // Add new session
        User.LoginSession session = new User.LoginSession();
        session.setIpAddress(ip);
        session.setUserAgent(ua);
        session.setDevice(parseDevice(ua));
        session.setCurrent(current);
        user.getLoginSessions().add(session);
        // Keep last 10 sessions only
        if (user.getLoginSessions().size() > 10)
            user.setLoginSessions(user.getLoginSessions()
                    .subList(user.getLoginSessions().size() - 10, user.getLoginSessions().size()));
        user.setLastLoginAt(LocalDateTime.now());
        user.setLastLoginIp(ip);
        userRepository.save(user);
        return session.getId();
    }

    /** Session cap is workspace-configured; a user's own owned workspace (if any) is used - see the same reasoning in PasswordPolicyService/AuthService for why. 0 = unlimited. */
    private int maxConcurrentSessionsFor(String email) {
        var owned = workspaceRepository.findByOwnerEmail(email);
        if (owned.isEmpty()) return 0;
        return workspaceConfigRepository.findByWorkspaceId(owned.get(0).getId())
                .map(com.prowosma.backend.model.WorkspaceConfig::getMaxConcurrentSessions)
                .orElse(0);
    }

    private String parseDevice(String ua) {
        if (ua == null) return "Unknown";
        if (ua.contains("iPhone"))  return "iPhone";
        if (ua.contains("Android")) return "Android";
        if (ua.contains("iPad"))    return "iPad";
        String browser = ua.contains("Chrome") ? "Chrome"
                       : ua.contains("Firefox") ? "Firefox"
                       : ua.contains("Safari") ? "Safari"
                       : ua.contains("Edge") ? "Edge" : "Browser";
        String os = ua.contains("Windows") ? "Windows"
                  : ua.contains("Mac")     ? "macOS"
                  : ua.contains("Linux")   ? "Linux" : "Desktop";
        return browser + " / " + os;
    }

    // C-3: Security Centre stats
    @GetMapping("/stats")
    public Map<String, Object> getSecurityStats() {
        List<User> users = workspaceUsers();
        long total   = users.size();
        long twoFa   = users.stream().filter(User::isTwoFactorEnabled).count();
        long deact   = users.stream().filter(u -> "DEACTIVATED".equals(u.getRole())).count();
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("totalUsers",        total);
        r.put("twoFaUsers",        twoFa);
        r.put("deactivatedUsers",  deact);
        r.put("mfaAdoptionPct",    total == 0 ? 0 : Math.round(twoFa * 100.0 / total));
        long failed24h = activityLogRepository.countByOrganizationIdAndActionAndCreatedAtBetween(
            workspaceContext.getWorkspaceId(), "LOGIN_FAILED",
            LocalDateTime.now().minusDays(1), LocalDateTime.now());
        r.put("failedLogins24h", failed24h);
        r.put("anomalousLogins", failed24h > 5 ? failed24h - 5 : 0);
        return r;
    }

    @GetMapping("/sessions/all")
    public PagedResponse<Map<String, Object>> getAllSessions(
            @RequestParam(defaultValue = "0")  int page,
            @RequestParam(defaultValue = "50") int size) {
        var all = workspaceUsers().stream()
            .flatMap(u -> (u.getLoginSessions() != null ? u.getLoginSessions() : List.<User.LoginSession>of())
                .stream().map(s -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id",           s.getId());
                    m.put("email",        u.getEmail());
                    m.put("ipAddress",    s.getIpAddress());
                    m.put("lastActiveAt", s.getCreatedAt());
                    m.put("deviceInfo",   s.getUserAgent() != null ? s.getUserAgent() : "Unknown");
                    return m;
                }))
            .toList();
        return PagedResponse.ofList(all, page, Math.min(size, 200));
    }

}

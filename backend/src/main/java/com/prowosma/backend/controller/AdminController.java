package com.prowosma.backend.controller;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.config.region.RegionConfig;
import com.prowosma.backend.model.WorkspaceConfig;
import com.prowosma.backend.model.DlpViolation;
import com.prowosma.backend.model.Workspace;
import com.prowosma.backend.repository.*;
import com.prowosma.backend.service.ActivityLogService;
import com.prowosma.backend.service.EmailService;
import com.prowosma.backend.service.FieldEncryptionService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.*;

/**
 * AdminController — Feature flags, usage analytics, retention, billing.
 *
 * Fix: Feature flags and retention policies are now persisted in MongoDB
 * via WorkspaceConfigRepository instead of a static ConcurrentHashMap.
 * They survive pod restarts and work in multi-instance deployments.
 */
@RestController
@RequestMapping("/api/admin")
@Tag(name = "Admin APIs", description = "Feature flags, usage analytics, retention, billing")
@RequiredArgsConstructor
public class AdminController {

    private final UserRepository            userRepository;
    private final TaskRepository            taskRepository;
    private final ProjectRepository         projectRepository;
    private final DocRepository             docRepository;
    private final ActivityLogRepository     activityLogRepository;
    private final WorkspaceConfigRepository configRepository;
    private final DlpViolationRepository    dlpViolationRepository;
    private final ActivityLogService        activityLogService;
    private final WorkspaceContext          workspaceContext;
    private final EmailService              emailService;
    private final WorkspaceRepository       workspaceRepository;
    private final RegionConfig              regionConfig;
    private final FieldEncryptionService    fieldEncryptionService;

    @Value("${app.deployment.region:US}")
    private String deploymentRegion;

    // ── Feature Flags (MongoDB-backed) ────────────────────────

    @GetMapping("/features")
    @Operation(summary = "Get all feature flags for this workspace")
    public Map<String, Boolean> getFeatures() {
        String orgId = workspaceContext.getWorkspaceId();
        if (orgId == null) return new HashMap<>();
        return getOrCreateConfig(orgId).getFeatureFlags();
    }

    @PostMapping("/features")
    @Operation(summary = "Set a feature flag")
    public ResponseEntity<?> saveFeature(@RequestBody Map<String, Object> body) {
        String orgId   = workspaceContext.getWorkspaceId();
        String key     = (String) body.get("key");
        boolean enabled = Boolean.TRUE.equals(body.getOrDefault("enabled", true));

        WorkspaceConfig cfg = getOrCreateConfig(orgId);
        cfg.getFeatureFlags().put(key, enabled);
        cfg.setUpdatedAt(LocalDateTime.now());
        configRepository.save(cfg);

        activityLogService.log("FEATURE_FLAG", key, key,
                enabled ? "ENABLED" : "DISABLED", String.valueOf(!enabled), String.valueOf(enabled), null);

        return ResponseEntity.ok(Map.of("key", key, "enabled", enabled, "persisted", true));
    }

    @DeleteMapping("/features/{key}")
    @Operation(summary = "Remove a feature flag")
    public ResponseEntity<?> deleteFeature(@PathVariable String key) {
        String orgId = workspaceContext.getWorkspaceId();
        WorkspaceConfig cfg = getOrCreateConfig(orgId);
        cfg.getFeatureFlags().remove(key);
        cfg.setUpdatedAt(LocalDateTime.now());
        configRepository.save(cfg);
        return ResponseEntity.ok(Map.of("key", key, "removed", true));
    }

    // ── Usage Analytics (real counts from DB) ─────────────────

    @GetMapping("/usage")
    @Operation(summary = "Get workspace usage statistics")
    public Map<String, Object> getUsage() {
        String orgId = workspaceContext.getWorkspaceId();
        Map<String, Object> stats = new LinkedHashMap<>();
        if (orgId == null) {
            stats.put("tasks", 0); stats.put("docs", 0); stats.put("projects", 0);
            stats.put("storage", 0); stats.put("aiCredits", 0); stats.put("automationRuns", 0);
            stats.put("dau", 0); stats.put("wau", 0); stats.put("mau", 0);
            return stats;
        }

        stats.put("tasks",    taskRepository.countByOrganizationId(orgId));
        stats.put("docs",     (long) docRepository.findByWorkspaceIdAndDeletedFalse(orgId).size());  // small list
        stats.put("projects", projectRepository.countByOrganizationId(orgId));
        stats.put("goals",    0L); // populated from GoalRepository if needed
        stats.put("storage",  0L); // file size tracking — future work
        stats.put("aiCredits", 0L);

        // DAU/WAU/MAU derived from activity logs
        LocalDateTime now   = LocalDateTime.now();
        LocalDateTime day   = now.minusDays(1);
        LocalDateTime week  = now.minusDays(7);
        LocalDateTime month = now.minusDays(30);

        long dauCount = activityLogRepository.countByOrganizationIdAndCreatedAtBetween(orgId, day,   now);
        long wauCount = activityLogRepository.countByOrganizationIdAndCreatedAtBetween(orgId, week,  now);
        long mauCount = activityLogRepository.countByOrganizationIdAndCreatedAtBetween(orgId, month, now);

        stats.put("dau", dauCount);
        stats.put("wau", wauCount);
        stats.put("mau", mauCount);

        return stats;
    }

    // ── Data Retention (MongoDB-backed) ───────────────────────

    @GetMapping("/retention")
    @Operation(summary = "Get retention policy for this workspace")
    public Map<String, Object> getRetention() {
        String orgId = workspaceContext.getWorkspaceId();
        if (orgId == null) return defaultRetentionPolicy();
        WorkspaceConfig cfg = getOrCreateConfig(orgId);
        Map<String, Object> policy = new LinkedHashMap<>();
        policy.put("retentionDays",     cfg.getRetentionDays());
        policy.put("legalHoldEnabled",  cfg.isLegalHoldEnabled());
        policy.put("legalHoldReason",   cfg.getLegalHoldReason());
        policy.put("autoDeleteEnabled", cfg.isAutoDeleteEnabled());
        return policy;
    }

    @PostMapping("/retention")
    @Operation(summary = "Update retention policy")
    public ResponseEntity<?> saveRetention(@RequestBody Map<String, Object> policy) {
        String orgId = workspaceContext.getWorkspaceId();
        WorkspaceConfig cfg = getOrCreateConfig(orgId);

        if (policy.containsKey("retentionDays"))
            cfg.setRetentionDays(((Number) policy.get("retentionDays")).intValue());
        if (policy.containsKey("legalHoldEnabled"))
            cfg.setLegalHoldEnabled(Boolean.TRUE.equals(policy.get("legalHoldEnabled")));
        if (policy.containsKey("legalHoldReason"))
            cfg.setLegalHoldReason((String) policy.getOrDefault("legalHoldReason", ""));
        if (policy.containsKey("autoDeleteEnabled"))
            cfg.setAutoDeleteEnabled(Boolean.TRUE.equals(policy.get("autoDeleteEnabled")));

        cfg.setUpdatedAt(LocalDateTime.now());
        configRepository.save(cfg);

        activityLogService.log("RETENTION_POLICY", orgId, "Retention Policy",
                "UPDATED", null, cfg.getRetentionDays() + " days", null);

        return ResponseEntity.ok(policy);
    }

    // ── Billing ────────────────────────────────────────────────
    // Moved to BillingController (/api/billing) — real Stripe-backed
    // subscription state, checkout, portal, and plan enforcement.
    // See BillingService for the implementation.

    // ── Email Settings (per-workspace SMTP) ───────────────────
    // Lets each workspace configure its own mail account for sending
    // invites/notifications through the UI, instead of requiring the app
    // operator to set server-wide environment variables. Falls back to the
    // server-wide sender automatically if a workspace never configures
    // this — see EmailService.resolveSender().

    @GetMapping("/email-settings")
    @Operation(summary = "Get this workspace's email settings (password never returned)")
    public Map<String, Object> getEmailSettings() {
        String orgId = workspaceContext.getWorkspaceId();
        WorkspaceConfig cfg = getOrCreateConfig(orgId);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("emailConfigured", cfg.isEmailConfigured());
        result.put("smtpHost",        cfg.getSmtpHost());
        result.put("smtpPort",        cfg.getSmtpPort());
        result.put("smtpUsername",    cfg.getSmtpUsername());
        // Never return the real password - just tell the frontend whether
        // one is already saved, so the form can show a placeholder instead
        // of forcing re-entry every time you open the page.
        result.put("hasPassword",     cfg.getSmtpPassword() != null && !cfg.getSmtpPassword().isBlank());
        result.put("fromEmail",       cfg.getFromEmail());
        result.put("fromName",        cfg.getFromName());
        result.put("smtpUseTls",      cfg.isSmtpUseTls());
        result.put("lastTestAt",      cfg.getLastTestAt());
        result.put("lastTestSuccess", cfg.isLastTestSuccess());
        result.put("lastTestError",   cfg.getLastTestError());
        return result;
    }

    @PostMapping("/email-settings")
    @Operation(summary = "Save this workspace's email settings")
    public ResponseEntity<?> saveEmailSettings(@RequestBody Map<String, Object> body) {
        String orgId = workspaceContext.getWorkspaceId();
        WorkspaceConfig cfg = getOrCreateConfig(orgId);

        if (body.containsKey("smtpHost"))     cfg.setSmtpHost((String) body.get("smtpHost"));
        if (body.containsKey("smtpPort"))     cfg.setSmtpPort(((Number) body.get("smtpPort")).intValue());
        if (body.containsKey("smtpUsername")) cfg.setSmtpUsername((String) body.get("smtpUsername"));
        if (body.containsKey("fromEmail"))    cfg.setFromEmail((String) body.get("fromEmail"));
        if (body.containsKey("fromName"))     cfg.setFromName((String) body.get("fromName"));
        if (body.containsKey("smtpUseTls"))   cfg.setSmtpUseTls(Boolean.TRUE.equals(body.get("smtpUseTls")));
        // Only overwrite the saved password if a new one was actually typed -
        // the frontend sends smtpPassword only when the user changed it,
        // never re-sends the masked placeholder back.
        if (body.containsKey("smtpPassword")) {
            String pw = (String) body.get("smtpPassword");
            if (pw != null && !pw.isBlank()) cfg.setSmtpPassword(fieldEncryptionService.encrypt(pw));
        }

        boolean ready = cfg.getSmtpHost() != null && !cfg.getSmtpHost().isBlank()
                && cfg.getSmtpUsername() != null && !cfg.getSmtpUsername().isBlank()
                && cfg.getSmtpPassword() != null && !cfg.getSmtpPassword().isBlank();
        cfg.setEmailConfigured(ready);
        cfg.setUpdatedAt(LocalDateTime.now());
        configRepository.save(cfg);

        return ResponseEntity.ok(Map.of(
                "emailConfigured", ready,
                "message", ready
                        ? "Email settings saved — this workspace will now send invites through its own mail account."
                        : "Settings saved, but host/username/password aren't all filled in yet, so sending will still use the server default until they are."
        ));
    }

    @PostMapping("/email-settings/test")
    @Operation(summary = "Send a real test email using the currently saved settings")
    public ResponseEntity<?> testEmailSettings(@RequestBody Map<String, String> body) {
        String to = body.get("to");
        if (to == null || to.isBlank())
            return ResponseEntity.badRequest().body(Map.of("error", "A recipient email is required"));

        String orgId = workspaceContext.getWorkspaceId();
        WorkspaceConfig cfg = getOrCreateConfig(orgId);
        if (cfg.getSmtpHost() == null || cfg.getSmtpUsername() == null || cfg.getSmtpPassword() == null) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "Fill in and save host, username, and password before sending a test email."));
        }

        String error = emailService.sendTestEmail(to, cfg);
        cfg.setLastTestAt(LocalDateTime.now());
        cfg.setLastTestSuccess(error == null);
        cfg.setLastTestError(error);
        configRepository.save(cfg);

        if (error == null) {
            return ResponseEntity.ok(Map.of("success", true, "message", "Test email sent to " + to + " — check the inbox."));
        }
        return ResponseEntity.badRequest().body(Map.of("success", false, "error", error));
    }

    // ── Email suppression list (hard bounces / spam complaints) ─────────
    // Populated automatically by EmailWebhookController from the configured
    // provider's bounce/complaint webhooks (see docs/EMAIL_SETUP.md) —
    // these two endpoints are read/manage-only, for an admin to review why
    // a user says they "never got the email" (often: they're suppressed)
    // and to clear a suppression after a genuine typo is fixed.

    @GetMapping("/email-suppressions")
    @Operation(summary = "List addresses currently suppressed from receiving email (hard bounce / spam complaint)")
    public ResponseEntity<?> listEmailSuppressions() {
        return ResponseEntity.ok(Map.of("suppressions", emailService.listSuppressions()));
    }

    @DeleteMapping("/email-suppressions/{email}")
    @Operation(summary = "Remove an address from the suppression list (e.g. after a typo'd address is corrected)")
    public ResponseEntity<?> removeEmailSuppression(@PathVariable String email) {
        emailService.unsuppress(email);
        return ResponseEntity.ok(Map.of("removed", email));
    }

    // ── Security Policy (password complexity/expiry, session limits) ──
    // Configures the fields PasswordPolicyService, JwtFilter, and
    // SecurityController's concurrency-cap logic actually enforce (see
    // those classes) - previously there was no way to change these from
    // their defaults short of editing the database directly.

    @GetMapping("/security-policy")
    @Operation(summary = "Get this workspace's password and session policy")
    public Map<String, Object> getSecurityPolicy() {
        WorkspaceConfig cfg = getOrCreateConfig(workspaceContext.getWorkspaceId());
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("passwordMinLength",        cfg.getPasswordMinLength());
        result.put("passwordRequireUppercase", cfg.isPasswordRequireUppercase());
        result.put("passwordRequireLowercase", cfg.isPasswordRequireLowercase());
        result.put("passwordRequireNumber",    cfg.isPasswordRequireNumber());
        result.put("passwordRequireSpecial",   cfg.isPasswordRequireSpecial());
        result.put("passwordExpiryDays",       cfg.getPasswordExpiryDays());
        result.put("sessionTimeoutMinutes",    cfg.getSessionTimeoutMinutes());
        result.put("maxConcurrentSessions",    cfg.getMaxConcurrentSessions());
        return result;
    }

    @PostMapping("/security-policy")
    @Operation(summary = "Save this workspace's password and session policy")
    public ResponseEntity<?> saveSecurityPolicy(@RequestBody Map<String, Object> body) {
        WorkspaceConfig cfg = getOrCreateConfig(workspaceContext.getWorkspaceId());

        if (body.containsKey("passwordMinLength")) {
            int v = ((Number) body.get("passwordMinLength")).intValue();
            if (v < 6) return ResponseEntity.badRequest().body(Map.of("error", "Minimum password length can't be set below 6."));
            cfg.setPasswordMinLength(v);
        }
        if (body.containsKey("passwordRequireUppercase")) cfg.setPasswordRequireUppercase(Boolean.TRUE.equals(body.get("passwordRequireUppercase")));
        if (body.containsKey("passwordRequireLowercase")) cfg.setPasswordRequireLowercase(Boolean.TRUE.equals(body.get("passwordRequireLowercase")));
        if (body.containsKey("passwordRequireNumber"))    cfg.setPasswordRequireNumber(Boolean.TRUE.equals(body.get("passwordRequireNumber")));
        if (body.containsKey("passwordRequireSpecial"))   cfg.setPasswordRequireSpecial(Boolean.TRUE.equals(body.get("passwordRequireSpecial")));
        if (body.containsKey("passwordExpiryDays")) {
            int v = ((Number) body.get("passwordExpiryDays")).intValue();
            if (v < 0) return ResponseEntity.badRequest().body(Map.of("error", "Password expiry days can't be negative."));
            cfg.setPasswordExpiryDays(v);
        }
        if (body.containsKey("sessionTimeoutMinutes")) {
            int v = ((Number) body.get("sessionTimeoutMinutes")).intValue();
            if (v < 0) return ResponseEntity.badRequest().body(Map.of("error", "Session timeout can't be negative."));
            cfg.setSessionTimeoutMinutes(v);
        }
        if (body.containsKey("maxConcurrentSessions")) {
            int v = ((Number) body.get("maxConcurrentSessions")).intValue();
            if (v < 0) return ResponseEntity.badRequest().body(Map.of("error", "Max concurrent sessions can't be negative."));
            cfg.setMaxConcurrentSessions(v);
        }

        cfg.setUpdatedAt(LocalDateTime.now());
        configRepository.save(cfg);
        return ResponseEntity.ok(Map.of("message", "Security policy saved."));
    }

    // ── DLP (Data Loss Prevention) policy + audit log ──────────
    // The actual content scanning/redaction logic lives in DlpController
    // (/api/dlp/scan, /api/dlp/classify) — any authenticated member can call
    // those to scan content they're creating. This section is the
    // admin-only half: configuring the policy those scans follow, and
    // reviewing what's been flagged. Kept under /api/admin/ specifically so
    // it inherits RoleGuardFilter's existing ADMIN_ONLY_PATHS protection.

    @GetMapping("/dlp-policy")
    @Operation(summary = "Get this workspace's DLP policy")
    public Map<String, Object> getDlpPolicy() {
        WorkspaceConfig cfg = getOrCreateConfig(workspaceContext.getWorkspaceId());
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("scanOnSave",        cfg.isDlpScanOnSave());
        result.put("blockHighRisk",     cfg.isDlpBlockHighRisk());
        result.put("autoRedact",        cfg.isDlpAutoRedact());
        result.put("notifyOnViolation", cfg.isDlpNotifyOnViolation());
        return result;
    }

    @PostMapping("/dlp-policy")
    @Operation(summary = "Save this workspace's DLP policy")
    public ResponseEntity<?> saveDlpPolicy(@RequestBody Map<String, Object> body) {
        WorkspaceConfig cfg = getOrCreateConfig(workspaceContext.getWorkspaceId());
        if (body.containsKey("scanOnSave"))        cfg.setDlpScanOnSave(Boolean.TRUE.equals(body.get("scanOnSave")));
        if (body.containsKey("blockHighRisk"))     cfg.setDlpBlockHighRisk(Boolean.TRUE.equals(body.get("blockHighRisk")));
        if (body.containsKey("autoRedact"))        cfg.setDlpAutoRedact(Boolean.TRUE.equals(body.get("autoRedact")));
        if (body.containsKey("notifyOnViolation")) cfg.setDlpNotifyOnViolation(Boolean.TRUE.equals(body.get("notifyOnViolation")));
        cfg.setUpdatedAt(LocalDateTime.now());
        configRepository.save(cfg);
        return ResponseEntity.ok(Map.of("message", "DLP policy saved."));
    }

    @GetMapping("/dlp-violations")
    @Operation(summary = "Recent DLP scan findings for this workspace (audit log)")
    public List<DlpViolation> getDlpViolations() {
        return dlpViolationRepository.findByOrganizationIdOrderByScannedAtDesc(workspaceContext.getWorkspaceId());
    }

    // ── Data Residency ──────────────────────────────────────────
    // Previously always reported enforced=false, unconditionally — because
    // there was no routing infrastructure at all to make that claim true.
    // See config/region/ (RegionConfig, RegionRoutingMongoDatabaseFactory,
    // DataRegionRoutingFilter) and docs/DATA_RESIDENCY.md — enforcement
    // infrastructure now genuinely exists, opt-in per collection. This
    // endpoint now reports enforced=true only when BOTH (a) a real,
    // distinct MongoDB connection is configured for the declared region
    // (RegionConfig.canEnforce), AND (b) it's true regardless of whether
    // any given collection has actually been migrated onto the
    // region-routed template yet — see the docs for why that second
    // caveat still matters and isn't glossed over below.
    @GetMapping("/data-residency")
    @Operation(summary = "Compare this workspace's declared data region against where this deployment actually runs")
    public Map<String, Object> getDataResidencyStatus() {
        Workspace ws = workspaceRepository.findById(workspaceContext.getWorkspaceId())
                .orElseThrow();
        String declared   = ws.getDataRegion() == null ? "UNSET" : ws.getDataRegion();
        boolean matches    = "UNSET".equals(declared) || declared.equalsIgnoreCase(deploymentRegion);
        boolean infraConfigured = regionConfig.canEnforce(declared);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("declaredRegion",   declared);
        result.put("deploymentRegion", deploymentRegion);
        result.put("matches",          matches);
        result.put("enforced",         infraConfigured);
        result.put("message", "UNSET".equals(declared)
            ? "No data region has been declared for this workspace yet."
            : infraConfigured
                ? "A real, distinct database connection is configured for " + declared + ". Note: this " +
                    "reflects whether the ROUTING INFRASTRUCTURE exists, not that every collection has been " +
                    "migrated onto it yet — see docs/DATA_RESIDENCY.md for which collections are currently " +
                    "region-routed vs. still in the shared home database."
                : matches
                    ? "Declared region matches this deployment's actual region, but no distinct per-region " +
                        "database connection is configured (MONGODB_URI_" + declared + " unset) — this is " +
                        "still a single-database deployment, not physical multi-region residency."
                    : "This workspace is declared as " + declared + ", but this deployment instance is " +
                        "running in " + deploymentRegion + ", and no MONGODB_URI_" + declared + " connection " +
                        "is configured either. No data has been moved — this only flags the mismatch.");
        return result;
    }

    // ── IP Allowlisting ───────────────────────────────────────

    @GetMapping("/ip-allowlist")
    @Operation(summary = "Get IP allowlist for this workspace")
    public List<String> getIpAllowlist() {
        String orgId = workspaceContext.getWorkspaceId();
        return com.prowosma.backend.config.IpAllowlistFilter.ALLOWLISTS
            .getOrDefault(orgId, new ArrayList<>());
    }

    @PostMapping("/ip-allowlist")
    @Operation(summary = "Set IP allowlist for this workspace")
    public ResponseEntity<?> saveIpAllowlist(@RequestBody Map<String, Object> body) {
        String orgId = workspaceContext.getWorkspaceId();
        @SuppressWarnings("unchecked")
        List<String> ips = (List<String>) body.getOrDefault("ips", new ArrayList<>());
        com.prowosma.backend.config.IpAllowlistFilter.ALLOWLISTS.put(orgId, ips);
        return ResponseEntity.ok(Map.of("ips", ips, "message", "Allowlist updated"));
    }

    // ── Private helpers ───────────────────────────────────────

    private WorkspaceConfig getOrCreateConfig(String workspaceId) {
        return configRepository.findByWorkspaceId(workspaceId)
                .orElseGet(() -> {
                    WorkspaceConfig cfg = new WorkspaceConfig();
                    cfg.setWorkspaceId(workspaceId);
                    return configRepository.save(cfg);
                });
    }

    private Map<String, Object> defaultRetentionPolicy() {
        return Map.of(
            "retentionDays",     2557,
            "legalHoldEnabled",  false,
            "legalHoldReason",   "",
            "autoDeleteEnabled", false
        );
    }
}

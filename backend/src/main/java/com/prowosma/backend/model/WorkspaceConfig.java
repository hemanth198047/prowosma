package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

/**
 * Persistent workspace configuration — replaces the in-memory ConcurrentHashMap
 * that was used for feature flags and retention policies in AdminController.
 *
 * Fix: feature flags and retention policies now survive pod restarts.
 * One document per workspace, upserted on save.
 */
@Data
@Document(collection = "workspace_configs")
public class WorkspaceConfig {

    @Id
    private String id;

    @Indexed(unique = true)
    private String workspaceId;

    /** Feature flags: key → enabled */
    private Map<String, Boolean> featureFlags = new HashMap<>();

    /** Data retention policy */
    private int     retentionDays    = 2557;   // ~7 years default
    private boolean legalHoldEnabled = false;
    private String  legalHoldReason  = "";
    private boolean autoDeleteEnabled= false;

    /** Per-workspace SMTP settings — lets each workspace send invite/notification
     *  emails through its own mail account instead of relying on server-wide
     *  environment variables. Password is stored the same way other
     *  third-party credentials already are in this app (Integration.config) —
     *  plaintext at rest, never returned by the GET endpoint. */
    private boolean emailConfigured   = false;
    private String  smtpHost          = "smtp.gmail.com";
    private int     smtpPort          = 587;
    private String  smtpUsername;
    private String  smtpPassword;
    private String  fromEmail;
    private String  fromName          = "Prowosma";
    private boolean smtpUseTls        = true;
    private LocalDateTime lastTestAt;
    private boolean lastTestSuccess;
    private String  lastTestError;

    /** Password complexity/expiry policy for this workspace. Registration
     *  (which happens before any workspace exists) uses PasswordPolicyService's
     *  built-in sane defaults instead - these only apply once a workspace
     *  context is available (password changes, expiry checks at login). */
    private int     passwordMinLength         = 8;
    private boolean passwordRequireUppercase  = true;
    private boolean passwordRequireLowercase  = true;
    private boolean passwordRequireNumber     = true;
    private boolean passwordRequireSpecial    = false;
    /** 0 = passwords never expire. */
    private int     passwordExpiryDays        = 0;

    /** Idle-session timeout in minutes. 0 = disabled. */
    private int     sessionTimeoutMinutes     = 0;
    /** Max concurrent active sessions per user. 0 = unlimited. Oldest
     *  session is auto-revoked when a new login would exceed this. */
    private int     maxConcurrentSessions     = 0;

    /** DLP (Data Loss Prevention) policy. Previously DlpController.getPolicy()
     *  returned a hardcoded Map regardless of workspace — despite the field
     *  name and a comment both claiming "policy is workspace-level," nothing
     *  was actually configurable or persisted. These fields make it real. */
    private boolean dlpScanOnSave        = true;
    private boolean dlpBlockHighRisk     = false;
    private boolean dlpAutoRedact        = false;
    private boolean dlpNotifyOnViolation = true;

    // ── Department / project access control ───────────────────────────────────
    /** Off by default: nothing changes for a workspace until an admin switches this on. */
    private boolean accessControlEnabled = false;
    /** Profile applied to members who have none of their own. Null = such members are unrestricted (legacy). */
    private String defaultAccessProfileId;
    /** Visibility given to a new project that does not choose one: WORKSPACE | DEPARTMENTS | MEMBERS_ONLY. */
    private String defaultProjectVisibility = "WORKSPACE";
    /** The named responsibilities a project can assign to people, e.g. Creative Lead. Defined per workspace. */
    private java.util.List<RoleSlot> projectRoleSlots = new java.util.ArrayList<>();

    @Data
    public static class RoleSlot {
        private String key;     // stable id, e.g. CREATIVE_LEAD
        private String label;   // shown in the UI, e.g. "Creative Lead"
    }

    private LocalDateTime updatedAt = LocalDateTime.now();
}

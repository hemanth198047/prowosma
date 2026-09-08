package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import java.time.LocalDateTime;

@Data
@Document(collection = "users")
public class User {
    @Id
    private String id;
    private String organizationId;
    private String name;
    private String email;
    private String password;
    /** When the password was last set - drives expiry policy checks at login. */
    private java.time.LocalDateTime passwordChangedAt = java.time.LocalDateTime.now();
    private String role = "USER";
    private LocalDateTime createdAt = LocalDateTime.now();

    // ── 2FA ──────────────────────────────────────────────────
    private boolean twoFactorEnabled = false;
    private String  twoFactorSecret;              // base32 TOTP secret

    // ── Session tracking ─────────────────────────────────────
    private java.util.List<LoginSession> loginSessions = new java.util.ArrayList<>();

    // ── GDPR ─────────────────────────────────────────────────
    private LocalDateTime gdprExportRequestedAt;

    /**
     * Set when this user requests deferred account deletion via
     * POST /api/security/gdpr/delete-request (as opposed to the immediate
     * self-service deletion at DELETE /api/users/me). Null means no
     * deferred deletion is pending. See
     * GdprDeletionSchedulerService for what actually acts on this.
     */
    private LocalDateTime gdprDeletionRequestedAt;

    /** When gdprDeletionScheduledFor is reached, GdprDeletionSchedulerService performs the real deletion. */
    private LocalDateTime gdprDeletionScheduledFor;
    private LocalDateTime lastLoginAt;
    private String        lastLoginIp;

    // ── Magic link / passwordless ────────────────────────────
    private String  magicLinkToken;
    private java.time.LocalDateTime magicLinkExpiry;

    // ── Social auth ───────────────────────────────────────────
    private String  authProvider = "LOCAL"; // LOCAL | GOOGLE | MICROSOFT | GITHUB
    private String  socialId;              // provider-specific user ID

    // ── Email OTP MFA ─────────────────────────────────────────
    private String  emailOtpCode;
    private java.time.LocalDateTime emailOtpExpiry;

    // ── Backup codes (MFA) ────────────────────────────────────
    private java.util.List<String> backupCodes = new java.util.ArrayList<>();  // hashed

    // ── Refresh tokens ────────────────────────────────────────
    private String  refreshToken;
    private java.time.LocalDateTime refreshTokenExpiry;

    // ── Guest / external ─────────────────────────────────────
    private boolean isGuest = false;       // true = limited external collaborator
    private String  guestToken;            // token for passwordless guest access
    private java.time.LocalDateTime guestTokenExpiry;

    // ── Fine-grained permissions ──────────────────────────────
    private java.util.List<String> permissions = new java.util.ArrayList<>();  // ["VIEW_ALL","CREATE_TASK","MANAGE_TEAM"]
    private java.util.Map<String, String> entityPermissions = new java.util.HashMap<>(); // "project:123" -> "EDITOR"

    // ── Groups ────────────────────────────────────────────────
    private java.util.List<String> groupIds = new java.util.ArrayList<>();

    // ── Language preference ───────────────────────────────────
    private String language = "en";
    private String locale   = "en-GB";

    @Data
    public static class LoginSession {
        private String id           = java.util.UUID.randomUUID().toString();
        private String ipAddress;
        private String userAgent;
        private String device;          // parsed: Chrome/Mac, Safari/iPhone, etc.
        private LocalDateTime createdAt = LocalDateTime.now();
        private LocalDateTime lastSeenAt = LocalDateTime.now();
        private boolean current = false;
    }
}
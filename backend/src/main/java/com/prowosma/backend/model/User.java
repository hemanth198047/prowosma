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
    private LocalDateTime passwordChangedAt = LocalDateTime.now();
    private String role = "USER";
    private LocalDateTime createdAt = LocalDateTime.now();

    // ── 2FA ──────────────────────────────────────────────────
    private boolean twoFactorEnabled = false;
    private String  twoFactorSecret;              // base32 TOTP secret, live/active

    /**
     * A newly-generated secret awaiting its first correct code (see
     * SecurityController /2fa/setup and /2fa/verify) — kept separate from
     * twoFactorSecret so a setup nobody finished never silently becomes
     * the active secret, and so replacing a working authenticator doesn't
     * disable 2FA in between.
     */
    private String pendingTwoFactorSecret;

    /**
     * The 30-second TOTP step (see auth.Totp) that last succeeded, at setup
     * or at login — set back to -1 whenever 2FA is disabled. Lets a
     * verifier refuse a code that was already used once (RFC 6238 section
     * 5.2), since matchStep alone would otherwise accept the same
     * intercepted code again within its ~90s validity window.
     */
    private long twoFactorLastStep = -1;

    /** Wrong second-factor codes since the last correct one — see auth.LockoutPolicy. Reset to 0 on success. */
    private int twoFactorFailedAttempts = 0;

    /** Set once twoFactorFailedAttempts hits the limit; null when not locked — see auth.LockoutPolicy. */
    private java.time.Instant twoFactorLockedUntil;

    /**
     * Set by login() once the password step succeeds for a 2FA-enabled
     * account, instead of issuing a real session token right away. Proves
     * "the password was already verified, now waiting on the OTP" without
     * needing a separate token to be passed back and forth — the
     * completeTwoFactorLogin() step just checks this hasn't expired.
     * Cleared (set null) the moment the OTP step succeeds OR expires, so
     * it's single-use and short-lived (5 minutes — see AuthService). This
     * bounds how long a *correct password* stays useful for; it's
     * deliberately NOT what limits OTP guesses — that's
     * twoFactorFailedAttempts/twoFactorLockedUntil above, which survive
     * across repeated password-verified windows (someone who already has
     * the real password could otherwise just log in again for a fresh
     * window per guess).
     */
    private LocalDateTime twoFactorPendingExpiry;

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
    private LocalDateTime magicLinkExpiry;

    // ── Social auth ───────────────────────────────────────────
    private String  authProvider = "LOCAL"; // LOCAL | GOOGLE | MICROSOFT | GITHUB
    private String  socialId;              // provider-specific user ID

    // ── Email OTP MFA ─────────────────────────────────────────
    private String  emailOtpCode;
    private LocalDateTime emailOtpExpiry;

    // ── Backup codes (MFA) ────────────────────────────────────
    private java.util.List<String> backupCodes = new java.util.ArrayList<>();  // hashed

    // ── Refresh tokens ────────────────────────────────────────
    private String  refreshToken;
    private LocalDateTime refreshTokenExpiry;

    // ── Guest / external ─────────────────────────────────────
    private boolean isGuest = false;       // true = limited external collaborator
    private String  guestToken;            // token for passwordless guest access
    private LocalDateTime guestTokenExpiry;

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
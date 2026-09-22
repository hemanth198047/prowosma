package com.prowosma.backend.service;

import com.prowosma.backend.config.JwtUtil;
import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.User;
import com.prowosma.backend.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Lazy;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import java.util.Map;
import java.util.HashMap;

@Service
@RequiredArgsConstructor
public class AuthService {

    @org.springframework.beans.factory.annotation.Autowired
    private org.springframework.core.env.Environment env;

    private final UserRepository      userRepository;
    private final com.prowosma.backend.repository.WorkspaceRepository workspaceRepository;
    private final PasswordEncoder     passwordEncoder;
    private final JwtUtil             jwtUtil;
    private final WorkspaceContext    workspaceContext;
    private final ActivityLogService  activityLogService;
    private final PasswordPolicyService passwordPolicyService;
    private final TwoFactorService    twoFactorService;
    @Lazy
    private final com.prowosma.backend.controller.SecurityController securityController;

    /** How long the password-verified/awaiting-OTP window stays open. */
    private static final long TWO_FACTOR_PENDING_MINUTES = 5;

    public Map<String, Object> register(String name, String email, String password,
                                         String ipAddress, String userAgent) {
        // A User row existing is not by itself proof someone already
        // "registered" in any way that should block this. Several other
        // paths create a User row with no usable local password — the
        // magic-link flow pre-creates one for an email that just asked for
        // a link (see AuthEnhancementsController.sendMagicLink), and SSO
        // JIT-provisions one with password "" (see loginOrCreateSsoUser).
        // Blocking register() on existsByEmail() alone turns either of
        // those into a dead end: the person is shown "email already
        // registered" for an account they never knowingly created and have
        // no password for. Only a row with a real, usable password
        // represents a genuine prior registration.
        User existing = userRepository.findByEmail(email).orElse(null);
        if (existing != null && hasUsablePassword(existing))
            throw new EmailAlreadyRegisteredException(
                    "This email is already registered. Please log in instead.");

        // No workspace exists yet at registration time, so this uses the
        // service's built-in default policy (see PasswordPolicyService).
        passwordPolicyService.validate(password, null);

        // Reuse the existing (passwordless) row rather than trying to
        // insert a second User document for the same email — claim it by
        // setting a real password on it instead.
        User user = existing != null ? existing : new User();
        user.setName(name);
        user.setEmail(email);
        user.setPassword(passwordEncoder.encode(password));
        user.setPasswordChangedAt(java.time.LocalDateTime.now());
        userRepository.save(user);
        String sessionId = safeRecordSession(user, ipAddress, userAgent);
        String token = sessionId != null ? jwtUtil.generateToken(email, sessionId) : jwtUtil.generateToken(email);
        activityLogService.logFull("SECURITY", email, email,
                "WORKSPACE_JOINED", null, email, email,
                null, null, null, ipAddress, userAgent);
        return buildResponse(user, token);
    }

    /**
     * Whether this User row represents an account someone can actually log
     * into with a password today — as opposed to a placeholder row created
     * by magic-link-request or SSO JIT-provisioning, which intentionally
     * leave password null/blank. Used to decide whether "email already
     * exists" should really mean "already registered" (register(), and the
     * accountExists flag InvitationController exposes to AcceptInvite.jsx).
     */
    public boolean hasUsablePassword(User user) {
        return user.getPassword() != null && !user.getPassword().isBlank();
    }

    // Backward-compat overload
    public Map<String, Object> register(String name, String email, String password) {
        return register(name, email, password, null, null);
    }

    public Map<String, Object> login(String email, String password,
                                      String ipAddress, String userAgent) {
        User user = userRepository.findByEmail(email).orElse(null);
        if (user == null || !passwordEncoder.matches(password, user.getPassword())) {
            // Log failed attempt
            activityLogService.logFull("SECURITY", email, email,
                    "LOGIN_FAILED", null, email, email,
                    null, null, null, ipAddress, userAgent);
            throw new InvalidCredentialsException("Invalid email or password");
        }

        // Expiry policy is workspace-configured, but no workspace is
        // selected yet at login time. Check against a workspace the user
        // owns (realistically the only place someone would have set this
        // policy for themselves) - members of someone else's workspace
        // aren't blocked here, since that workspace's own access controls
        // (invite-only membership, role checks) already gate them.
        var ownedWorkspaces = workspaceRepository.findByOwnerEmail(email);
        if (!ownedWorkspaces.isEmpty() &&
                passwordPolicyService.isExpired(user, ownedWorkspaces.get(0).getId())) {
            activityLogService.logFull("SECURITY", user.getId(), email,
                    "LOGIN_BLOCKED_PASSWORD_EXPIRED", null, null, email,
                    null, null, null, ipAddress, userAgent);
            throw new PasswordExpiredException(
                    "Your password has expired and must be reset before you can log in.");
        }

        // Password is correct, but that's not enough by itself for a 2FA
        // account — don't issue a real session token yet. Record that the
        // password step just passed (a short-lived window,
        // completeTwoFactorLogin() below checks it) and send the caller
        // back a "need the code" response instead of a token, so a leaked
        // or guessed password alone still can't produce a working session.
        if (user.isTwoFactorEnabled()) {
            user.setTwoFactorPendingExpiry(java.time.LocalDateTime.now().plusMinutes(TWO_FACTOR_PENDING_MINUTES));
            userRepository.save(user);
            activityLogService.logFull("SECURITY", user.getId(), email,
                    "LOGIN_PASSWORD_VERIFIED_2FA_PENDING", null, null, email,
                    null, null, null, ipAddress, userAgent);
            Map<String, Object> pending = new HashMap<>();
            pending.put("twoFactorRequired", true);
            pending.put("email", email);
            pending.put("message", "Enter your 6-digit authentication code");
            return pending;
        }

        String sessionId = safeRecordSession(user, ipAddress, userAgent);
        String token = sessionId != null ? jwtUtil.generateToken(email, sessionId) : jwtUtil.generateToken(email);
        activityLogService.logFull("SECURITY", user.getId(), email,
                "LOGIN_SUCCESS", null, null, email,
                null, null, null, ipAddress, userAgent);
        return buildResponse(user, token);
    }

    /**
     * Step 2 of login for a 2FA-enabled account — called with the 6-digit
     * TOTP code after login() has already returned {twoFactorRequired:
     * true} for this email. Requires that the password step actually
     * happened and hasn't expired (see twoFactorPendingExpiry on User) —
     * you can't skip straight to this with just an email and a guessed
     * code. The pending window is cleared as soon as it's used, win or
     * lose, so each password-verification only buys one OTP attempt
     * window; a failed code means logging in again from the top.
     */
    public Map<String, Object> completeTwoFactorLogin(String email, String code,
                                                        String ipAddress, String userAgent) {
        User user = userRepository.findByEmail(email).orElse(null);
        if (user == null || !user.isTwoFactorEnabled())
            throw new InvalidCredentialsException("Invalid email or code");

        boolean pendingValid = user.getTwoFactorPendingExpiry() != null
                && user.getTwoFactorPendingExpiry().isAfter(java.time.LocalDateTime.now());

        // Consume the pending window immediately (before verifying the
        // code) so it's single-use regardless of outcome — a stolen/replayed
        // code can't be retried against the same password-verified window.
        user.setTwoFactorPendingExpiry(null);
        userRepository.save(user);

        if (!pendingValid) {
            throw new InvalidCredentialsException(
                    "Your login session has expired. Please log in again.");
        }
        if (!twoFactorService.verify(user.getTwoFactorSecret(), code)) {
            activityLogService.logFull("SECURITY", user.getId(), email,
                    "LOGIN_FAILED", null, "2FA code rejected", email,
                    null, null, null, ipAddress, userAgent);
            throw new InvalidCredentialsException("Invalid authentication code");
        }

        String sessionId = safeRecordSession(user, ipAddress, userAgent);
        String token = sessionId != null ? jwtUtil.generateToken(email, sessionId) : jwtUtil.generateToken(email);
        activityLogService.logFull("SECURITY", user.getId(), email,
                "LOGIN_SUCCESS", null, null, email,
                null, null, null, ipAddress, userAgent);
        return buildResponse(user, token);
    }

    /** Records a login session and returns its id, or null if recording failed - callers fall back to a sessionless token (old behavior) rather than blocking login entirely over a tracking failure. */
    private String safeRecordSession(User user, String ipAddress, String userAgent) {
        try {
            return securityController.recordSessionForUser(user, ipAddress, userAgent, true);
        } catch (Exception e) {
            return null;
        }
    }

    /** Thrown by login() when the account's password has expired - distinct
     *  from a generic auth failure so the controller/frontend can route to
     *  a forced-reset flow instead of just "wrong password". */
    public static class PasswordExpiredException extends RuntimeException {
        public PasswordExpiredException(String message) { super(message); }
    }

    /** Thrown by login()/resetExpiredPassword() on a bad email/password
     *  combo - distinct from the generic RuntimeException handler (which
     *  maps to 500) so this maps to 401 instead. Deliberately doesn't
     *  distinguish "no such user" from "wrong password" in its message,
     *  same as before - only the status code changes. */
    public static class InvalidCredentialsException extends RuntimeException {
        public InvalidCredentialsException(String message) { super(message); }
    }

    /** Thrown by register() when the email belongs to an account that
     *  genuinely already has a usable password — see hasUsablePassword().
     *  Distinct from the generic RuntimeException handler (which maps to
     *  a sanitised 500 "unexpected error") so this maps to 409 with a
     *  real, actionable message instead. */
    public static class EmailAlreadyRegisteredException extends RuntimeException {
        public EmailAlreadyRegisteredException(String message) { super(message); }
    }

    /**
     * Resets an expired password. Doesn't require a JWT (the user can't get
     * one - that's the whole problem) - identity is proven by the old
     * password matching instead, same trust level as a normal login.
     */
    public Map<String, Object> resetExpiredPassword(String email, String oldPassword, String newPassword,
                                                      String ipAddress, String userAgent) {
        User user = userRepository.findByEmail(email)
                .orElseThrow(() -> new InvalidCredentialsException("Invalid email or password"));
        if (!passwordEncoder.matches(oldPassword, user.getPassword()))
            throw new InvalidCredentialsException("Invalid email or password");

        var ownedWorkspaces = workspaceRepository.findByOwnerEmail(email);
        String workspaceId = ownedWorkspaces.isEmpty() ? null : ownedWorkspaces.get(0).getId();
        passwordPolicyService.validate(newPassword, workspaceId);

        user.setPassword(passwordEncoder.encode(newPassword));
        user.setPasswordChangedAt(java.time.LocalDateTime.now());
        userRepository.save(user);
        activityLogService.logFull("SECURITY", user.getId(), email,
                "PASSWORD_CHANGED", null, null, email,
                null, null, null, ipAddress, userAgent);

        // Log them in immediately with the new password, same as a normal login flow.
        return login(email, newPassword, ipAddress, userAgent);
    }

    public Map<String, Object> login(String email, String password) {
        return login(email, password, null, null);
    }

    public Map<String, Object> changePassword(String email, String oldPassword,
                                               String newPassword, String ipAddress,
                                               String userAgent) {
        User user = userRepository.findByEmail(email)
                .orElseThrow(() -> new RuntimeException("User not found"));
        if (!passwordEncoder.matches(oldPassword, user.getPassword()))
            throw new RuntimeException("Current password is incorrect");
        passwordPolicyService.validate(newPassword, workspaceContext.getWorkspaceId());
        user.setPassword(passwordEncoder.encode(newPassword));
        user.setPasswordChangedAt(java.time.LocalDateTime.now());
        userRepository.save(user);
        activityLogService.logFull("SECURITY", user.getId(), email,
                "PASSWORD_CHANGED", null, null, email,
                null, null, null, ipAddress, userAgent);
        return Map.of("message", "Password changed successfully");
    }

    public User getProfile(String email) {
        return userRepository.findByEmail(email)
                .orElseThrow(() -> new RuntimeException("User not found"));
    }

    private Map<String, Object> buildResponse(User user, String token) {
        Map<String, Object> response = new HashMap<>();
        response.put("token",  token);
        response.put("id",     user.getId());
        response.put("name",   user.getName());
        response.put("email",  user.getEmail());
        response.put("role",   user.getRole());
        return response;
    }

    // ── SSO helpers (SAML 2.0 / OIDC) ────────────────────────────

    public Map<String, Object> loginOrCreateSsoUser(String email, String name) {
        // Find existing user or create one
        User user;
        try {
            user = userRepository.findByEmail(email).orElseThrow(() -> new RuntimeException("not found"));
        } catch (Exception e) {
            // User doesn't exist — auto-create with SSO flag
            user = new User();
            user.setEmail(email);
            user.setName(name != null ? name : email);
            user.setRole("MEMBER");
            user.setPassword(""); // no password for SSO users
            user = userRepository.save(user);
        }
        String sessionId = safeRecordSession(user, null, null);
        String token = sessionId != null ? jwtUtil.generateToken(email, sessionId) : jwtUtil.generateToken(email);
        return buildResponse(user, token);
    }

    public java.util.List<Map<String, String>> getConfiguredSsoProviders() {
        java.util.List<Map<String, String>> providers = new java.util.ArrayList<>();
        // Read from environment/properties to determine which providers are configured.
        // Mirrors SamlConfig's own "is this a real, usable URL" check (blank or an
        // obvious placeholder value means the provider isn't really configured yet),
        // so this list never advertises a login button that would 404/500 in SamlConfig.
        String oktaUrl   = env.getProperty("saml.idp.okta.metadata-url",   "");
        String azureUrl  = env.getProperty("saml.idp.azure.metadata-url",  "");
        String googleUrl = env.getProperty("saml.idp.google.metadata-url", "");
        String customUrl = env.getProperty("saml.idp.custom.metadata-url", "");
        String customId  = env.getProperty("saml.idp.custom.registration-id", "custom");

        if (isUsable(oktaUrl))   providers.add(Map.of("id","okta",   "label","Okta",             "loginUrl","/saml2/authenticate/okta"));
        if (isUsable(azureUrl))  providers.add(Map.of("id","azure",  "label","Microsoft Azure",  "loginUrl","/saml2/authenticate/azure"));
        if (isUsable(googleUrl)) providers.add(Map.of("id","google", "label","Google Workspace", "loginUrl","/saml2/authenticate/google"));
        if (isUsable(customUrl)) providers.add(Map.of("id",customId,"label","Company SSO",       "loginUrl","/saml2/authenticate/"+customId));
        return providers;
    }

    /** Same "blank or placeholder" definition of "not really configured" as SamlConfig.tryRegister. */
    private boolean isUsable(String url) {
        if (url == null || url.isBlank()) return false;
        return !url.contains("xxxx") && !url.contains("TENANT")
            && !url.contains("REAL")  && !url.contains("example");
    }

}

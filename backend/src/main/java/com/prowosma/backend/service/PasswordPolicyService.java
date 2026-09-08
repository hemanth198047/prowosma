package com.prowosma.backend.service;

import com.prowosma.backend.model.User;
import com.prowosma.backend.model.WorkspaceConfig;
import com.prowosma.backend.repository.WorkspaceConfigRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * PasswordPolicyService — real complexity and expiry enforcement.
 *
 * Complexity is checked at registration and at every password change.
 * Expiry is checked at login (see AuthService.login).
 *
 * Registration happens before any workspace exists, so it always uses the
 * built-in default policy below. Once a workspace exists, an Admin/Owner
 * can tighten it (see WorkspaceConfig's password* fields, configured via
 * AdminController) and that stricter policy applies to password changes
 * and expiry checks from then on.
 */
@Service
@RequiredArgsConstructor
public class PasswordPolicyService {

    private final WorkspaceConfigRepository workspaceConfigRepository;

    private static final Pattern UPPER = Pattern.compile("[A-Z]");
    private static final Pattern LOWER = Pattern.compile("[a-z]");
    private static final Pattern DIGIT = Pattern.compile("[0-9]");
    private static final Pattern SPECIAL = Pattern.compile("[^A-Za-z0-9]");

    /** Sensible defaults used whenever no workspace-specific policy applies (e.g. registration). */
    private static final int DEFAULT_MIN_LENGTH = 8;

    public static class PasswordPolicyException extends RuntimeException {
        public PasswordPolicyException(String message) { super(message); }
    }

    /** Validates a password against the given workspace's policy (or the default policy if workspaceId is null). Throws with a clear, complete list of what's missing. */
    public void validate(String password, String workspaceId) {
        Effective policy = resolve(workspaceId);
        List<String> problems = new ArrayList<>();

        if (password == null || password.length() < policy.minLength) {
            problems.add("at least " + policy.minLength + " characters");
        }
        if (policy.requireUppercase && (password == null || !UPPER.matcher(password).find())) {
            problems.add("an uppercase letter");
        }
        if (policy.requireLowercase && (password == null || !LOWER.matcher(password).find())) {
            problems.add("a lowercase letter");
        }
        if (policy.requireNumber && (password == null || !DIGIT.matcher(password).find())) {
            problems.add("a number");
        }
        if (policy.requireSpecial && (password == null || !SPECIAL.matcher(password).find())) {
            problems.add("a special character");
        }

        if (!problems.isEmpty()) {
            throw new PasswordPolicyException("Password must include " + String.join(", ", problems) + ".");
        }
    }

    /** True if this user's password has passed the workspace's expiry window. */
    public boolean isExpired(User user, String workspaceId) {
        Effective policy = resolve(workspaceId);
        if (policy.expiryDays <= 0) return false;
        LocalDateTime changedAt = user.getPasswordChangedAt();
        if (changedAt == null) return false; // unknown - don't lock someone out over missing historical data
        return ChronoUnit.DAYS.between(changedAt, LocalDateTime.now()) >= policy.expiryDays;
    }

    /** Human-readable summary of the effective policy, for the frontend to show as a hint. */
    public String describe(String workspaceId) {
        Effective p = resolve(workspaceId);
        List<String> parts = new ArrayList<>();
        parts.add("at least " + p.minLength + " characters");
        if (p.requireUppercase) parts.add("an uppercase letter");
        if (p.requireLowercase) parts.add("a lowercase letter");
        if (p.requireNumber) parts.add("a number");
        if (p.requireSpecial) parts.add("a special character");
        return "Password must include " + String.join(", ", parts) + ".";
    }

    private record Effective(int minLength, boolean requireUppercase, boolean requireLowercase,
                              boolean requireNumber, boolean requireSpecial, int expiryDays) {}

    private Effective resolve(String workspaceId) {
        if (workspaceId == null) {
            return new Effective(DEFAULT_MIN_LENGTH, true, true, true, false, 0);
        }
        WorkspaceConfig cfg = workspaceConfigRepository.findByWorkspaceId(workspaceId).orElse(null);
        if (cfg == null) {
            return new Effective(DEFAULT_MIN_LENGTH, true, true, true, false, 0);
        }
        return new Effective(
                Math.max(cfg.getPasswordMinLength(), 6), // never allow configuring below a hard floor
                cfg.isPasswordRequireUppercase(),
                cfg.isPasswordRequireLowercase(),
                cfg.isPasswordRequireNumber(),
                cfg.isPasswordRequireSpecial(),
                cfg.getPasswordExpiryDays()
        );
    }
}

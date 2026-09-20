package com.prowosma.backend.config.tenant;

/**
 * How the guard reacts to a cross-tenant access.
 *
 * <ul>
 *   <li>{@code ENFORCE} (default) — deny it: reads return "not found", deletes
 *       are ignored, overwrites throw {@link TenantViolationException}.</li>
 *   <li>{@code LOG} — report it (WARN) but let it through. For rolling the guard
 *       out against real traffic before enforcing it.</li>
 *   <li>{@code OFF} — the guard is not installed at all.</li>
 * </ul>
 * Set with {@code app.tenant-guard.mode} (env {@code TENANT_GUARD_MODE}).
 * An unrecognised value means ENFORCE: a typo must never silently disable protection.
 */
public enum TenantGuardMode {
    ENFORCE, LOG, OFF;

    public static TenantGuardMode parse(String value) {
        if (value == null || value.isBlank()) return ENFORCE;
        switch (value.trim().toLowerCase()) {
            case "off": case "false": case "disabled": case "none":
                return OFF;
            case "log": case "warn": case "audit": case "shadow": case "report":
                return LOG;
            default:
                return ENFORCE;
        }
    }
}

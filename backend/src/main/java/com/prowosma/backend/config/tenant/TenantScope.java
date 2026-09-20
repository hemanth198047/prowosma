package com.prowosma.backend.config.tenant;

/**
 * What the tenant guard should do for the call currently being made.
 *
 * <ul>
 *   <li>{@link #skip()} — not a tenant-scoped API request (a scheduler, an
 *       async job, a WebSocket frame, the login/SSO/invitation/webhook paths,
 *       an unauthenticated request...). Nothing is filtered.</li>
 *   <li>{@link #enforced(String)} — an authenticated {@code /api/**} request.
 *       Records belonging to another workspace must be invisible.
 *       {@code tenantId} is the workspace from {@code X-Workspace-Id} (or the
 *       API key) and is {@code null} when the caller selected none, in which
 *       case only un-owned (legacy) records are visible.</li>
 * </ul>
 */
public final class TenantScope {

    private static final TenantScope SKIP = new TenantScope(false, null);

    private final boolean enforced;
    private final String tenantId;

    private TenantScope(boolean enforced, String tenantId) {
        this.enforced = enforced;
        this.tenantId = tenantId;
    }

    public static TenantScope skip() {
        return SKIP;
    }

    public static TenantScope enforced(String tenantId) {
        return new TenantScope(true, (tenantId == null || tenantId.isBlank()) ? null : tenantId);
    }

    public boolean isEnforced() {
        return enforced;
    }

    /** The caller's workspace, or {@code null} if none was selected. */
    public String tenantId() {
        return tenantId;
    }

    /**
     * May the caller see a record owned by {@code entityTenantId}?
     *
     * Records with no owner at all (created before multi-tenancy) stay
     * reachable exactly as before rather than becoming unreachable for
     * everyone; every record that <em>has</em> an owner must match.
     */
    public boolean permits(String entityTenantId) {
        if (!enforced) return true;
        if (entityTenantId == null || entityTenantId.isBlank()) return true;
        return entityTenantId.equals(tenantId);
    }

    @Override
    public String toString() {
        return enforced ? "TenantScope[enforced, tenant=" + tenantId + "]" : "TenantScope[skip]";
    }
}

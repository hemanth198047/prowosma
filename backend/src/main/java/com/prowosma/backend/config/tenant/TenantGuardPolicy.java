package com.prowosma.backend.config.tenant;

import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.List;
import java.util.Set;
import java.util.function.Supplier;

/** The static rules of the tenant guard: where it applies and to what. */
public final class TenantGuardPolicy {

    private TenantGuardPolicy() {}

    /**
     * Entities that are NOT owned by a workspace even though they carry a
     * tenant-looking field: {@code Workspace} is the tenant itself (its own id),
     * and {@code User} is a global identity that can belong to many workspaces.
     * Access to both is authorised by membership checks instead.
     */
    public static final Set<String> EXEMPT_ENTITIES = Set.of("User", "Workspace");

    /**
     * {@code /api/**} paths that establish identity or serve system-to-system
     * callbacks. They legitimately touch records of workspaces the caller has no
     * header for (accepting an invitation, SSO login, Stripe/email callbacks), so
     * the guard stays out of their way. Everything else under {@code /api/} is
     * tenant-scoped.
     */
    private static final List<String> TENANTLESS_PREFIXES = List.of(
            "/api/auth/",
            "/api/sso/",
            "/api/invitations/accept",
            "/api/invitations/info",
            "/api/invitations/validate/",
            "/api/webhooks/stripe",
            "/api/webhooks/email/",
            "/api/inbound-events/",
            "/api/health"
    );

    /** Should the guard filter data for a request to this path? */
    public static boolean isEnforcedPath(String path) {
        if (path == null || !path.startsWith("/api/")) return false;
        // Ambiguous paths are never allowed to *earn* an exemption: a request
        // like /api/auth/..;/tasks must not be treated as a login request.
        if (path.contains("..") || path.contains(";") || path.contains("//")) return true;
        for (String prefix : TENANTLESS_PREFIXES) {
            if (path.startsWith(prefix)) return false;
        }
        return true;
    }

    /**
     * The scope for the current call, given what is known about it.
     *
     * The guard engages only for an authenticated HTTP request to a tenant-scoped
     * path. Anything else (a scheduler, async work, a WebSocket frame, an
     * unauthenticated or login/SSO/callback request) is left alone. Reading the
     * workspace can fail when the request scope is not active; that also means
     * "not a request" and leaves the call alone.
     */
    public static TenantScope scopeFor(boolean inHttpRequest, String path, boolean authenticated,
                                       Supplier<String> workspaceId) {
        if (!inHttpRequest || !authenticated || !isEnforcedPath(path)) return TenantScope.skip();
        final String workspace;
        try {
            workspace = workspaceId.get();
        } catch (RuntimeException requestScopeNotActive) {
            return TenantScope.skip();
        }
        return TenantScope.enforced(workspace);
    }

    /** {@code getOrganizationId()} or {@code getWorkspaceId()}, whichever the entity has; else null. */
    public static Method tenantGetter(Class<?> entity) {
        Method m = publicNoArg(entity, "getOrganizationId");
        return m != null ? m : publicNoArg(entity, "getWorkspaceId");
    }

    public static Method idGetter(Class<?> entity) {
        return publicNoArg(entity, "getId");
    }

    private static Method publicNoArg(Class<?> type, String name) {
        try {
            Method m = type.getMethod(name);
            return Modifier.isStatic(m.getModifiers()) || m.getReturnType() == void.class ? null : m;
        } catch (NoSuchMethodException e) {
            return null;
        }
    }
}

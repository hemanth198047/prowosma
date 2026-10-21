package com.prowosma.backend.access;

import java.util.List;
import java.util.Locale;

/**
 * Default-deny API allowlist for restricted callers.
 *
 * Phase 1 of the department access model scopes projects and tasks (and the live feed). The many
 * aggregate endpoints (dashboard, search, reports, analytics, Gantt, AI, activity log, notifications,
 * docs, meetings ...) have NOT been ported yet and would each reveal other departments' work. Rather
 * than hope nothing leaks, a restricted caller may only reach what is listed here; every other
 * /api path is refused until it is deliberately scoped and added to the list.
 *
 * Unrestricted callers (workspace owner, ALL profile, access control off) are never affected.
 */
public final class AccessGatePolicy {
    private AccessGatePolicy() {}

    /** Any HTTP method. */
    private static final List<String> ANY_METHOD = List.of(
            "/api/access/me",
            "/api/access/options",
            "/api/projects",
            "/api/tasks",
            "/api/auth",
            "/api/users/me",
            "/api/health",
            "/api/invitations/accept",
            "/api/team/presence");

    /** Read-only reference data the project and task screens need. */
    private static final List<String> GET_ONLY = List.of(
            "/api/team",
            "/api/categories",
            "/api/custom-fields");

    /** Exactly this path, no sub-paths (the workspace list; its sub-resources hold workspace-wide data). */
    private static final List<String> GET_EXACT = List.of("/api/workspaces");

    /** Project sub-paths that expose money; they need the VIEW_FINANCIALS capability. */
    private static final List<String> FINANCIAL_SEGMENTS = List.of("expenses", "budget", "revenue", "roi", "roi-settings");

    public static boolean isAllowed(String path, String method, AccessScope scope) {
        if (scope == null || !scope.isRestricted()) return true;
        if (path == null || !path.startsWith("/api/")) return true; // not an API path (websocket handshake, swagger ...)
        if (isAmbiguous(path)) return false;
        String m = method == null ? "GET" : method.toUpperCase(Locale.ROOT);
        if (m.equals("OPTIONS")) return true;

        boolean listed = matchesAny(path, ANY_METHOD) || (m.equals("GET") && (matchesAny(path, GET_ONLY) || GET_EXACT.contains(stripTrailingSlash(path))));
        if (!listed) return false;

        if (matchesPrefix(path, "/api/projects") && !scope.has(AccessConstants.CAP_VIEW_FINANCIALS)) {
            for (String seg : path.substring("/api/projects".length()).split("/")) {
                if (FINANCIAL_SEGMENTS.contains(seg.toLowerCase(Locale.ROOT))) return false;
            }
        }
        return true;
    }

    private static String stripTrailingSlash(String path) {
        return path.length() > 1 && path.endsWith("/") ? path.substring(0, path.length() - 1) : path;
    }

    private static boolean isAmbiguous(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        return p.contains("..") || p.contains(";") || p.contains("//") || p.contains("%2e") || p.contains("%2f") || p.contains("%5c") || p.contains("\\");
    }

    private static boolean matchesAny(String path, List<String> prefixes) {
        for (String p : prefixes) if (matchesPrefix(path, p)) return true;
        return false;
    }

    /** Segment-aware: "/api/tasks" matches "/api/tasks" and "/api/tasks/x", not "/api/tasksX". */
    static boolean matchesPrefix(String path, String prefix) {
        if (!path.startsWith(prefix)) return false;
        return path.length() == prefix.length() || path.charAt(prefix.length()) == '/';
    }
}

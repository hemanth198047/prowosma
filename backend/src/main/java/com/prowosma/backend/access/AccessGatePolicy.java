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
            "/api/notifications",
            "/api/docs",
            // planning and reporting areas (each one scoped to what the person may see; see docs/DEPARTMENT_ACCESS.md)
            "/api/goals",
            "/api/sprints",
            "/api/epics",
            "/api/releases",
            "/api/raid",
            "/api/changes",
            "/api/decisions",
            "/api/channels",
            "/api/initiatives",
            "/api/programmes",
            "/api/standup",
            "/api/sops",
            "/api/reports",
            "/api/analytics",
            "/api/ai",
            "/api/time/report",
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
            "/api/custom-fields",
            "/api/search",
            "/api/gantt",
            "/api/activity-logs");

    /** Exactly this path, no sub-paths (the workspace list; its sub-resources hold workspace-wide data). */
    private static final List<String> GET_EXACT = List.of("/api/workspaces", "/api/dashboard/summary");

    /**
     * The meeting assistant (Fireflies, uploads, recordings, action extraction). Needs the USE_MEETING_ASSISTANT
     * capability. Its sessions are private to their owner and whoever they share them with.
     */
    private static final String MEETING_ASSISTANT = "/api/meeting-assistant";

    /**
     * Inside otherwise-allowed areas, these stay closed to restricted callers:
     *  - Fireflies "recent" / "import" list and import the connected Fireflies ACCOUNT's meetings, which belong to the whole company;
     *  - the activity log's CSV export, integrity check and workspace summary are workspace-wide.
     */
    private static final List<String> ALWAYS_DENIED = List.of(
            "/api/meeting-assistant/fireflies/recent",
            "/api/meeting-assistant/fireflies/import",
            "/api/notifications/announce",       // an announcement goes to the whole workspace
            "/api/activity-logs/export",
            "/api/activity-logs/verify-integrity",
            "/api/activity-logs/summary");

    /** Moving a task's dates on the Gantt chart (the task itself is checked by the server). */
    private static boolean isGanttDatePatch(String path, String method) {
        return method.equals("PATCH") && path.matches("^/api/gantt/tasks/[^/]+/dates$");
    }

    /** Project sub-paths that expose money; they need the VIEW_FINANCIALS capability. */
    /** Prefixes whose WRITES (anything but GET) need the planning capability; the server also checks each record. */
    private static final List<String> PLANNING_WRITES = List.of(
            "/api/goals", "/api/sprints", "/api/epics", "/api/releases", "/api/raid", "/api/changes", "/api/decisions",
            "/api/initiatives", "/api/programmes", "/api/sops");

    private static final List<String> FINANCIAL_SEGMENTS = List.of("expenses", "budget", "revenue", "roi", "roi-settings");

    public static boolean isAllowed(String path, String method, AccessScope scope) {
        if (scope == null || !scope.isRestricted()) return true;
        if (path == null || !path.startsWith("/api/")) return true; // not an API path (websocket handshake, swagger ...)
        if (isAmbiguous(path)) return false;
        String m = method == null ? "GET" : method.toUpperCase(Locale.ROOT);
        if (m.equals("OPTIONS")) return true;

        if (!m.equals("GET") && matchesAny(path, PLANNING_WRITES) && !scope.has(AccessConstants.CAP_MANAGE_PLANNING)) return false;
        for (String denied : ALWAYS_DENIED) if (matchesPrefix(path, denied)) return false;

        boolean meeting = matchesPrefix(path, MEETING_ASSISTANT) && scope.has(AccessConstants.CAP_USE_MEETING_ASSISTANT);
        boolean listed = meeting || isGanttDatePatch(path, m) || matchesAny(path, ANY_METHOD) || (m.equals("GET") && (matchesAny(path, GET_ONLY) || GET_EXACT.contains(stripTrailingSlash(path))));
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

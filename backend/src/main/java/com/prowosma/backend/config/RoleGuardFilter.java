package com.prowosma.backend.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.model.TeamMember;
import com.prowosma.backend.model.Workspace;
import com.prowosma.backend.repository.TeamMemberRepository;
import com.prowosma.backend.repository.WorkspaceRepository;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.core.annotation.Order;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Component
@Order(3)
@RequiredArgsConstructor
public class RoleGuardFilter extends OncePerRequestFilter {

    private final TeamMemberRepository teamMemberRepository;
    private final WorkspaceRepository workspaceRepository;
    private final WorkspaceContext workspaceContext;
    private final ObjectMapper objectMapper;

    // Paths that skip role checking entirely
    private static final List<String> SKIP_PATHS = List.of(
            "/api/auth/",
            "/api/invitations/accept",
            "/api/tasks/attachments/",
            "/api/webhooks/",
            "/swagger-ui",
            "/v3/api-docs",
            "/favicon.ico"
    );

    // Governance/administration endpoints — require ADMIN or OWNER for BOTH
    // reads and writes. Everything else in this filter only restricted
    // *writes*; GET requests to these paths were being let through to any
    // authenticated Member (even Viewers, in effect) with no role check at
    // all — e.g. anyone could read /api/admin/email-settings or
    // /api/security/sessions/all (every user's active sessions, workspace-
    // wide). Those are the two concrete cases this closes; anything else
    // added under /api/admin/ or /api/security/ automatically inherits the
    // same protection.
    private static final List<String> ADMIN_ONLY_PATHS = List.of(
            "/api/admin/",
            "/api/security/sessions/all",
            "/api/security/stats"
    );

    private boolean isAdminOnlyPath(String path) {
        return ADMIN_ONLY_PATHS.stream().anyMatch(path::contains);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain chain)
            throws ServletException, IOException {

        String method = request.getMethod();
        String path   = request.getRequestURI();

        // Skip OPTIONS (CORS preflight) unconditionally, and GET requests
        // EXCEPT to admin-only governance endpoints, which need a role
        // check even for reads.
        if ("OPTIONS".equals(method)) {
            chain.doFilter(request, response); return;
        }
        if ("GET".equals(method) && !isAdminOnlyPath(path)) {
            chain.doFilter(request, response); return;
        }

        // Allow PATCH on goal/task SUB-RESOURCES for all authenticated users
        // (progress bars, checklist/step toggles, confidence, SLA, etc.) -
        // these are narrow, low-risk updates every role can reasonably make.
        //
        // Deliberately excludes the bare /api/tasks/{id} endpoint: that one
        // does a full field-level edit (title, project, assignees, tags,
        // description, type, severity, custom fields - the inline-editable
        // table and quick-view drawer both use it) and must go through the
        // normal role check below like any other edit, so a Viewer can't
        // use it to bypass their read-only restriction.
        boolean isBareTaskPatch = path.matches(".*/api/tasks/[^/]+$");
        if ("PATCH".equals(method) &&
                ((path.contains("/api/goals/")) ||
                        (path.contains("/api/tasks/") && !isBareTaskPatch))) {
            chain.doFilter(request, response); return;
        }

        // Skip public paths
        for (String skip : SKIP_PATHS) {
            if (path.contains(skip)) {
                chain.doFilter(request, response); return;
            }
        }

        // Get authenticated user
        var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated() ||
                "anonymousUser".equals(auth.getPrincipal())) {
            chain.doFilter(request, response); return;
        }

        String email       = auth.getName();
        String workspaceId = workspaceContext.getWorkspaceId();

        // Resolve role — OWNER check first (workspace owner is always OWNER
        // even if they don't have a TeamMember record)
        String role = resolveRole(email, workspaceId);

        // ── Not a member of this workspace at all → deny outright ─────────
        // Defense-in-depth: WorkspaceFilter (runs before this one) already
        // rejects a non-member's request before it gets here, so in normal
        // operation this branch should be unreachable. It stays as a second
        // independent check so a bug/bypass in WorkspaceFilter can't silently
        // fall through to resolveRole()'s old behavior of treating "not a
        // member" the same as "MEMBER".
        if ("NONE".equals(role)) {
            sendForbidden(response,
                    "You are not a member of this workspace.");
            return;
        }

        // ── OWNER bypass: owners can do anything ──────────────────────────
        if ("OWNER".equals(role)) {
            chain.doFilter(request, response); return;
        }

        // ── /api/users/** requires OWNER only ────────────────────────────
        // (self-delete /api/users/me is allowed for anyone authenticated)
        if (path.contains("/api/users/admin/")) {
            sendForbidden(response,
                    "Only the workspace Manager can delete user accounts.");
            return;
        }

        // ── Admin-only governance endpoints require ADMIN or OWNER,
        // including reads (see ADMIN_ONLY_PATHS javadoc above) ────────────
        if (isAdminOnlyPath(path) && !isAdminOrOwner(role)) {
            sendForbidden(response,
                    "Only Admins and the workspace Manager can access workspace administration settings.");
            return;
        }

        // ── VIEWER cannot mutate anything ─────────────────────────────────
        if ("VIEWER".equals(role)) {
            sendForbidden(response,
                    "Viewers have read-only access. " +
                            "Contact your workspace admin to change your role.");
            return;
        }

        // ── Presence/ping is allowed for ALL roles ────────────────────────
        if (path.contains("/presence/ping") || path.contains("/presence/")) {
            chain.doFilter(request, response);
            return;
        }

        // ── Team member management requires ADMIN or OWNER ────────────────
        // MEMBER role cannot add/edit/delete team members
        if (path.contains("/api/team") &&
                ("POST".equals(method) || "PUT".equals(method) ||
                        "DELETE".equals(method)) &&
                !isAdminOrOwner(role)) {
            sendForbidden(response,
                    "Only Admins and the workspace Manager can manage team members.");
            return;
        }

        // ── Settings/invitations endpoints require ADMIN or OWNER ─────────
        if (isSettingsPath(path, method) && !isAdminOrOwner(role)) {
            sendForbidden(response,
                    "Only Admins and the workspace Manager can modify workspace settings.");
            return;
        }

        // ── Workspace DELETE requires OWNER only ──────────────────────────
        if ("DELETE".equals(method) &&
                path.matches("/api/workspaces/[^/]+$")) {
            sendForbidden(response,
                    "Only the workspace Manager can delete a workspace.");
            return;
        }

        chain.doFilter(request, response);
    }

    private String resolveRole(String email, String workspaceId) {
        // Always check owner first
        if (workspaceId != null) {
            Optional<Workspace> ws = workspaceRepository.findById(workspaceId);
            if (ws.isPresent() && email.equals(ws.get().getOwnerEmail())) {
                return "OWNER";
            }
            // Look up TeamMember role within this workspace. No record here
            // (and not the owner, checked above) means this user has no
            // relationship to this workspace at all — "NONE", not "MEMBER".
            // findAllBy (not the Optional-returning findBy) deliberately —
            // see TeamMemberRepository for why duplicate rows must not 500
            // this lookup.
            return teamMemberRepository
                    .findAllByEmailAndOrganizationId(email, workspaceId)
                    .stream()
                    .findFirst()
                    .map(TeamMember::getRole)
                    .orElse("NONE");
        }
        // No workspace header — check if owner of any workspace
        boolean isAnyOwner = workspaceRepository
                .findByOwnerEmail(email).size() > 0;
        return isAnyOwner ? "OWNER" : "MEMBER";
    }

    private boolean isSettingsPath(String path, String method) {
        // Allow anyone to CREATE a new workspace (POST /api/workspaces)
        // Only restrict UPDATE and DELETE on existing workspaces
        if (path.equals("/api/workspaces") && "POST".equals(method)) {
            return false;
        }
        return path.contains("/api/workspaces") ||
                path.contains("/api/invitations") ||
                path.contains("/api/billing");
    }

    private boolean isAdminOrOwner(String role) {
        return "ADMIN".equals(role) || "OWNER".equals(role);
    }

    private void sendForbidden(HttpServletResponse response, String message)
            throws IOException {
        response.setStatus(HttpServletResponse.SC_FORBIDDEN);
        response.setContentType("application/json");
        response.getWriter().write(
                objectMapper.writeValueAsString(Map.of(
                        "error", "FORBIDDEN",
                        "message", message
                ))
        );
    }
}
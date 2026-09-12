package com.prowosma.backend.config;

import com.fasterxml.jackson.databind.ObjectMapper;
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

/**
 * Filter that reads the X-Workspace-Id header from every incoming request
 * and stores it in the WorkspaceContext for use by services.
 *
 * Run AFTER JwtFilter (order 2).
 *
 * SECURITY: this is also the ONLY place that verifies the authenticated
 * user actually belongs to the workspace named in the header, before
 * anything downstream trusts WorkspaceContext.getWorkspaceId() to scope a
 * query. Previously this filter copied the header value in unconditionally,
 * and two things downstream made that exploitable rather than just sloppy:
 *   1. Every data-access service (TaskService, ProjectService, GoalService,
 *      NotificationService, ...) queries strictly by
 *      workspaceContext.getWorkspaceId() with no membership check of its own.
 *   2. RoleGuardFilter skips its role check entirely for GET requests (except
 *      a couple of admin-only paths), and on writes its resolveRole() fell
 *      back to "MEMBER" for a user with no TeamMember record in that
 *      workspace, instead of denying them.
 * Net effect: any authenticated user could read or write ANY other
 * workspace's data just by sending its (guessable/enumerable) ID in
 * X-Workspace-Id — a full tenant-isolation bypass. Fixing it here, in front
 * of both of those, closes it in one place instead of needing a matching
 * fix in every one of the ~20 services that trust WorkspaceContext today.
 *
 * SKIP_PATHS below mirrors RoleGuardFilter's own skip list (which already
 * excludes /api/auth/ and /api/invitations/accept for the same reason) —
 * but this filter runs one step earlier (Order 2 vs 3), so without the
 * same exclusion here, this filter's stricter membership check rejects the
 * request before RoleGuardFilter's more lenient one ever runs. Concretely:
 * localStorage's "activeWorkspace" is shared across every tab in a browser
 * and only cleared on explicit logout, so a browser that still has an
 * unrelated earlier session's workspace ID sitting in localStorage will
 * have it auto-attached (see frontend/src/api/client.js) to EVERY request
 * from a fresh tab — including a brand-new user's POST
 * /api/invitations/accept. That request would get rejected here with "You
 * are not a member of this workspace", even though granting that exact
 * membership is the entire point of the endpoint being called — and even
 * though the endpoint never actually trusts X-Workspace-Id for anything;
 * InvitationService.accept() resolves the workspace from the invitation
 * token itself, so skipping the header check here for these paths is safe,
 * not a scoping bypass.
 */
@Component
@Order(2)
@RequiredArgsConstructor
public class WorkspaceFilter extends OncePerRequestFilter {

    private final WorkspaceContext workspaceContext;
    private final WorkspaceRepository workspaceRepository;
    private final TeamMemberRepository teamMemberRepository;
    private final ObjectMapper objectMapper;

    private static final List<String> SKIP_PATHS = List.of(
            "/api/auth/",
            "/api/invitations/accept",
            "/api/invitations/validate/",
            "/api/invitations/info"
    );

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain)
            throws ServletException, IOException {

        String path = request.getRequestURI();
        for (String skip : SKIP_PATHS) {
            if (path.contains(skip)) {
                filterChain.doFilter(request, response);
                return;
            }
        }

        String workspaceId = request.getHeader("X-Workspace-Id");
        if (workspaceId != null && !workspaceId.isBlank()) {

            var auth = SecurityContextHolder.getContext().getAuthentication();
            boolean authenticated = auth != null && auth.isAuthenticated()
                    && !"anonymousUser".equals(auth.getPrincipal());

            // Only enforce membership once we know who's asking. JwtFilter
            // (which runs before this, via the Spring Security chain) has
            // already rejected an invalid/missing token by leaving the
            // SecurityContext unauthenticated — that's authentication's job,
            // not this filter's. This filter's job is: given a real,
            // authenticated user, is this workspace actually theirs to see?
            if (authenticated && !isOwnerOrMember(auth.getName(), workspaceId)) {
                sendForbidden(response,
                        "You are not a member of this workspace.");
                return;
            }

            workspaceContext.setWorkspaceId(workspaceId);
        }
        filterChain.doFilter(request, response);
    }

    /** Same "owner OR TeamMember" definition RoleGuardFilter.resolveRole uses for OWNER — reused, not reinvented, so the two checks can't drift apart. */
    private boolean isOwnerOrMember(String email, String workspaceId) {
        boolean isOwner = workspaceRepository.findById(workspaceId)
                .map(ws -> email.equals(ws.getOwnerEmail()))
                .orElse(false);
        if (isOwner) return true;

        return teamMemberRepository
                .existsByEmailAndOrganizationId(email, workspaceId);
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
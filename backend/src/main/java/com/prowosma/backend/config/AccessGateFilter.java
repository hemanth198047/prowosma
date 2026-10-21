package com.prowosma.backend.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.access.AccessGatePolicy;
import com.prowosma.backend.access.AccessScope;
import com.prowosma.backend.service.VisibilityService;
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
import java.util.Map;

/**
 * Default-deny for restricted callers (see {@link AccessGatePolicy}). Runs after the workspace and
 * role filters, so the workspace is verified and the caller is a real member before a scope is built.
 * Callers that are not restricted (owner, ALL profile, access control off, no profile yet) pass straight
 * through, as do requests with no authenticated user (login, webhooks, health).
 */
@Component
@Order(4)
@RequiredArgsConstructor
public class AccessGateFilter extends OncePerRequestFilter {

    private final VisibilityService visibility;
    private final ObjectMapper objectMapper;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String path = request.getRequestURI();
        var auth = SecurityContextHolder.getContext().getAuthentication();
        boolean authenticated = auth != null && auth.isAuthenticated() && !"anonymousUser".equals(auth.getPrincipal());
        if (!authenticated || path == null || !path.startsWith("/api/")) { chain.doFilter(request, response); return; }

        AccessScope scope = visibility.current();
        if (AccessGatePolicy.isAllowed(path, request.getMethod(), scope)) { chain.doFilter(request, response); return; }

        response.setStatus(HttpServletResponse.SC_FORBIDDEN);
        response.setContentType("application/json");
        response.getWriter().write(objectMapper.writeValueAsString(Map.of(
                "error", "ACCESS_RESTRICTED",
                "message", "Your access level doesn't include this area.")));
    }
}

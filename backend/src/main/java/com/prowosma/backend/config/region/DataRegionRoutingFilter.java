package com.prowosma.backend.config.region;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.repository.WorkspaceRepository;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Sets RegionContext for the duration of a request, based on the current
 * workspace's declared dataRegion — the piece that makes
 * RegionRoutingMongoDatabaseFactory's routing decisions automatic rather
 * than something every call site has to set manually.
 *
 * Runs at @Order(5) — after WorkspaceFilter (2), RoleGuardFilter (3), and
 * PlanGuardFilter (4), so workspaceContext.getWorkspaceId() is reliably
 * populated by the time this runs. Looks the workspace up via the
 * ordinary (unrouted/home) WorkspaceRepository — Workspace records
 * themselves always live in the home database regardless of the
 * workspace's declared data region, which is the standard "control plane
 * vs. tenant data" split for this kind of routing (you can't know which
 * database to route to without first reading a record that tells you —
 * that record has to live somewhere always-reachable). See
 * docs/DATA_RESIDENCY.md.
 */
@Component
@Order(5)
@RequiredArgsConstructor
public class DataRegionRoutingFilter extends OncePerRequestFilter {

    private final WorkspaceContext workspaceContext;
    private final WorkspaceRepository workspaceRepository;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                     FilterChain chain) throws ServletException, IOException {
        try {
            String workspaceId = workspaceContext.getWorkspaceId();
            if (workspaceId != null) {
                workspaceRepository.findById(workspaceId).ifPresent(ws -> {
                    String region = ws.getDataRegion();
                    if (region != null && !"UNSET".equals(region)) {
                        RegionContext.set(region);
                    }
                });
            }
            chain.doFilter(request, response);
        } finally {
            // Always clear — this is a ThreadLocal and servlet containers
            // reuse threads across requests, so leaving a stale value set
            // would leak one request's region into a later, unrelated
            // request on the same worker thread.
            RegionContext.clear();
        }
    }
}

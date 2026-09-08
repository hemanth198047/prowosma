package com.prowosma.backend.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.service.BillingService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;
import java.util.Map;

/**
 * PlanGuardFilter — enforces plan-tier feature gates.
 *
 * Before this filter existed, every feature was available on every plan
 * regardless of what the workspace was actually paying for — the pricing
 * page was purely cosmetic. This is the server-side gate that makes plan
 * tiers real, in the same style as RoleGuardFilter enforces roles.
 *
 * Runs after RoleGuardFilter (which handles role checks) so a request only
 * reaches here once we know the user is allowed to perform this *kind* of
 * action — this filter only asks "does the workspace's plan include this
 * feature at all".
 */
@Component
@Order(4)
@RequiredArgsConstructor
public class PlanGuardFilter extends OncePerRequestFilter {

    private final BillingService billingService;
    private final WorkspaceContext workspaceContext;
    private final ObjectMapper objectMapper;

    private static final List<String> SKIP_PATHS = List.of(
            "/api/auth/",
            "/api/billing",
            "/api/webhooks/",
            "/swagger-ui",
            "/v3/api-docs",
            "/favicon.ico"
    );

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                     HttpServletResponse response,
                                     FilterChain chain) throws ServletException, IOException {

        String method = request.getMethod();
        String path = request.getRequestURI();

        if ("GET".equals(method) || "OPTIONS".equals(method)) {
            chain.doFilter(request, response);
            return;
        }

        for (String skip : SKIP_PATHS) {
            if (path.contains(skip)) {
                chain.doFilter(request, response);
                return;
            }
        }

        String workspaceId = workspaceContext.getWorkspaceId();
        if (workspaceId == null) {
            chain.doFilter(request, response);
            return;
        }

        // SCIM user provisioning — Business/Enterprise only
        if (path.startsWith("/scim/v2") && !billingService.isFeatureEnabled(workspaceId, "scim")) {
            sendUpgradeRequired(response,
                    "SCIM provisioning is available on the Business and Enterprise plans. Upgrade to enable it.");
            return;
        }

        // White-label branding — Business/Enterprise only.
        // Matches the real endpoint (BrandingController: PUT /api/workspaces/branding,
        // operates on the active workspace, no {id} segment) and also the old
        // {id}-scoped shape in case it's ever reintroduced — so there's no
        // repeat of the bypass where a second branding endpoint slipped past
        // a regex that only matched the first one.
        if (path.matches("/api/workspaces/branding") ||
                path.matches("/api/workspaces/[^/]+/branding")) {
            if (!billingService.isFeatureEnabled(workspaceId, "whiteLabel")) {
                sendUpgradeRequired(response,
                        "White-labeling is available on the Business and Enterprise plans. Upgrade to customize your branding.");
                return;
            }
        }

        chain.doFilter(request, response);
    }

    private void sendUpgradeRequired(HttpServletResponse response, String message) throws IOException {
        response.setStatus(HttpServletResponse.SC_PAYMENT_REQUIRED); // 402
        response.setContentType("application/json");
        response.getWriter().write(objectMapper.writeValueAsString(Map.of(
                "error", "UPGRADE_REQUIRED",
                "message", message
        )));
    }
}

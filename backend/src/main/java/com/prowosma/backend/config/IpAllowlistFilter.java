package com.prowosma.backend.config;

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
import java.util.concurrent.ConcurrentHashMap;

/**
 * P3: IP Allowlisting
 * Blocks requests from IPs not on the workspace allowlist.
 * Allowlist managed via AdminController. Empty list = allow all.
 */
@Component
@Order(1)
@RequiredArgsConstructor
public class IpAllowlistFilter extends OncePerRequestFilter {

    // orgId -> list of allowed CIDRs / IPs
    public static final ConcurrentHashMap<String, List<String>> ALLOWLISTS
        = new ConcurrentHashMap<>();

    private final ClientIpResolver clientIpResolver;

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain chain)
            throws ServletException, IOException {

        String orgId = request.getHeader("X-Workspace-Id");
        if (orgId == null || !ALLOWLISTS.containsKey(orgId)) {
            chain.doFilter(request, response); return;
        }

        List<String> allowed = ALLOWLISTS.get(orgId);
        if (allowed == null || allowed.isEmpty()) {
            chain.doFilter(request, response); return;
        }

        String clientIp = getClientIp(request);
        // Matched by address (exact, CIDR, or an "10.1.*" style prefix on whole octets); this used to be a
        // plain string-prefix test, so CIDR entries never matched and "1.2" allowed 1.20.x.x.
        boolean permitted = allowed.stream().anyMatch(entry ->
            com.prowosma.backend.auth.IpRanges.allowlistMatches(entry, clientIp)
        );

        if (!permitted) {
            response.setStatus(403);
            response.getWriter().write("{\"error\":\"Access denied: IP not allowlisted\"}");
            return;
        }
        chain.doFilter(request, response);
    }

    /** X-Forwarded-For is believed only from a trusted proxy; a caller could otherwise claim an allowed address. */
    private String getClientIp(HttpServletRequest req) {
        return clientIpResolver.of(req);
    }
}

package com.prowosma.backend.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.UUID;

/**
 * Assigns every incoming request a correlation ID and puts it in MDC, so
 * every log line produced while handling that request — across every
 * filter and service it touches — carries the same requestId field (see
 * logback-spring.xml, which includes it in both the JSON and local-dev log
 * formats). Also echoed back as a response header, so a caller can hand
 * their own copy of it back when reporting an issue, turning "look through
 * today's entire log volume for what might be related" into "grep for this
 * one ID."
 *
 * This is the single cheapest, most immediately useful piece of the
 * observability gap — no external collector, no dashboard, no infra
 * decision required, unlike full distributed tracing (still configured
 * separately, see micrometer-tracing-bridge-otel in build.gradle, but
 * genuinely inert until a real OTLP endpoint exists somewhere).
 *
 * Runs at @Order(-10) — before every other standalone filter in this
 * package (ApiKeyAuthFilter=0, ScimAuthFilter=1, WorkspaceFilter=2,
 * RoleGuardFilter=3), so the request ID is available in MDC for their
 * logs too, not just controller/service code. JwtFilter runs earlier
 * still, via the Spring Security chain itself rather than this ordering
 * mechanism — out of scope for this filter to reach without changing
 * SecurityConfig, and the value here is overwhelmingly in application-level
 * logs, not the auth chain's own internal logging.
 */
@Component
@Order(-10)
public class RequestIdFilter extends OncePerRequestFilter {

    public static final String REQUEST_ID_HEADER = "X-Request-Id";
    public static final String MDC_KEY = "requestId";

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        // Honor an incoming X-Request-Id if the caller (or an upstream
        // load balancer/gateway) already set one, so a request's ID stays
        // the same across service boundaries rather than getting a new,
        // disconnected ID at every hop.
        String requestId = request.getHeader(REQUEST_ID_HEADER);
        if (requestId == null || requestId.isBlank()) {
            requestId = UUID.randomUUID().toString();
        }

        MDC.put(MDC_KEY, requestId);
        response.setHeader(REQUEST_ID_HEADER, requestId);
        try {
            chain.doFilter(request, response);
        } finally {
            // MDC is thread-local, and this thread will be reused for a
            // completely unrelated request once returned to the pool —
            // without this, a later request could inherit this one's ID
            // in its logs if the filter that would normally overwrite it
            // never ran (e.g. an early return elsewhere in the chain).
            MDC.remove(MDC_KEY);
        }
    }
}

package com.prowosma.backend.config;

import com.prowosma.backend.model.RateLimitWindow;
import jakarta.servlet.*;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.data.mongodb.core.FindAndModifyOptions;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.LocalDateTime;

import static org.springframework.data.mongodb.core.query.Criteria.where;

/**
 * Sliding-window-ish (fixed 1-minute window) rate limiter, backed by
 * MongoDB rather than an in-memory map.
 *
 * Previously this counted requests in a ConcurrentHashMap local to each
 * backend process — correct for a single instance, but meaningless once
 * you run more than one behind a load balancer for availability: each
 * instance enforced its own separate 300/minute limit, so the real
 * effective limit was (300 × instance count), and it reset independently
 * on each one. Using MongoDB's atomic findAndModify makes the counter
 * genuinely shared and race-free across every instance talking to the
 * same database - the same one every instance already requires.
 *
 * 300 requests per minute per client — resets each minute.
 */
@Component
public class RateLimitFilter extends OncePerRequestFilter {

    @org.springframework.beans.factory.annotation.Value("${app.rate-limit.requests-per-minute:300}")
    private int maxRequestsPerMinute;

    private final MongoTemplate mongoTemplate;
    private final ClientIpResolver clientIpResolver;

    public RateLimitFilter(MongoTemplate mongoTemplate, ClientIpResolver clientIpResolver) {
        this.mongoTemplate = mongoTemplate;
        this.clientIpResolver = clientIpResolver;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String clientKey = getClientKey(request);
        long epochMinute = System.currentTimeMillis() / 60_000;
        String windowId = clientKey + "|" + epochMinute;

        int count = incrementAndGet(windowId, clientKey, epochMinute);

        long windowResetEpochSeconds = (epochMinute + 1) * 60;
        response.setHeader("X-RateLimit-Limit",     String.valueOf(maxRequestsPerMinute));
        response.setHeader("X-RateLimit-Remaining", String.valueOf(Math.max(0, maxRequestsPerMinute - count)));
        response.setHeader("X-RateLimit-Reset",     String.valueOf(windowResetEpochSeconds));

        if (count > maxRequestsPerMinute) {
            response.setStatus(429);
            response.setContentType("application/json");
            response.getWriter().write("{\"error\":\"Too many requests\",\"retryAfterSeconds\":60}");
            return;
        }
        chain.doFilter(request, response);
    }

    /**
     * Atomically increments (creating if absent) this window's counter and
     * returns the new count in one round-trip - $inc + upsert is atomic at
     * the MongoDB level, so concurrent requests from any instance never
     * race or lose an increment the way a naive read-then-write would.
     */
    private int incrementAndGet(String windowId, String clientKey, long epochMinute) {
        Query query = Query.query(where("_id").is(windowId));
        Update update = new Update()
                .inc("count", 1)
                .setOnInsert("clientKey", clientKey)
                .setOnInsert("epochMinute", epochMinute)
                .setOnInsert("createdAt", LocalDateTime.now());

        RateLimitWindow result = mongoTemplate.findAndModify(
                query, update,
                FindAndModifyOptions.options().upsert(true).returnNew(true),
                RateLimitWindow.class
        );
        return result != null ? result.getCount() : 1;
    }

    /**
     * Prefer an authenticated identity over raw IP when available, so a
     * shared office/NAT IP doesn't cause unrelated users to share one
     * limit - falls back to IP for unauthenticated requests (login,
     * registration, etc.), which is what actually needs IP-based limiting
     * most (brute-force protection).
     */
    private String getClientKey(HttpServletRequest req) {
        var auth = org.springframework.security.core.context.SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.isAuthenticated() && auth.getName() != null && !"anonymousUser".equals(auth.getName())) {
            return "user:" + auth.getName();
        }
        return "ip:" + getClientIp(req);
    }

    /**
     * X-Forwarded-For is believed only from a trusted proxy. It used to be taken from any caller,
     * so a client could rotate it to get a fresh rate-limit bucket on every request.
     */
    private String getClientIp(HttpServletRequest req) {
        return clientIpResolver.of(req);
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        // Don't rate-limit health checks
        return request.getRequestURI().startsWith("/actuator");
    }
}


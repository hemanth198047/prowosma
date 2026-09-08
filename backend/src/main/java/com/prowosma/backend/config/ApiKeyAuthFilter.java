package com.prowosma.backend.config;

import com.prowosma.backend.model.ApiKey;
import com.prowosma.backend.repository.ApiKeyRepository;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.core.annotation.Order;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

/**
 * ApiKeyAuthFilter — makes the Developer Portal's API keys actually do
 * something. Previously, keys could be created and revoked in the UI, but
 * nothing anywhere validated an incoming request against them — a
 * "revoked" key had exactly the same (zero) effect on API access as an
 * active one, since neither was ever checked.
 *
 * Runs first (@Order(0), before IpAllowlistFilter/WorkspaceFilter/
 * RoleGuardFilter/PlanGuardFilter — all of which need Authentication to
 * already be set to work correctly) so an API-key-authenticated request
 * is treated exactly like a normal logged-in request for every check
 * downstream, rather than slipping past them because nothing had
 * authenticated it yet.
 *
 * Only activates when there's no Authorization Bearer header — API-key and
 * normal JWT auth are mutually exclusive per request, so this never
 * conflicts with JwtFilter.
 *
 * How the key is verified: the raw key's first 12 characters (keyPrefix)
 * are used to look up candidate ApiKey records cheaply, then each
 * candidate's stored BCrypt hash is checked against the full raw key —
 * the same pattern used for passwords elsewhere in this app. A bare
 * String.hashCode() was used for this previously, which is not a
 * cryptographic hash and was fixed alongside this filter (see
 * ApiKeyController#create).
 */
@Component
@Order(0)
@RequiredArgsConstructor
public class ApiKeyAuthFilter extends OncePerRequestFilter {

    private final ApiKeyRepository apiKeyRepository;
    private final WorkspaceContext workspaceContext;
    private final PasswordEncoder passwordEncoder;

    private static final String HEADER = "X-API-Key";

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                     HttpServletResponse response,
                                     FilterChain chain) throws ServletException, IOException {

        String authHeader = request.getHeader("Authorization");
        String apiKeyHeader = request.getHeader(HEADER);

        if ((authHeader == null || !authHeader.startsWith("Bearer ")) &&
                apiKeyHeader != null && !apiKeyHeader.isBlank()) {

            ApiKey matched = findMatchingKey(apiKeyHeader);

            if (matched == null) {
                sendUnauthorized(response, "Invalid API key");
                return;
            }
            if (!matched.isActive()) {
                sendUnauthorized(response, "This API key has been revoked");
                return;
            }
            if (matched.getExpiresAt() != null && matched.getExpiresAt().isBefore(LocalDateTime.now())) {
                sendUnauthorized(response, "This API key has expired");
                return;
            }

            // Authenticate as whoever created the key - the key acts on
            // their behalf, inheriting their existing role/permissions
            // rather than needing a whole separate authorization model.
            var auth = new UsernamePasswordAuthenticationToken(
                    matched.getCreatedBy(), null, List.of());
            SecurityContextHolder.getContext().setAuthentication(auth);

            // API key requests won't necessarily send X-Workspace-Id - the
            // key itself implies the workspace. Only set it if not already
            // present, so an explicit header (if the caller did send one)
            // isn't silently overridden.
            if (workspaceContext.getWorkspaceId() == null) {
                workspaceContext.setWorkspaceId(matched.getOrganizationId());
            }

            matched.setLastUsed(LocalDateTime.now());
            apiKeyRepository.save(matched);
        }

        chain.doFilter(request, response);
    }

    private ApiKey findMatchingKey(String rawKey) {
        if (rawKey.length() < 12) return null;
        String prefix = rawKey.substring(0, 12);

        Optional<ApiKey> byPrefix = apiKeyRepository.findByKeyPrefix(prefix);
        if (byPrefix.isPresent() && passwordEncoder.matches(rawKey, byPrefix.get().getKeyHash())) {
            return byPrefix.get();
        }
        return null;
    }

    private void sendUnauthorized(HttpServletResponse response, String message) throws IOException {
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType("application/json");
        response.getWriter().write("{\"error\":\"" + message.replace("\"", "'") + "\"}");
    }
}

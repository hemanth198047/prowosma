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
 * ScimAuthFilter — the missing authentication layer for /scim/v2/**.
 *
 * Before this filter existed, ScimController had NO authentication check of
 * any kind: SecurityConfig permits all requests at the servlet layer by
 * design (auth is meant to be handled by this app's own filter chain
 * instead), JwtFilter only *optionally* authenticates a Bearer JWT (it
 * never rejects a request for lacking one), and RoleGuardFilter (a) only
 * recognizes /api/** paths in its skip/admin-only lists and (b) lets every
 * GET request through unconditionally, and even lets non-GET requests
 * through when there's no authenticated principal at all. None of that is a
 * bug in those filters — they were never meant to guard /scim/v2/** — but
 * the practical result was that ScimController sat there completely open:
 * GET /scim/v2/Users would dump every user across every workspace with zero
 * credentials, and POST could create accounts the same way.
 *
 * Runs at @Order(1) — after ApiKeyAuthFilter/JwtFilter (which run via the
 * Security chain, effectively order -100) so a Bearer token has already had
 * its chance to be checked as a normal user session, but before
 * WorkspaceFilter/RoleGuardFilter (2, 3), since neither applies to this
 * path prefix and this filter needs to set WorkspaceContext itself — SCIM
 * calls from an IdP never send X-Workspace-Id, the token itself IS the
 * workspace.
 */
@Component
@Order(1)
@RequiredArgsConstructor
public class ScimAuthFilter extends OncePerRequestFilter {

    private final ApiKeyRepository apiKeyRepository;
    private final WorkspaceContext workspaceContext;
    private final PasswordEncoder  passwordEncoder;

    /** Same scope string ScimTokenController tags a generated token with. */
    public static final String SCIM_SCOPE = "scim:provision";

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {

        if (!request.getRequestURI().startsWith("/scim/v2")) {
            chain.doFilter(request, response);
            return;
        }

        String header = request.getHeader("Authorization");
        if (header == null || !header.startsWith("Bearer ")) {
            sendScimError(response, 401, "Missing bearer token");
            return;
        }

        ApiKey matched = findMatchingScimToken(header.substring(7));

        if (matched == null) {
            sendScimError(response, 401, "Invalid SCIM token");
            return;
        }
        if (!matched.isActive()) {
            sendScimError(response, 401, "This SCIM token has been revoked");
            return;
        }

        var auth = new UsernamePasswordAuthenticationToken(matched.getCreatedBy(), null, List.of());
        SecurityContextHolder.getContext().setAuthentication(auth);
        workspaceContext.setWorkspaceId(matched.getOrganizationId());

        matched.setLastUsed(LocalDateTime.now());
        apiKeyRepository.save(matched);

        chain.doFilter(request, response);
    }

    /** Same prefix-then-BCrypt-match pattern ApiKeyAuthFilter uses, narrowed to keys carrying the SCIM scope. */
    private ApiKey findMatchingScimToken(String rawToken) {
        if (rawToken.length() < 12) return null;
        String prefix = rawToken.substring(0, 12);

        Optional<ApiKey> byPrefix = apiKeyRepository.findByKeyPrefix(prefix);
        if (byPrefix.isPresent()
                && byPrefix.get().getScopes() != null
                && byPrefix.get().getScopes().contains(SCIM_SCOPE)
                && passwordEncoder.matches(rawToken, byPrefix.get().getKeyHash())) {
            return byPrefix.get();
        }
        return null;
    }

    private void sendScimError(HttpServletResponse response, int status, String detail) throws IOException {
        response.setStatus(status);
        response.setContentType("application/scim+json");
        response.getWriter().write(
            "{\"schemas\":[\"urn:ietf:params:scim:api:messages:2.0:Error\"],\"detail\":\""
            + detail.replace("\"", "'") + "\",\"status\":\"" + status + "\"}"
        );
    }
}

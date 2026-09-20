package com.prowosma.backend.config;

import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

/**
 * Security configuration.
 *
 * Auth strategy:
 *   - ApiKeyAuthFilter and JwtFilter each get a chance to authenticate the
 *     request (mutually exclusive by which header is present) BEFORE
 *     Spring Security's own AuthorizationFilter makes its decision below -
 *     that ordering (via addFilterBefore) is what lets an X-API-Key-only
 *     request satisfy .authenticated() the same way a Bearer JWT does.
 *   - RoleGuardFilter enforces OWNER/ADMIN/MEMBER/VIEWER on top of that,
 *     once Spring Security has already confirmed *someone* is signed in.
 *   - ScimAuthFilter is the sole gate for /scim/v2/** (a different token
 *     type/scope than a normal session or API key), so that prefix is
 *     permitAll here and enforced entirely by that filter instead.
 *
 * NOTE: PasswordEncoder is deliberately NOT a @Bean in this class (see
 * PasswordEncoderConfig instead) — ApiKeyAuthFilter's constructor needs a
 * PasswordEncoder, and this class constructor-injects ApiKeyAuthFilter, so
 * defining PasswordEncoder here would be a circular dependency (producing
 * it requires an already-built SecurityConfig instance, which requires
 * ApiKeyAuthFilter to already exist).
 *
 * Previously this was anyRequest().permitAll(), with auth meant to be
 * handled entirely by the custom filter chain below it - but
 * RoleGuardFilter intentionally skips its own checks for GET requests and
 * for any request with no authenticated principal at all (see its
 * javadoc), and WorkspaceFilter only rejects an *authenticated* non-member,
 * never an unauthenticated caller. Nothing was actually rejecting a
 * completely unauthenticated request to a protected endpoint - it just
 * sailed through to the controller.
 */
@Configuration
@EnableWebSecurity
@EnableMethodSecurity
@RequiredArgsConstructor
public class SecurityConfig {

    private final JwtFilter jwtFilter;
    private final ApiKeyAuthFilter apiKeyAuthFilter;

    /** Paths reachable with no Spring-Security-level authentication at all - each is either genuinely public, or has its own dedicated auth gate that isn't a Bearer JWT / X-API-Key (webhook signatures, SCIM tokens, etc.). */
    private static final String[] PUBLIC_PATHS = {
        "/api/auth/**",
        "/api/health/**",
        "/api/invitations/accept",
        // The AcceptInvite page calls this FIRST, on mount, before the
        // invitee has any account or token at all — to show their email/
        // role/workspace name and decide whether to render a "create
        // account" or "log in" form. It was missing from this list even
        // though /api/invitations/accept (the very next call in that same
        // flow) was correctly included, so a brand-new invitee with no
        // token got a blanket 401 on the *first* request the page makes,
        // which the frontend's global 401 handler then turned into an
        // immediate bounce to /login — before they ever saw the invite.
        "/api/invitations/info",
        "/api/tasks/attachments/**",
        // Inbound provider callbacks ONLY, each of which authenticates itself
        // (Stripe by its signature header, the email providers by a shared
        // secret). This used to be "/api/webhooks/**", which also made the
        // whole outbound-webhook MANAGEMENT api (WebhookController: list,
        // create, edit, delete, rotate-secret, test) reachable with no login.
        "/api/webhooks/stripe",
        "/api/webhooks/email/**",
        // Datadog / Sentry / Jenkins post events here with no login. The secret in the URL
        // (or, for Sentry, also a signature) is the authentication: see InboundEventService.
        "/api/inbound-events/**",
        // Same shape as /api/auth/**: /providers and /metadata/{id} are
        // pre-login informational endpoints (which SSO buttons to show,
        // what URL to give an IdP admin) with nothing sensitive in them,
        // and /callback runs immediately after a SAML redirect — before
        // any JWT exists — authenticated by Spring Security's own SAML2
        // filter chain via @AuthenticationPrincipal, not a Bearer token.
        // Blocking this whole prefix at the JWT layer meant the login
        // page's own "GET /api/sso/providers to decide whether to show an
        // SSO button" call 401'd for every single visitor, logged-in or
        // not.
        "/api/sso/**",
        "/scim/v2/**",
        "/actuator/**",
        "/swagger-ui/**", "/swagger-ui.html",
        "/v3/api-docs/**",
        "/favicon.ico",
        "/error",
        // SockJS/STOMP handshake (info/xhr/websocket-upgrade requests under
        // /ws/**) was previously caught by anyRequest().authenticated() and
        // rejected with a blanket 401 on every single request — SockJS's
        // own polling/XHR transport doesn't carry this app's custom
        // Authorization header the way the axios `client` instance does,
        // so the handshake could never complete in production regardless
        // of whether the user was logged in. Real identity verification for
        // WebSocket traffic doesn't belong at this HTTP layer anyway — the
        // frontend already sends its JWT as a STOMP CONNECT header (see
        // useWebSocket.js's connectHeaders), which StompAuthChannelInterceptor
        // now validates once the connection is actually established.
        "/ws/**"
    };

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .cors(cors -> {})
            .csrf(csrf -> csrf.disable())
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers(PUBLIC_PATHS).permitAll()
                .anyRequest().authenticated()
            )
            .exceptionHandling(ex -> ex.authenticationEntryPoint((request, response, authException) -> {
                response.setStatus(jakarta.servlet.http.HttpServletResponse.SC_UNAUTHORIZED);
                response.setContentType("application/json");
                response.getWriter().write(
                    "{\"error\":\"UNAUTHENTICATED\",\"message\":\"Authentication required\"}");
            }))
            // Previously no security response headers were set at all.
            // Spring Security's own header writers, not hand-rolled ones —
            // each is a well-established, standard mitigation:
            .headers(headers -> headers
                // X-XSS-Protection is deliberately NOT set here — it's a
                // deprecated, browser-removed mechanism in modern Chrome/
                // Edge/Safari; the Content-Security-Policy below is its
                // real, current replacement and covers the same threat
                // class more effectively.
                // Prevents this app from ever being embedded in an <iframe>
                // on another site — the standard clickjacking mitigation.
                .frameOptions(frame -> frame.deny())
                // Stops browsers from MIME-sniffing a response into
                // executing as a different content type than declared
                // (e.g. treating an uploaded "image" as executable JS).
                .contentTypeOptions(contentType -> {})
                // HSTS: once a browser has seen this once over HTTPS, it
                // refuses to ever downgrade to plain HTTP for this host
                // again, even if a user types http:// or clicks an old
                // link — closes the classic SSL-stripping downgrade
                // attack. 1 year, includes subdomains, eligible for
                // browser preload lists.
                .httpStrictTransportSecurity(hsts -> hsts
                    .includeSubDomains(true)
                    .maxAgeInSeconds(31536000))
                // Content-Security-Policy — the single highest-value
                // header here: even if an XSS bug exists, a correct CSP
                // stops the injected script from doing anything
                // (exfiltrating data, loading a remote payload). Kept
                // deliberately permissive enough not to break the
                // existing app (inline styles are common in this
                // codebase's components) while still closing off the
                // worst case (arbitrary remote script execution) —
                // tighten further (e.g. drop 'unsafe-inline' for style-src
                // once inline styles are audited/removed) as a follow-up,
                // not a blocker to shipping a real CSP at all.
                .contentSecurityPolicy(csp -> csp.policyDirectives(
                    "default-src 'self'; " +
                    "script-src 'self'; " +
                    "style-src 'self' 'unsafe-inline'; " +
                    "img-src 'self' data: https:; " +
                    "connect-src 'self' https: wss: ws:; " +
                    "frame-ancestors 'none'; " +
                    "base-uri 'self'; " +
                    "object-src 'none'"))
            )
            .addFilterBefore(apiKeyAuthFilter, UsernamePasswordAuthenticationFilter.class)
            .addFilterBefore(jwtFilter, UsernamePasswordAuthenticationFilter.class);

        return http.build();
    }

    @Bean
    public com.fasterxml.jackson.databind.ObjectMapper objectMapper() {
        return new com.fasterxml.jackson.databind.ObjectMapper()
            .registerModule(new com.fasterxml.jackson.datatype.jsr310.JavaTimeModule())
            .disable(com.fasterxml.jackson.databind.SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
    }
}

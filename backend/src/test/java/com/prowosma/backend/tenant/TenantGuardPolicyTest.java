package com.prowosma.backend.tenant;

import com.prowosma.backend.config.tenant.TenantGuardPolicy;
import com.prowosma.backend.config.tenant.TenantScope;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

@DisplayName("TenantGuardPolicy / TenantScope — where the guard applies")
class TenantGuardPolicyTest {

    @Test
    @DisplayName("tenant-scoped API paths are enforced")
    void enforcedPaths() {
        assertTrue(TenantGuardPolicy.isEnforcedPath("/api/tasks"));
        assertTrue(TenantGuardPolicy.isEnforcedPath("/api/tasks/123"));
        assertTrue(TenantGuardPolicy.isEnforcedPath("/api/webhooks"));
        assertTrue(TenantGuardPolicy.isEnforcedPath("/api/webhooks/abc/rotate-secret"));
        assertTrue(TenantGuardPolicy.isEnforcedPath("/api/webhooks/event-types"));
        assertTrue(TenantGuardPolicy.isEnforcedPath("/api/workspaces"));
        assertTrue(TenantGuardPolicy.isEnforcedPath("/api/team/by-email"));
        assertTrue(TenantGuardPolicy.isEnforcedPath("/api/inbound-webhooks/keys"));
        assertTrue(TenantGuardPolicy.isEnforcedPath("/api/invitations"));            // listing/sending, not accepting
        assertTrue(TenantGuardPolicy.isEnforcedPath("/api/invitations/abc/resend"));
    }

    @Test
    @DisplayName("identity and system-to-system paths are not")
    void tenantlessPaths() {
        assertFalse(TenantGuardPolicy.isEnforcedPath("/api/auth/login"));
        assertFalse(TenantGuardPolicy.isEnforcedPath("/api/sso/callback"));
        assertFalse(TenantGuardPolicy.isEnforcedPath("/api/invitations/accept"));
        assertFalse(TenantGuardPolicy.isEnforcedPath("/api/invitations/accept/tok"));
        assertFalse(TenantGuardPolicy.isEnforcedPath("/api/invitations/info"));
        assertFalse(TenantGuardPolicy.isEnforcedPath("/api/invitations/validate/tok"));
        assertFalse(TenantGuardPolicy.isEnforcedPath("/api/webhooks/stripe"));
        assertFalse(TenantGuardPolicy.isEnforcedPath("/api/webhooks/email/sendgrid"));
        assertFalse(TenantGuardPolicy.isEnforcedPath("/api/health"));
        assertFalse(TenantGuardPolicy.isEnforcedPath("/api/inbound-events/datadog/sometoken"));
    }

    @Test
    @DisplayName("only the exact inbound webhook callbacks are exempt — not the webhook management API that shares the prefix")
    void webhookPrefixIsNotAWildcard() {
        assertTrue(TenantGuardPolicy.isEnforcedPath("/api/webhooks/email"));         // no trailing segment: management API
        assertTrue(TenantGuardPolicy.isEnforcedPath("/api/webhooks/abc"));
        assertTrue(TenantGuardPolicy.isEnforcedPath("/api/webhooks/dispatch"));
    }

    @Test
    @DisplayName("non-API paths are not handled by the guard")
    void nonApiPaths() {
        assertFalse(TenantGuardPolicy.isEnforcedPath(null));
        assertFalse(TenantGuardPolicy.isEnforcedPath(""));
        assertFalse(TenantGuardPolicy.isEnforcedPath("/ws/info"));
        assertFalse(TenantGuardPolicy.isEnforcedPath("/actuator/health"));
        assertFalse(TenantGuardPolicy.isEnforcedPath("/scim/v2/Users"));
        assertFalse(TenantGuardPolicy.isEnforcedPath("/swagger-ui.html"));
    }

    @Test
    @DisplayName("a path that only *looks* like an exempt one can't earn the exemption (traversal / matrix / doubled slashes)")
    void ambiguousPathsAreEnforced() {
        assertTrue(TenantGuardPolicy.isEnforcedPath("/api/auth/../tasks/1"));
        assertTrue(TenantGuardPolicy.isEnforcedPath("/api/auth/;/tasks/1"));
        assertTrue(TenantGuardPolicy.isEnforcedPath("/api/auth//x"));
        assertTrue(TenantGuardPolicy.isEnforcedPath("/api/health;/../tasks"));
    }

    @Test
    @DisplayName("exempt entities are exactly User and Workspace")
    void exemptEntities() {
        assertEquals(2, TenantGuardPolicy.EXEMPT_ENTITIES.size());
        assertTrue(TenantGuardPolicy.EXEMPT_ENTITIES.contains("User"));
        assertTrue(TenantGuardPolicy.EXEMPT_ENTITIES.contains("Workspace"));
    }

    @Test
    @DisplayName("TenantScope: skip permits everything; enforced permits own + un-owned only")
    void scopePermits() {
        assertTrue(TenantScope.skip().permits("anything"));
        TenantScope a = TenantScope.enforced("A");
        assertTrue(a.permits("A"));
        assertTrue(a.permits(null));
        assertTrue(a.permits(" "));
        assertFalse(a.permits("B"));
        TenantScope none = TenantScope.enforced("  ");
        assertNull(none.tenantId());
        assertFalse(none.permits("A"));
        assertTrue(none.permits(null));
    }

    // ── scopeFor: when does the guard actually engage? ───────────────────────

    @Test
    @DisplayName("an authenticated request to a tenant-scoped path is enforced for the caller's workspace")
    void scopeFor_authenticatedApiRequest() {
        TenantScope scope = TenantGuardPolicy.scopeFor(true, "/api/tasks/1", true, () -> "ws-A");
        assertTrue(scope.isEnforced());
        assertEquals("ws-A", scope.tenantId());
    }

    @Test
    @DisplayName("an authenticated request with no workspace selected is still enforced (only un-owned records visible)")
    void scopeFor_noWorkspaceStillEnforced() {
        TenantScope scope = TenantGuardPolicy.scopeFor(true, "/api/tasks/1", true, () -> null);
        assertTrue(scope.isEnforced());
        assertNull(scope.tenantId());
    }

    @Test
    @DisplayName("outside an HTTP request (scheduler, async job, WebSocket frame, test setup) nothing is enforced")
    void scopeFor_notInRequest() {
        assertFalse(TenantGuardPolicy.scopeFor(false, null, true, () -> "ws-A").isEnforced());
        assertFalse(TenantGuardPolicy.scopeFor(false, "/api/tasks/1", true, () -> "ws-A").isEnforced());
    }

    @Test
    @DisplayName("an unauthenticated request is not enforced (SecurityConfig rejects it on protected paths anyway)")
    void scopeFor_unauthenticated() {
        assertFalse(TenantGuardPolicy.scopeFor(true, "/api/tasks/1", false, () -> "ws-A").isEnforced());
    }

    @Test
    @DisplayName("login / SSO / invitation / callback paths are not enforced, even when authenticated")
    void scopeFor_tenantlessPath() {
        assertFalse(TenantGuardPolicy.scopeFor(true, "/api/auth/login", true, () -> "ws-A").isEnforced());
        assertFalse(TenantGuardPolicy.scopeFor(true, "/api/invitations/accept", true, () -> null).isEnforced());
    }

    @Test
    @DisplayName("if the request scope is not active (workspace lookup throws) the call is left alone rather than failing")
    void scopeFor_requestScopeInactive() {
        TenantScope scope = TenantGuardPolicy.scopeFor(true, "/api/tasks/1", true, () -> {
            throw new IllegalStateException("No thread-bound request found");
        });
        assertFalse(scope.isEnforced());
    }

    @Test
    @DisplayName("the workspace is not even looked up when the guard would not engage")
    void scopeFor_doesNotLookUpWorkspaceNeedlessly() {
        TenantGuardPolicy.scopeFor(false, "/api/tasks/1", true, () -> { throw new AssertionError("looked up"); });
        TenantGuardPolicy.scopeFor(true, "/api/auth/login", true, () -> { throw new AssertionError("looked up"); });
        TenantGuardPolicy.scopeFor(true, "/api/tasks/1", false, () -> { throw new AssertionError("looked up"); });
    }
}

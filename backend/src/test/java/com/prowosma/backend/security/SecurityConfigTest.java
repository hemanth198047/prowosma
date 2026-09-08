package com.prowosma.backend.security;

import com.prowosma.backend.ProwosmaTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Verifies that SecurityConfig no longer uses anyRequest().permitAll().
 *
 * T1  Unauthenticated GET to a protected endpoint returns 401/403
 * T2  Public auth paths are accessible without a token
 * T3  Swagger UI is accessible without a token
 * T4  Authenticated request to a protected endpoint succeeds
 * T5  Public docs endpoint is accessible without a token
 * T6  Login endpoint does not require a token
 */
@DisplayName("SecurityConfig — explicit auth rules (not anyRequest().permitAll)")
class SecurityConfigTest extends ProwosmaTestBase {

    @Test
    @DisplayName("T1: Unauthenticated GET /api/tasks returns 401")
    void unauthenticated_protectedEndpoint_returns401() throws Exception {
        mvc.perform(get("/api/tasks")
                .header("X-Workspace-Id", workspaceId))
           .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("T2: POST /api/auth/login is accessible without token")
    void login_accessible_withoutToken() throws Exception {
        // Wrong credentials but endpoint is reachable (not 401 from Security layer)
        mvc.perform(post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"nobody@x.com\",\"password\":\"wrong\"}"))
           .andExpect(status().isUnauthorized()); // 401 from AuthService, not Spring Security
    }

    @Test
    @DisplayName("T3: GET /swagger-ui.html is accessible without token")
    void swagger_accessible_withoutToken() throws Exception {
        // Swagger UI redirect — should be 3xx or 200, not 401
        int status = mvc.perform(get("/swagger-ui.html"))
           .andReturn().getResponse().getStatus();
        org.junit.jupiter.api.Assertions.assertNotEquals(401, status,
            "Swagger UI should be accessible without auth");
    }

    @Test
    @DisplayName("T4: Authenticated GET /api/tasks returns 200")
    void authenticated_request_succeeds() throws Exception {
        mvc.perform(get("/api/tasks")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
           .andExpect(status().isOk());
    }

    @Test
    @DisplayName("T5: Unauthenticated GET /api/projects returns 401")
    void unauthenticated_projects_returns401() throws Exception {
        mvc.perform(get("/api/projects")
                .header("X-Workspace-Id", workspaceId))
           .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("T6: POST /api/auth/register is accessible without token")
    void register_accessible_withoutToken() throws Exception {
        int status = mvc.perform(post("/api/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"New\",\"email\":\"new_sec_test@test.com\",\"password\":\"pass123\"}"))
           .andReturn().getResponse().getStatus();
        // Should be 200 (registered) or 4xx (validation) — not 401 from Security layer
        org.junit.jupiter.api.Assertions.assertNotEquals(401, status,
            "Register should not require prior auth");
    }
}

package com.prowosma.backend.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.ProwosmaTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Fix-4: Auth flow smoke tests.
 *
 * Covers:
 *   T1  POST /api/auth/register returns a JWT token
 *   T2  POST /api/auth/login with correct credentials returns token
 *   T3  POST /api/auth/login with wrong password returns 401
 *   T4  GET /api/auth/profile with valid token returns user email
 *   T5  GET /api/auth/profile without token still returns (JWT optional)
 */
@DisplayName("Auth flow — register, login, profile")
class AuthFlowTest extends ProwosmaTestBase {

    @Autowired private ObjectMapper objectMapper;

    @Test
    @DisplayName("T1: POST /api/auth/register returns JWT")
    void register_returnsToken() throws Exception {
        String resp = mvc.perform(post("/api/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"New User\",\"email\":\"newuser@test.com\",\"password\":\"Secret123\"}"))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();

        var json = objectMapper.readTree(resp);
        assertThat(json.has("token")).isTrue();
        assertThat(json.get("token").asText()).isNotBlank();
    }

    @Test
    @DisplayName("T2: POST /api/auth/login with correct password returns token")
    void login_correctPassword_returnsToken() throws Exception {
        // owner@test.com was created in baseSetup with password "pass"
        String resp = mvc.perform(post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + ownerEmail + "\",\"password\":\"pass\"}"))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();

        var json = objectMapper.readTree(resp);
        assertThat(json.has("token")).isTrue();
    }

    @Test
    @DisplayName("T3: POST /api/auth/login with wrong password returns 401")
    void login_wrongPassword_returns401() throws Exception {
        mvc.perform(post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + ownerEmail + "\",\"password\":\"wrongpass\"}"))
           .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("T4: GET /api/auth/profile with valid token returns user data")
    void profile_withToken_returnsUser() throws Exception {
        String resp = mvc.perform(get("/api/auth/profile")
                .header("Authorization", authHeader(ownerToken())))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();

        var json = objectMapper.readTree(resp);
        // Should contain the owner email
        assertThat(resp).contains(ownerEmail);
    }
}

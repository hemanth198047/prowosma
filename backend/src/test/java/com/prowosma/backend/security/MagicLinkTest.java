package com.prowosma.backend.security;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.ProwosmaTestBase;
import com.prowosma.backend.repository.UserRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Tests the fixed magic link flow.
 * Previously: used findAll() to scan all users for token match.
 * Fixed: uses indexed findByMagicLinkToken() repository method.
 *
 * T1  POST /api/auth/magic-link stores token in user record
 * T2  POST /api/auth/magic-link/verify with valid token returns JWT
 * T3  Token is invalidated after use
 * T4  Invalid token returns 401
 */
@DisplayName("Magic link — token-indexed lookup (no findAll scan)")
class MagicLinkTest extends ProwosmaTestBase {

    @Autowired private UserRepository userRepository;
    @Autowired private ObjectMapper   objectMapper;

    @Test
    @DisplayName("T1: POST /api/auth/magic-link saves token on user")
    void magicLink_storesToken() throws Exception {
        mvc.perform(post("/api/auth/magic-link")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + ownerEmail + "\"}"))
           .andExpect(status().isOk());

        var user = userRepository.findByEmail(ownerEmail);
        assertThat(user).isPresent();
        assertThat(user.get().getMagicLinkToken()).isNotBlank();
        assertThat(user.get().getMagicLinkExpiry()).isNotNull();
    }

    @Test
    @DisplayName("T2: POST /api/auth/magic-link/verify returns JWT for valid token")
    void magicLink_verify_returnsJwt() throws Exception {
        // Send magic link to get a token
        mvc.perform(post("/api/auth/magic-link")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + ownerEmail + "\"}"))
           .andExpect(status().isOk());

        // Retrieve the token from DB (email service is mocked in tests)
        String token = userRepository.findByEmail(ownerEmail)
            .map(u -> u.getMagicLinkToken())
            .orElseThrow(() -> new AssertionError("Token not set"));

        String resp = mvc.perform(post("/api/auth/magic-link/verify")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"token\":\"" + token + "\"}"))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();

        JsonNode json = objectMapper.readTree(resp);
        assertThat(json.has("token")).isTrue();
        assertThat(json.get("token").asText()).isNotBlank();
    }

    @Test
    @DisplayName("T3: Token is cleared from user after successful verify")
    void magicLink_tokenClearedAfterUse() throws Exception {
        mvc.perform(post("/api/auth/magic-link")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + ownerEmail + "\"}"))
           .andExpect(status().isOk());

        String token = userRepository.findByEmail(ownerEmail)
            .map(u -> u.getMagicLinkToken()).orElseThrow();

        mvc.perform(post("/api/auth/magic-link/verify")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"token\":\"" + token + "\"}"))
           .andExpect(status().isOk());

        // Token should be gone
        var user = userRepository.findByEmail(ownerEmail);
        assertThat(user.get().getMagicLinkToken()).isNullOrEmpty();
    }

    @Test
    @DisplayName("T4: Invalid magic link token returns 401")
    void magicLink_invalidToken_returns401() throws Exception {
        mvc.perform(post("/api/auth/magic-link/verify")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"token\":\"totally-invalid-token-xyz\"}"))
           .andExpect(status().isUnauthorized());
    }
}

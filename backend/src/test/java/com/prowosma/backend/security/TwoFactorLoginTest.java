package com.prowosma.backend.security;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.ProwosmaTestBase;
import com.prowosma.backend.auth.BackupCodes;
import com.prowosma.backend.auth.Totp;
import com.prowosma.backend.model.User;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Two-factor authentication used to be switchable but never asked for: login only checked the
 * password, so an account with 2FA on could be entered with the password alone. These tests
 * drive the real two-step login.
 */
@DisplayName("Login — two-factor authentication is actually required")
class TwoFactorLoginTest extends ProwosmaTestBase {

    @Autowired private ObjectMapper objectMapper;

    private static final String SECRET = "JBSWY3DPEHPK3PXP";
    private static final String BACKUP_1 = "abcde-fghjk";
    private static final String BACKUP_2 = "mnpqr-stuvw";

    private void enableTwoFactor(String email) {
        User user = userRepository.findByEmail(email).orElseThrow();
        user.setTwoFactorEnabled(true);
        user.setTwoFactorSecret(SECRET);
        user.setBackupCodes(new ArrayList<>(BackupCodes.hashAll(List.of(BACKUP_1, BACKUP_2))));
        user.setTwoFactorLastStep(-1);
        userRepository.save(user);
    }

    private static String currentCode() {
        return Totp.codeAt(SECRET, Totp.stepAt(System.currentTimeMillis()));
    }

    private static String wrongCode() {
        String code = currentCode();
        // any six digits that are not the code for the previous, current or next step
        for (String candidate : new String[]{"000000", "111111", "222222"}) {
            boolean clash = false;
            for (int d = -1; d <= 1; d++) clash |= candidate.equals(Totp.codeAt(SECRET, Totp.stepAt(System.currentTimeMillis()) + d));
            if (!clash) return candidate;
        }
        return code.equals("999999") ? "888888" : "999999";
    }

    private JsonNode passwordLogin(String email) throws Exception {
        String body = mvc.perform(post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email + "\",\"password\":\"pass\"}"))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(body);
    }

    private String challengeFor(String email) throws Exception {
        return passwordLogin(email).get("twoFactorToken").asText();
    }

    private org.springframework.test.web.servlet.ResultActions secondStep(String challenge, String code) throws Exception {
        return mvc.perform(post("/api/auth/login/2fa")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"twoFactorToken\":\"" + challenge + "\",\"code\":\"" + code + "\"}"));
    }

    // ── the password step ────────────────────────────────────────────────────

    @Test
    @DisplayName("an account without 2FA still signs in with just its password")
    void withoutTwoFactor_unchanged() throws Exception {
        JsonNode response = passwordLogin(ownerEmail);
        assertThat(response.has("token")).isTrue();
        assertThat(response.has("requiresTwoFactor")).isFalse();
    }

    @Test
    @DisplayName("with 2FA on, the correct password gets a challenge, NOT a session")
    void passwordAlone_issuesNoSession() throws Exception {
        enableTwoFactor(memberEmail);
        JsonNode response = passwordLogin(memberEmail);

        assertThat(response.get("requiresTwoFactor").asBoolean()).isTrue();
        assertThat(response.get("twoFactorToken").asText()).isNotEmpty();
        assertThat(response.has("token")).isFalse();
        assertThat(response.has("email")).isFalse();
    }

    @Test
    @DisplayName("a wrong password still fails exactly as before, 2FA or not")
    void wrongPassword_stillFails() throws Exception {
        enableTwoFactor(memberEmail);
        mvc.perform(post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + memberEmail + "\",\"password\":\"nope\"}"))
           .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("the challenge cannot be used as an access token")
    void challengeIsNotASession() throws Exception {
        enableTwoFactor(memberEmail);
        String challenge = challengeFor(memberEmail);

        mvc.perform(get("/api/users/me").header("Authorization", authHeader(challenge)))
           .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/tasks").header("Authorization", authHeader(challenge)).header("X-Workspace-Id", workspaceId))
           .andExpect(status().isUnauthorized());
    }

    // ── the code step ────────────────────────────────────────────────────────

    @Test
    @DisplayName("password + a correct code from the authenticator app signs in, and the session works")
    void correctCode_signsIn() throws Exception {
        enableTwoFactor(memberEmail);
        String body = secondStep(challengeFor(memberEmail), currentCode())
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        JsonNode response = objectMapper.readTree(body);
        assertThat(response.get("email").asText()).isEqualTo(memberEmail);
        mvc.perform(get("/api/auth/profile").header("Authorization", authHeader(response.get("token").asText())))
           .andExpect(status().isOk());
    }

    @Test
    @DisplayName("a wrong code, a malformed code and a made-up challenge are all refused")
    void badInputs() throws Exception {
        enableTwoFactor(memberEmail);
        String challenge = challengeFor(memberEmail);
        secondStep(challenge, wrongCode()).andExpect(status().isUnauthorized());
        secondStep(challenge, "").andExpect(status().isUnauthorized());
        secondStep(challenge, "abc").andExpect(status().isUnauthorized());
        secondStep("not.a.token", currentCode()).andExpect(status().isUnauthorized());
        secondStep(jwtUtil.generateToken(memberEmail), currentCode()).andExpect(status().isUnauthorized());   // an access token is not a challenge
    }

    @Test
    @DisplayName("a code that was already used is refused (RFC 6238: a one-time password is used once)")
    void replayIsRefused() throws Exception {
        enableTwoFactor(memberEmail);
        String challenge = challengeFor(memberEmail);
        String code = currentCode();

        secondStep(challenge, code).andExpect(status().isOk());
        secondStep(challenge, code).andExpect(status().isUnauthorized());
        secondStep(challengeFor(memberEmail), code).andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("five wrong codes lock the code step: even the correct code is then refused with 429")
    void lockout() throws Exception {
        enableTwoFactor(memberEmail);
        String challenge = challengeFor(memberEmail);
        for (int i = 0; i < 5; i++) secondStep(challenge, wrongCode()).andExpect(status().isUnauthorized());

        secondStep(challenge, currentCode()).andExpect(status().isTooManyRequests());
        secondStep(challengeFor(memberEmail), BACKUP_1).andExpect(status().isTooManyRequests());
    }

    @Test
    @DisplayName("a correct code resets the failure count")
    void successResetsCount() throws Exception {
        enableTwoFactor(memberEmail);
        String challenge = challengeFor(memberEmail);
        for (int i = 0; i < 4; i++) secondStep(challenge, wrongCode()).andExpect(status().isUnauthorized());
        secondStep(challenge, BACKUP_1).andExpect(status().isOk());

        User user = userRepository.findByEmail(memberEmail).orElseThrow();
        assertThat(user.getTwoFactorFailedAttempts()).isEqualTo(0);
    }

    // ── backup codes ─────────────────────────────────────────────────────────

    @Test
    @DisplayName("a backup code signs in once, in any case/format, and is then spent")
    void backupCodeWorksOnce() throws Exception {
        enableTwoFactor(memberEmail);
        secondStep(challengeFor(memberEmail), "ABCDE-FGHJK").andExpect(status().isOk());
        secondStep(challengeFor(memberEmail), BACKUP_1).andExpect(status().isUnauthorized());
        secondStep(challengeFor(memberEmail), BACKUP_2).andExpect(status().isOk());       // the others still work

        assertThat(userRepository.findByEmail(memberEmail).orElseThrow().getBackupCodes()).isEmpty();
    }

    // ── a stale challenge ────────────────────────────────────────────────────

    @Test
    @DisplayName("if 2FA is switched off after the challenge was issued, the challenge is no longer honoured")
    void challengeForAccountWithoutTwoFactor() throws Exception {
        enableTwoFactor(memberEmail);
        String challenge = challengeFor(memberEmail);
        User user = userRepository.findByEmail(memberEmail).orElseThrow();
        user.setTwoFactorEnabled(false);
        userRepository.save(user);

        secondStep(challenge, currentCode()).andExpect(status().isUnauthorized());
    }
}

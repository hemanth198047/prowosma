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
 * Enrolling, replacing and switching off an authenticator. Setup used to overwrite the ACTIVE
 * secret immediately, even with 2FA already on and with no proof of the old one, so a stolen
 * session could swap in its own secret. It also never created backup codes.
 */
@DisplayName("2FA settings — enrolment, replacement, backup codes")
class TwoFactorSetupTest extends ProwosmaTestBase {

    @Autowired private ObjectMapper objectMapper;

    private static final String ACTIVE_SECRET = "JBSWY3DPEHPK3PXP";

    private JsonNode call(String path, String json, int expectedStatus) throws Exception {
        String body = mvc.perform(post("/api/security/2fa/" + path)
                .header("Authorization", authHeader(ownerToken()))
                .contentType(MediaType.APPLICATION_JSON)
                .content(json))
           .andExpect(status().is(expectedStatus))
           .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(body);
    }

    private void enableTwoFactorForOwner() {
        User user = userRepository.findByEmail(ownerEmail).orElseThrow();
        user.setTwoFactorEnabled(true);
        user.setTwoFactorSecret(ACTIVE_SECRET);
        user.setBackupCodes(new ArrayList<>(BackupCodes.hashAll(List.of("abcde-fghjk"))));
        userRepository.save(user);
    }

    private static String code(String secret) {
        return Totp.codeAt(secret, Totp.stepAt(System.currentTimeMillis()));
    }

    // ── first-time enrolment ─────────────────────────────────────────────────

    @Test
    @DisplayName("enrolling: setup does not enable anything; a correct code from the new secret does, and returns 10 backup codes once")
    void firstEnrolment() throws Exception {
        JsonNode setup = call("setup", "{}", 200);
        String secret = setup.get("secret").asText();
        assertThat(userRepository.findByEmail(ownerEmail).orElseThrow().isTwoFactorEnabled()).isFalse();

        JsonNode verified = call("verify", "{\"code\":\"" + code(secret) + "\"}", 200);

        assertThat(verified.get("enabled").asBoolean()).isTrue();
        assertThat(verified.get("backupCodes").size()).isEqualTo(10);
        User user = userRepository.findByEmail(ownerEmail).orElseThrow();
        assertThat(user.isTwoFactorEnabled()).isTrue();
        assertThat(user.getTwoFactorSecret()).isEqualTo(secret);
        assertThat(user.getBackupCodes()).hasSize(10);
        assertThat(user.getBackupCodes().get(0)).doesNotContain("-");           // stored hashed, not the code itself

        JsonNode status = objectMapper.readTree(mvc.perform(get("/api/security/2fa/status")
                .header("Authorization", authHeader(ownerToken())))
           .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        assertThat(status.get("enabled").asBoolean()).isTrue();
        assertThat(status.get("backupCodesRemaining").asInt()).isEqualTo(10);
    }

    @Test
    @DisplayName("a wrong code does not enable 2FA")
    void wrongCodeDoesNotEnable() throws Exception {
        call("setup", "{}", 200);
        call("verify", "{\"code\":\"000000\"}", 400);
        assertThat(userRepository.findByEmail(ownerEmail).orElseThrow().isTwoFactorEnabled()).isFalse();
    }

    @Test
    @DisplayName("verify without setup is refused")
    void verifyWithoutSetup() throws Exception {
        call("verify", "{\"code\":\"123456\"}", 400);
    }

    // ── replacing an active authenticator ────────────────────────────────────

    @Test
    @DisplayName("with 2FA on, setup needs proof of the CURRENT authenticator; without it the active secret is untouched")
    void replacementNeedsProof() throws Exception {
        enableTwoFactorForOwner();

        call("setup", "{}", 400);
        call("setup", "{\"code\":\"000000\"}", 400);

        User user = userRepository.findByEmail(ownerEmail).orElseThrow();
        assertThat(user.getTwoFactorSecret()).isEqualTo(ACTIVE_SECRET);
        assertThat(user.getPendingTwoFactorSecret()).isNull();
    }

    @Test
    @DisplayName("with proof, the new secret stays PENDING: the old authenticator keeps working until the new one is verified")
    void replacementStaysPendingUntilVerified() throws Exception {
        enableTwoFactorForOwner();

        JsonNode setup = call("setup", "{\"code\":\"" + code(ACTIVE_SECRET) + "\"}", 200);
        String newSecret = setup.get("secret").asText();

        User pending = userRepository.findByEmail(ownerEmail).orElseThrow();
        assertThat(pending.getTwoFactorSecret()).isEqualTo(ACTIVE_SECRET);
        assertThat(pending.getPendingTwoFactorSecret()).isEqualTo(newSecret);

        call("verify", "{\"code\":\"" + code(newSecret) + "\"}", 200);
        User replaced = userRepository.findByEmail(ownerEmail).orElseThrow();
        assertThat(replaced.getTwoFactorSecret()).isEqualTo(newSecret);
        assertThat(replaced.getPendingTwoFactorSecret()).isNull();
    }

    @Test
    @DisplayName("a backup code is accepted as proof (someone who lost their phone can re-enrol)")
    void backupCodeAsProof() throws Exception {
        enableTwoFactorForOwner();
        call("setup", "{\"code\":\"abcde-fghjk\"}", 200);
        assertThat(userRepository.findByEmail(ownerEmail).orElseThrow().getBackupCodes()).isEmpty();
    }

    // ── disabling and regenerating ───────────────────────────────────────────

    @Test
    @DisplayName("disabling needs a valid code, then clears the secret and the backup codes")
    void disable() throws Exception {
        enableTwoFactorForOwner();
        call("disable", "{\"code\":\"000000\"}", 400);
        assertThat(userRepository.findByEmail(ownerEmail).orElseThrow().isTwoFactorEnabled()).isTrue();

        call("disable", "{\"code\":\"" + code(ACTIVE_SECRET) + "\"}", 200);
        User user = userRepository.findByEmail(ownerEmail).orElseThrow();
        assertThat(user.isTwoFactorEnabled()).isFalse();
        assertThat(user.getTwoFactorSecret()).isNull();
        assertThat(user.getBackupCodes()).isEmpty();
    }

    @Test
    @DisplayName("regenerating backup codes needs a valid code, and the old codes stop working")
    void regenerate() throws Exception {
        enableTwoFactorForOwner();
        call("backup-codes", "{\"code\":\"000000\"}", 400);

        JsonNode fresh = call("backup-codes", "{\"code\":\"" + code(ACTIVE_SECRET) + "\"}", 200);
        assertThat(fresh.get("backupCodes").size()).isEqualTo(10);
        User user = userRepository.findByEmail(ownerEmail).orElseThrow();
        assertThat(user.getBackupCodes()).doesNotContain(BackupCodes.hash("abcde-fghjk"));
    }

    @Test
    @DisplayName("backup codes can only be generated when 2FA is on")
    void regenerateNeedsTwoFactor() throws Exception {
        call("backup-codes", "{\"code\":\"123456\"}", 400);
    }

    // ── code guessing through the settings endpoints is limited too ─────────

    @Test
    @DisplayName("repeated wrong codes against the settings endpoints lock them, like the login step")
    void settingsEndpointsAreLockedOut() throws Exception {
        enableTwoFactorForOwner();
        for (int i = 0; i < 5; i++) call("disable", "{\"code\":\"000000\"}", 400);
        call("disable", "{\"code\":\"" + code(ACTIVE_SECRET) + "\"}", 429);
        assertThat(userRepository.findByEmail(ownerEmail).orElseThrow().isTwoFactorEnabled()).isTrue();
    }
}

package com.prowosma.backend.security;

import com.prowosma.backend.ProwosmaTestBase;
import com.prowosma.backend.model.User;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * GET /api/auth/profile and /api/users/me returned the raw User record: password hash, TOTP
 * secret, backup codes, refresh token, magic-link and guest tokens. The web app then copied the
 * whole response into localStorage. None of it may ever appear in a response.
 */
@DisplayName("User records never expose credentials or tokens")
class UserSecretsNotExposedTest extends ProwosmaTestBase {

    private void seedSecrets() {
        User user = userRepository.findByEmail(memberEmail).orElseThrow();
        user.setTwoFactorEnabled(true);
        user.setTwoFactorSecret("TOTPSECRET-VALUE-XYZ");
        user.setPendingTwoFactorSecret("PENDINGSECRET-VALUE-XYZ");
        user.setBackupCodes(new ArrayList<>(List.of("BACKUPHASH-VALUE-XYZ")));
        user.setRefreshToken("REFRESHTOKEN-VALUE-XYZ");
        user.setRefreshTokenExpiry(LocalDateTime.now().plusDays(1));
        user.setMagicLinkToken("MAGICLINK-VALUE-XYZ");
        user.setMagicLinkExpiry(LocalDateTime.now().plusHours(1));
        user.setEmailOtpCode("OTPCODE-VALUE-XYZ");
        user.setEmailOtpExpiry(LocalDateTime.now().plusHours(1));
        user.setGuestToken("GUESTTOKEN-VALUE-XYZ");
        user.setGuestTokenExpiry(LocalDateTime.now().plusDays(1));
        userRepository.save(user);
    }

    private void assertNoSecrets(String body) {
        assertThat(body).contains(memberEmail);                                  // the endpoint did return the user
        for (String secret : new String[]{"TOTPSECRET-VALUE-XYZ", "PENDINGSECRET-VALUE-XYZ", "BACKUPHASH-VALUE-XYZ",
                "REFRESHTOKEN-VALUE-XYZ", "MAGICLINK-VALUE-XYZ", "OTPCODE-VALUE-XYZ", "GUESTTOKEN-VALUE-XYZ"}) {
            assertThat(body).doesNotContain(secret);
        }
        for (String field : new String[]{"\"password\"", "twoFactorSecret", "pendingTwoFactorSecret", "backupCodes", "refreshToken",
                "magicLinkToken", "emailOtpCode", "guestToken", "twoFactorLastStep", "twoFactorFailedAttempts", "twoFactorLockedUntil"}) {
            assertThat(body).doesNotContain(field);
        }
    }

    @Test
    @DisplayName("GET /api/auth/profile")
    void authProfile() throws Exception {
        seedSecrets();
        String body = mvc.perform(get("/api/auth/profile").header("Authorization", authHeader(memberToken())))
           .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertNoSecrets(body);
        assertThat(body).doesNotContain("$2");                                    // no BCrypt hash
    }

    @Test
    @DisplayName("GET /api/users/me")
    void usersMe() throws Exception {
        seedSecrets();
        String body = mvc.perform(get("/api/users/me").header("Authorization", authHeader(memberToken())))
           .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertNoSecrets(body);
    }

    @Test
    @DisplayName("what the app really needs from the profile is still there")
    void usefulFieldsRemain() throws Exception {
        seedSecrets();
        String body = mvc.perform(get("/api/auth/profile").header("Authorization", authHeader(memberToken())))
           .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertThat(body).contains("\"name\"").contains("\"role\"").contains("twoFactorEnabled");
    }
}

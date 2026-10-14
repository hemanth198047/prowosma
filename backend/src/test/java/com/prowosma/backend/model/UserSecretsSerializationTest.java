package com.prowosma.backend.model;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/** GET /api/auth/profile returns the User record directly. Before this fix that included the password hash, the live 2FA secret and the magic-link login token. */
@DisplayName("User record: secrets are never sent to a browser")
class UserSecretsSerializationTest {

    private final ObjectMapper om = new ObjectMapper().findAndRegisterModules();

    private User user() {
        User u = new User();
        u.setName("Priya");
        u.setEmail("priya@acme.com");
        u.setPassword("$2a$10$HASHEDPASSWORDHASHEDPASSWORDHASHEDPASSWORDHASHED");
        u.setTwoFactorEnabled(true);
        u.setTwoFactorSecret("JBSWY3DPEHPK3PXP-LIVE-TOTP-SECRET");
        u.setPendingTwoFactorSecret("PENDING-TOTP-SECRET");
        u.setBackupCodes(List.of("hashedbackup1", "hashedbackup2"));
        u.setMagicLinkToken("magic-link-login-token-123");
        return u;
    }

    @Test @DisplayName("the response contains none of the five secret fields, nor any of their values")
    void secretsAreNotSerialized() throws Exception {
        String json = om.writeValueAsString(user());
        JsonNode n = om.readTree(json);
        for (String field : new String[]{"password", "twoFactorSecret", "pendingTwoFactorSecret", "backupCodes", "magicLinkToken"}) assertThat(n.has(field)).as(field).isFalse();
        assertThat(json).doesNotContain("HASHEDPASSWORD").doesNotContain("LIVE-TOTP-SECRET").doesNotContain("PENDING-TOTP").doesNotContain("hashedbackup").doesNotContain("magic-link-login-token");
    }

    @Test @DisplayName("everything the profile page needs is still there")
    void profileFieldsRemain() throws Exception {
        JsonNode n = om.readTree(om.writeValueAsString(user()));
        assertThat(n.get("name").asText()).isEqualTo("Priya");
        assertThat(n.get("email").asText()).isEqualTo("priya@acme.com");
        assertThat(n.get("twoFactorEnabled").asBoolean()).isTrue();                  // the on/off state is not a secret
    }

    @Test @DisplayName("accepting them as INPUT still works (registration and imports that send a password are unaffected)")
    void secretsAreStillAcceptedAsInput() throws Exception {
        User u = om.readValue("{\"name\":\"A\",\"email\":\"a@b.com\",\"password\":\"plain-pw\",\"magicLinkToken\":\"t\"}", User.class);
        assertThat(u.getPassword()).isEqualTo("plain-pw");
        assertThat(u.getMagicLinkToken()).isEqualTo("t");
    }
}

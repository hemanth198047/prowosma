package com.prowosma.backend.config;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@DisplayName("JWT secret guard — no login can ever be signed with a secret anyone could know")
class JwtSecretGuardTest {

    private static final String REAL = "k3J9xQ2mZp7LwV0tBn5RyD8sHc1UaFe4GiO6XjMq3NvTb9YzKdPh2WlAr5Es7CuS";

    @Test @DisplayName("a long random secret is accepted")
    void realSecretIsAccepted() {
        assertThatCode(() -> JwtSecretGuard.check(REAL, false)).doesNotThrowAnyException();
        assertThatCode(() -> JwtSecretGuard.check("test-secret-key-must-be-at-least-32-chars-long", false)).doesNotThrowAnyException();   // what the test suite uses
    }

    @Test @DisplayName("every secret that is published in the source code, config or compose file is refused — in any letter case, with spaces around it")
    void publishedSecretsAreRefused() {
        for (String published : new String[]{
                "prowosma-secret-key-must-be-at-least-32-chars-long",                                                         // the fallback hard-coded in JwtUtil
                "prowosma-dev-secret-key-min-64-chars-do-not-use-in-production-xxxxxxxx",                                      // the default in application.properties
                "local-dev-only-jwt-secret-min-64-chars-do-not-use-in-real-deployment-xxxxx",                                  // the default in docker-compose.yml
                "  PROWOSMA-DEV-SECRET-KEY-min-64-chars-do-not-use-in-production-xxxxxxxx  "}) {
            assertThatThrownBy(() -> JwtSecretGuard.check(published, false)).as(published).isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("visible in the project's source code").hasMessageContaining("openssl rand -base64 64");
        }
    }

    @Test @DisplayName("local development can opt in explicitly, and only for the published ones")
    void devOptIn() {
        assertThatCode(() -> JwtSecretGuard.check("prowosma-dev-secret-key-min-64-chars-do-not-use-in-production-xxxxxxxx", true)).doesNotThrowAnyException();
        assertThatThrownBy(() -> JwtSecretGuard.check("short", true)).isInstanceOf(IllegalStateException.class);               // opting in never allows a secret that cannot work
        assertThatThrownBy(() -> JwtSecretGuard.check("", true)).isInstanceOf(IllegalStateException.class);
    }

    @Test @DisplayName("empty, blank, missing and too-short secrets fail with a clear message instead of failing logins later")
    void unusableSecrets() {
        assertThatThrownBy(() -> JwtSecretGuard.check(null, false)).hasMessageContaining("JWT_SECRET is empty");
        assertThatThrownBy(() -> JwtSecretGuard.check("", false)).hasMessageContaining("JWT_SECRET is empty");
        assertThatThrownBy(() -> JwtSecretGuard.check("   ", false)).hasMessageContaining("JWT_SECRET is empty");
        assertThatThrownBy(() -> JwtSecretGuard.check("x".repeat(31), false)).hasMessageContaining("too short").hasMessageContaining("31 bytes");
        assertThatCode(() -> JwtSecretGuard.check("x".repeat(32), false)).doesNotThrowAnyException();                                // exactly the minimum
    }

    @Test @DisplayName("length is counted in bytes, so a short secret can't pass by using multi-byte characters as filler")
    void lengthIsInBytes() {
        assertThat("é".repeat(16).getBytes(java.nio.charset.StandardCharsets.UTF_8)).hasSize(32);
        assertThatCode(() -> JwtSecretGuard.check("é".repeat(16), false)).doesNotThrowAnyException();                                // 32 bytes is what HS256 needs
        assertThatThrownBy(() -> JwtSecretGuard.check("é".repeat(15), false)).hasMessageContaining("30 bytes");
    }

    @Test @DisplayName("a look-alike that merely CONTAINS a published phrase later on is not treated as published; only the start counts")
    void onlyPrefixesCount() {
        assertThat(JwtSecretGuard.isKnownPublished("my-own-" + "prowosma-dev-secret-key" + "-long-random-suffix-0123456789")).isFalse();
        assertThat(JwtSecretGuard.isKnownPublished(null)).isFalse();
        assertThat(JwtSecretGuard.isKnownPublished(REAL)).isFalse();
    }
}

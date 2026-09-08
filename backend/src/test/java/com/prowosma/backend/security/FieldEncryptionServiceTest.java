package com.prowosma.backend.security;

import com.prowosma.backend.service.FieldEncryptionService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.security.SecureRandom;
import java.util.Base64;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Verifies FieldEncryptionService's actual crypto behavior. The core
 * encrypt/decrypt/legacy-passthrough/tamper-detection logic here was
 * ALSO verified by directly compiling and running it as a standalone
 * Java program (`java SingleFile.java`, Java 21's source-launch feature)
 * outside this test suite during development, since a full Gradle build
 * wasn't runnable in that environment — this test suite is the permanent,
 * repo-resident version of that same verification.
 */
@DisplayName("FieldEncryptionService")
class FieldEncryptionServiceTest {

    private static String randomBase64Key() {
        byte[] key = new byte[32];
        new SecureRandom().nextBytes(key);
        return Base64.getEncoder().encodeToString(key);
    }

    @Test
    @DisplayName("With no key configured, encrypt/decrypt are no-ops (pre-existing plaintext behavior preserved)")
    void noKeyConfigured_isNoOp() {
        FieldEncryptionService svc = new FieldEncryptionService("");
        assertFalse(svc.isActive());
        assertEquals("plain-password", svc.encrypt("plain-password"));
        assertEquals("plain-password", svc.decrypt("plain-password"));
    }

    @Test
    @DisplayName("With a key configured, encrypt() produces a prefixed, non-plaintext value that decrypt() reverses")
    void withKey_roundTrips() {
        FieldEncryptionService svc = new FieldEncryptionService(randomBase64Key());
        assertTrue(svc.isActive());

        String original = "super-secret-smtp-password-123!";
        String encrypted = svc.encrypt(original);

        assertTrue(encrypted.startsWith("enc:v1:"));
        assertNotEquals(original, encrypted);
        assertEquals(original, svc.decrypt(encrypted));
    }

    @Test
    @DisplayName("Encrypting the same value twice produces different ciphertext (random IV per call)")
    void encryption_isNotDeterministic() {
        FieldEncryptionService svc = new FieldEncryptionService(randomBase64Key());
        String a = svc.encrypt("same-value");
        String b = svc.encrypt("same-value");
        assertNotEquals(a, b, "Reused IVs would be a real cryptographic weakness for GCM");
        assertEquals("same-value", svc.decrypt(a));
        assertEquals("same-value", svc.decrypt(b));
    }

    @Test
    @DisplayName("A value with no enc:v1: prefix passes through unchanged even with a key configured (legacy plaintext migration path)")
    void legacyPlaintext_passesThroughEvenWithKeyConfigured() {
        FieldEncryptionService svc = new FieldEncryptionService(randomBase64Key());
        assertEquals("old-plaintext-value", svc.decrypt("old-plaintext-value"));
    }

    @Test
    @DisplayName("Tampering with encrypted data is detected (GCM authentication tag) rather than silently decrypting garbage")
    void tamperedCiphertext_throws() {
        FieldEncryptionService svc = new FieldEncryptionService(randomBase64Key());
        String encrypted = svc.encrypt("original-value");
        String tampered = encrypted.substring(0, encrypted.length() - 4) + "abcd";

        assertThrows(IllegalStateException.class, () -> svc.decrypt(tampered));
    }

    @Test
    @DisplayName("An invalid key length is rejected at construction rather than failing later at encrypt time")
    void wrongKeyLength_rejectedAtStartup() {
        String tooShort = Base64.getEncoder().encodeToString(new byte[16]); // AES-128 length, not the required 32
        assertThrows(IllegalStateException.class, () -> new FieldEncryptionService(tooShort));
    }

    @Test
    @DisplayName("Decrypting a prefixed value with no key configured fails loudly instead of returning ciphertext as if it were plaintext")
    void encryptedValueWithNoKey_throwsRatherThanReturningGarbage() {
        FieldEncryptionService withKey = new FieldEncryptionService(randomBase64Key());
        String encrypted = withKey.encrypt("secret");

        FieldEncryptionService withoutKey = new FieldEncryptionService("");
        assertThrows(IllegalStateException.class, () -> withoutKey.decrypt(encrypted));
    }
}

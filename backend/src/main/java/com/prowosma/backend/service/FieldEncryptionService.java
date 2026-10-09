package com.prowosma.backend.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;

/**
 * Field-level encryption for sensitive values stored in MongoDB documents
 * that aren't already covered by transport/disk-level encryption alone —
 * starting with WorkspaceConfig.smtpPassword (see that field's own doc
 * comment, which was honest that it was plaintext at rest before this).
 *
 * AES-256-GCM: authenticated encryption (detects tampering, not just
 * confidentiality), the standard, well-reviewed choice for this — not a
 * home-grown scheme.
 *
 * Opt-in via ENCRYPTION_KEY (a base64-encoded 32-byte key — generate one
 * with `openssl rand -base64 32`). Unset: encrypt()/decrypt() both
 * pass values through UNCHANGED, so this deployment's behavior is
 * identical to before this class existed — zero risk to any environment
 * that hasn't set the key yet, consistent with every other opt-in
 * security control added in this backlog. Once set, PREVIOUSLY-STORED
 * plaintext values remain readable — decrypt() only attempts decryption on
 * values carrying this class's own "enc:v1:" prefix, and returns anything
 * else (including old plaintext) unchanged. This means turning encryption
 * on doesn't require a data migration for it to be safe: old values keep
 * working as plaintext until they're next re-saved (which re-encrypts
 * them, since encrypt() always encrypts once a key is configured).
 */
@Slf4j
@Service
public class FieldEncryptionService {

    private static final String PREFIX = "enc:v1:";
    private static final String ALGO = "AES/GCM/NoPadding";
    private static final int GCM_TAG_LENGTH_BITS = 128;
    private static final int GCM_IV_LENGTH_BYTES = 12;

    private final SecretKeySpec key;
    private final SecureRandom random = new SecureRandom();

    public FieldEncryptionService(@Value("${security.field-encryption-key:}") String base64Key) {
        if (base64Key == null || base64Key.isBlank()) {
            this.key = null;
            log.warn("[FieldEncryptionService] ENCRYPTION_KEY is not set — sensitive fields " +
                "(e.g. per-workspace SMTP passwords) are stored in PLAINTEXT. Generate a key with " +
                "`openssl rand -base64 32` and set ENCRYPTION_KEY before any real deployment. " +
                "See docs/SECURITY_HARDENING.md.");
            return;
        }
        byte[] decoded = Base64.getDecoder().decode(base64Key);
        if (decoded.length != 32) {
            throw new IllegalStateException("ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256) — " +
                "got " + decoded.length + ". Generate a correct one with `openssl rand -base64 32`.");
        }
        this.key = new SecretKeySpec(decoded, "AES");
        log.info("[FieldEncryptionService] Field-level encryption is ACTIVE.");
    }

    public boolean isActive() {
        return key != null;
    }

    /** No-op (returns the input unchanged) when no key is configured — see class comment. */
    public String encrypt(String plaintext) {
        if (key == null || plaintext == null) return plaintext;
        try {
            byte[] iv = new byte[GCM_IV_LENGTH_BYTES];
            random.nextBytes(iv);

            Cipher cipher = Cipher.getInstance(ALGO);
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv));
            byte[] ciphertext = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));

            byte[] combined = new byte[iv.length + ciphertext.length];
            System.arraycopy(iv, 0, combined, 0, iv.length);
            System.arraycopy(ciphertext, 0, combined, iv.length, ciphertext.length);

            return PREFIX + Base64.getEncoder().encodeToString(combined);
        } catch (Exception e) {
            // Fail closed on encryption errors — better to fail the save than
            // silently persist a sensitive value in plaintext due to a bug.
            throw new IllegalStateException("Field encryption failed", e);
        }
    }

    /**
     * Returns the input unchanged if it doesn't carry this class's own
     * prefix (covers both "no key configured" and "this is a
     * legacy/pre-encryption plaintext value" — see class comment) or if no
     * key is configured (can't decrypt without one; returning the raw
     * ciphertext-looking string would be worse than a clear failure in
     * that specific misconfiguration case).
     */
    public String decrypt(String stored) {
        if (stored == null || !stored.startsWith(PREFIX)) return stored;
        if (key == null) {
            throw new IllegalStateException("This value is encrypted (enc:v1: prefix present) but " +
                "ENCRYPTION_KEY is not set — cannot decrypt. Was the key rotated or removed?");
        }
        try {
            byte[] combined = Base64.getDecoder().decode(stored.substring(PREFIX.length()));
            byte[] iv = new byte[GCM_IV_LENGTH_BYTES];
            byte[] ciphertext = new byte[combined.length - GCM_IV_LENGTH_BYTES];
            System.arraycopy(combined, 0, iv, 0, iv.length);
            System.arraycopy(combined, iv.length, ciphertext, 0, ciphertext.length);

            Cipher cipher = Cipher.getInstance(ALGO);
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv));
            byte[] plaintext = cipher.doFinal(ciphertext);
            return new String(plaintext, StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new IllegalStateException("Field decryption failed — wrong ENCRYPTION_KEY, or data corruption", e);
        }
    }

    /**
     * Encrypts raw bytes (meeting audio) with the same AES-256-GCM key: a fresh random IV followed by the ciphertext. Returns the input unchanged when no key
     * is configured — callers that must never store plaintext (recordings) check {@link #isActive()} first.
     */
    public byte[] encryptBytes(byte[] plain) {
        if (key == null || plain == null) return plain;
        try {
            byte[] iv = new byte[GCM_IV_LENGTH_BYTES];
            random.nextBytes(iv);
            Cipher cipher = Cipher.getInstance(ALGO);
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv));
            byte[] ciphertext = cipher.doFinal(plain);
            byte[] combined = new byte[iv.length + ciphertext.length];
            System.arraycopy(iv, 0, combined, 0, iv.length);
            System.arraycopy(ciphertext, 0, combined, iv.length, ciphertext.length);
            return combined;
        } catch (Exception e) {
            throw new IllegalStateException("Field encryption failed", e);
        }
    }

    public byte[] decryptBytes(byte[] stored) {
        if (key == null || stored == null) return stored;
        try {
            byte[] iv = new byte[GCM_IV_LENGTH_BYTES];
            byte[] ciphertext = new byte[stored.length - GCM_IV_LENGTH_BYTES];
            System.arraycopy(stored, 0, iv, 0, iv.length);
            System.arraycopy(stored, iv.length, ciphertext, 0, ciphertext.length);
            Cipher cipher = Cipher.getInstance(ALGO);
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv));
            return cipher.doFinal(ciphertext);
        } catch (Exception e) {
            throw new IllegalStateException("Field decryption failed — wrong ENCRYPTION_KEY, or data corruption", e);
        }
    }
}

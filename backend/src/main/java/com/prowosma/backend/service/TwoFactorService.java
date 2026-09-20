package com.prowosma.backend.service;

import org.springframework.stereotype.Service;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.security.SecureRandom;
import java.util.Base64;

/**
 * RFC 6238 TOTP implementation — no external library needed.
 * Compatible with Google Authenticator, Authy, etc.
 */
@Service
public class TwoFactorService {

    private static final String BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    private static final int    WINDOW       = 1; // ±1 period tolerance (30s window)

    // ── Generate a new TOTP secret ────────────────────────────
    public String generateSecret() {
        byte[] bytes = new byte[20];
        new SecureRandom().nextBytes(bytes);
        return toBase32(bytes);
    }

    // ── Build otpauth:// URI for QR code ─────────────────────
    public String buildOtpAuthUri(String secret, String email, String issuer) {
        return String.format(
            "otpauth://totp/%s:%s?secret=%s&issuer=%s&algorithm=SHA1&digits=6&period=30",
            encode(issuer), encode(email), secret, encode(issuer));
    }

    // ── Build Google Charts QR URL ────────────────────────────
    public String buildQrUrl(String otpAuthUri) {
        return "https://api.qrserver.com/v1/create-qr-code/?size=200x200&data="
               + encode(otpAuthUri);
    }

    // ── Verify a 6-digit code ─────────────────────────────────
    public boolean verify(String secret, String code) {
        return matchStep(secret, code).isPresent();
    }

    /** The 30-second step a valid code belongs to (so a caller can refuse a code already used), or empty. */
    public java.util.OptionalLong matchStep(String secret, String code) {
        try {
            return com.prowosma.backend.auth.Totp.matchStep(secret, code, System.currentTimeMillis(), WINDOW);
        } catch (IllegalArgumentException malformedSecret) {
            return java.util.OptionalLong.empty();
        }
    }

    // -- Attempt limiting for second-factor codes (shared by login and the 2FA settings endpoints) --

    private static com.prowosma.backend.auth.LockoutPolicy.State lockState(com.prowosma.backend.model.User user) {
        return new com.prowosma.backend.auth.LockoutPolicy.State(
                user.getTwoFactorFailedAttempts(), user.getTwoFactorLockedUntil());
    }

    /** @throws org.springframework.web.server.ResponseStatusException 429 while the account's code entry is locked */
    public void requireNotLocked(com.prowosma.backend.model.User user) {
        java.time.Instant now = java.time.Instant.now();
        var state = lockState(user);
        if (com.prowosma.backend.auth.LockoutPolicy.isLocked(state, now)) {
            long minutes = Math.max(1, (com.prowosma.backend.auth.LockoutPolicy.remaining(state, now).toSeconds() + 59) / 60);
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.TOO_MANY_REQUESTS,
                    "Too many incorrect codes. Try again in " + minutes + " minute" + (minutes == 1 ? "" : "s") + ".");
        }
    }

    /** Counts a wrong code; the caller saves the user. */
    public void recordFailure(com.prowosma.backend.model.User user) {
        var next = com.prowosma.backend.auth.LockoutPolicy.afterFailure(lockState(user), java.time.Instant.now());
        user.setTwoFactorFailedAttempts(next.failures());
        user.setTwoFactorLockedUntil(next.lockedUntil());
    }

    /** Clears the count after a correct code; the caller saves the user. */
    public void recordSuccess(com.prowosma.backend.model.User user) {
        user.setTwoFactorFailedAttempts(0);
        user.setTwoFactorLockedUntil(null);
    }

    // ── Generate a code for a specific time window ────────────
    private String generateCode(String secret, long timeWindow) {
        try {
            byte[] key     = fromBase32(secret);
            byte[] msg     = ByteBuffer.allocate(8).putLong(timeWindow).array();
            Mac    mac     = Mac.getInstance("HmacSHA1");
            mac.init(new SecretKeySpec(key, "HmacSHA1"));
            byte[] hash    = mac.doFinal(msg);
            int    offset  = hash[hash.length - 1] & 0x0F;
            int    code    = ((hash[offset]     & 0x7F) << 24)
                           | ((hash[offset + 1] & 0xFF) << 16)
                           | ((hash[offset + 2] & 0xFF) <<  8)
                           |  (hash[offset + 3] & 0xFF);
            return String.format("%06d", code % 1_000_000);
        } catch (Exception e) {
            throw new RuntimeException("TOTP generation failed", e);
        }
    }

    // ── Base32 encode ─────────────────────────────────────────
    private String toBase32(byte[] bytes) {
        StringBuilder sb = new StringBuilder();
        int  buffer = 0, bitsLeft = 0;
        for (byte b : bytes) {
            buffer = (buffer << 8) | (b & 0xFF);
            bitsLeft += 8;
            while (bitsLeft >= 5) {
                sb.append(BASE32_CHARS.charAt((buffer >> (bitsLeft - 5)) & 31));
                bitsLeft -= 5;
            }
        }
        if (bitsLeft > 0) sb.append(BASE32_CHARS.charAt((buffer << (5 - bitsLeft)) & 31));
        return sb.toString();
    }

    // ── Base32 decode ─────────────────────────────────────────
    private byte[] fromBase32(String s) {
        s = s.toUpperCase().replaceAll("[^A-Z2-7]", "");
        byte[] output  = new byte[s.length() * 5 / 8];
        int    buffer  = 0, bitsLeft = 0, index = 0;
        for (char c : s.toCharArray()) {
            int val = BASE32_CHARS.indexOf(c);
            if (val < 0) continue;
            buffer = (buffer << 5) | val;
            bitsLeft += 5;
            if (bitsLeft >= 8) { output[index++] = (byte)(buffer >> (bitsLeft - 8)); bitsLeft -= 8; }
        }
        return java.util.Arrays.copyOf(output, index);
    }

    private String encode(String s) {
        return java.net.URLEncoder.encode(s, java.nio.charset.StandardCharsets.UTF_8);
    }
}

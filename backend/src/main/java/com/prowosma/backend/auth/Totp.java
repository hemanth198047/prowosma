package com.prowosma.backend.auth;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.OptionalLong;

/**
 * Time-based one-time passwords (RFC 6238, HMAC-SHA1, 6 digits, 30 s), as used by
 * Google Authenticator, Authy, 1Password and the like.
 *
 * {@link #matchStep} returns *which* 30-second step a code belongs to, not just yes/no. That is
 * what lets a caller refuse a code that was already used (RFC 6238 section 5.2: a verifier
 * must not accept a second attempt with the same one-time password).
 */
public final class Totp {

    public static final int DIGITS = 6;
    public static final int PERIOD_SECONDS = 30;
    private static final String BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

    private Totp() {}

    public static long stepAt(long epochMillis) {
        return epochMillis / 1000L / PERIOD_SECONDS;
    }

    public static String codeAt(String base32Secret, long step) {
        return hotp(decodeBase32(base32Secret), step, DIGITS);
    }

    /**
     * @param window how many steps either side of "now" to accept (1 = about +-30 s of clock drift)
     * @return the step the submitted code belongs to, or empty if it matches none
     */
    public static OptionalLong matchStep(String base32Secret, String submitted, long nowMillis, int window) {
        String code = normalize(submitted);
        if (code == null || base32Secret == null || base32Secret.isBlank()) return OptionalLong.empty();
        byte[] key = decodeBase32(base32Secret);
        byte[] wanted = code.getBytes(StandardCharsets.US_ASCII);
        long now = stepAt(nowMillis);
        long matched = -1;
        boolean found = false;
        for (long step = now - window; step <= now + window; step++) {
            byte[] candidate = hotp(key, step, DIGITS).getBytes(StandardCharsets.US_ASCII);
            if (MessageDigest.isEqual(candidate, wanted)) {     // constant time; every step is always checked
                matched = step;
                found = true;
            }
        }
        return found ? OptionalLong.of(matched) : OptionalLong.empty();
    }

    /** Six digits, tolerating the space or hyphen some apps insert (123 456); anything else is not a code. */
    static String normalize(String submitted) {
        if (submitted == null) return null;
        String s = submitted.replace(" ", "").replace("-", "");
        return s.matches("[0-9]{" + DIGITS + "}") ? s : null;
    }

    /** RFC 4226 HOTP. Public so the RFC's own test vectors (8 digits) can be checked. */
    public static String hotp(byte[] key, long counter, int digits) {
        try {
            Mac mac = Mac.getInstance("HmacSHA1");
            mac.init(new SecretKeySpec(key, "HmacSHA1"));
            byte[] hash = mac.doFinal(ByteBuffer.allocate(8).putLong(counter).array());
            int offset = hash[hash.length - 1] & 0x0F;
            int binary = ((hash[offset] & 0x7F) << 24) | ((hash[offset + 1] & 0xFF) << 16)
                    | ((hash[offset + 2] & 0xFF) << 8) | (hash[offset + 3] & 0xFF);
            long mod = 1;
            for (int i = 0; i < digits; i++) mod *= 10;
            return String.format("%0" + digits + "d", binary % mod);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("TOTP generation failed", e);
        }
    }

    public static byte[] decodeBase32(String s) {
        String clean = s.replace(" ", "").replace("-", "").replace("=", "").toUpperCase();
        ByteBuffer out = ByteBuffer.allocate(clean.length() * 5 / 8 + 1);
        int buffer = 0, bits = 0;
        for (char c : clean.toCharArray()) {
            int v = BASE32.indexOf(c);
            if (v < 0) throw new IllegalArgumentException("Not a base32 secret");
            buffer = (buffer << 5) | v;
            bits += 5;
            if (bits >= 8) {
                out.put((byte) ((buffer >> (bits - 8)) & 0xFF));
                bits -= 8;
            }
        }
        byte[] result = new byte[out.position()];
        out.flip();
        out.get(result);
        return result;
    }
}

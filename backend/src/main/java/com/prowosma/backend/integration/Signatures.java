package com.prowosma.backend.integration;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.HexFormat;

/** HMAC-SHA256 request signatures (Sentry signs every webhook body with the integration's client secret). */
public final class Signatures {

    private Signatures() {}

    public static String hmacSha256Hex(String secret, byte[] body) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(body));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Constant-time comparison; tolerates an optional {@code sha256=} prefix and hex case. */
    public static boolean matches(String secret, byte[] body, String signatureHeader) {
        if (secret == null || secret.isBlank() || signatureHeader == null) return false;
        String provided = signatureHeader.trim().toLowerCase();
        if (provided.startsWith("sha256=")) provided = provided.substring(7);
        String expected = hmacSha256Hex(secret, body);
        return MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8), provided.getBytes(StandardCharsets.UTF_8));
    }
}

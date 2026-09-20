package com.prowosma.backend.integration;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;
import java.util.regex.Pattern;

/**
 * The secret in a workspace's inbound webhook URL. It is generated once, shown once, and only
 * its SHA-256 hash is stored, so a leaked database or an integrations list does not leak
 * working URLs. 256 random bits make a fast unsalted hash appropriate (there is nothing to guess).
 */
public final class InboundTokens {

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Pattern SHAPE = Pattern.compile("[A-Za-z0-9_-]{43}");

    private InboundTokens() {}

    public static String generate() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    /** Cheap check so garbage is turned away before any database lookup. */
    public static boolean looksValid(String token) {
        return token != null && SHAPE.matcher(token).matches();
    }

    public static String hash(String token) {
        try {
            return HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}

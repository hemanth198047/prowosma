package com.prowosma.backend.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;

/**
 * One-time recovery codes for when the authenticator app is lost. They are shown to the user
 * once, and only their SHA-256 hashes are stored. Ten characters from a 31-letter alphabet
 * (about 49 bits) is far more than an online guesser can cover given the lockout, which is why
 * a fast hash is appropriate here.
 */
public final class BackupCodes {

    /** No i, l, o, 0 or 1: they are too easy to misread when copying a code by hand. */
    private static final String ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
    private static final int LENGTH = 10;
    private static final SecureRandom RANDOM = new SecureRandom();

    private BackupCodes() {}

    /** Codes formatted for display: {@code abcde-fghjk}. */
    public static List<String> generate(int count) {
        List<String> codes = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            StringBuilder sb = new StringBuilder();
            for (int j = 0; j < LENGTH; j++) {
                if (j == LENGTH / 2) sb.append('-');
                sb.append(ALPHABET.charAt(RANDOM.nextInt(ALPHABET.length())));
            }
            codes.add(sb.toString());
        }
        return codes;
    }

    /** Lower-case, letters and digits only, so "ABCDE FGHJK" and "abcde-fghjk" are the same code. */
    public static String normalize(String input) {
        return input == null ? "" : input.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
    }

    public static String hash(String code) {
        try {
            return HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(normalize(code).getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    public static List<String> hashAll(List<String> codes) {
        List<String> hashes = new ArrayList<>();
        for (String code : codes) hashes.add(hash(code));
        return hashes;
    }

    /**
     * @return the stored hashes with the matching one removed (a code works once), or
     *         {@code null} if the input matches none of them.
     */
    public static List<String> consume(List<String> storedHashes, String input) {
        if (storedHashes == null || normalize(input).length() != LENGTH) return null;
        byte[] wanted = hash(input).getBytes(StandardCharsets.UTF_8);
        int matchAt = -1;
        for (int i = 0; i < storedHashes.size(); i++) {         // check all of them: no early exit
            if (MessageDigest.isEqual(storedHashes.get(i).getBytes(StandardCharsets.UTF_8), wanted)) matchAt = i;
        }
        if (matchAt < 0) return null;
        List<String> remaining = new ArrayList<>(storedHashes);
        remaining.remove(matchAt);
        return remaining;
    }
}

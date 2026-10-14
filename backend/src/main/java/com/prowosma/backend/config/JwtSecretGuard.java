package com.prowosma.backend.config;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;

/**
 * Refuses to start the application with a JWT signing secret that anyone can know or that cannot work.
 *
 * Why: the secret that signs every login token has built-in development defaults that are visible in the source code. If a real deployment forgets
 * {@code JWT_SECRET} (or runs without the {@code prod} profile, which is the only thing that makes it mandatory), the default would be used silently — and
 * anyone who has read the code could mint a valid token for any user, including an admin. This check does not depend on which profile is active.
 *
 * Local development can opt in explicitly with {@code ALLOW_INSECURE_DEV_JWT=true}; tests use their own non-default secret and are unaffected.
 */
public final class JwtSecretGuard {

    private JwtSecretGuard() {}

    /** HS256 needs at least 256 bits; the signing library refuses anything shorter on first use, which would surface as failing logins instead of a clear startup error. */
    public static final int MIN_BYTES = 32;

    /** Prefixes of every secret that has been published in this project's source, configuration or compose files. */
    static final List<String> KNOWN_PUBLISHED_PREFIXES = List.of(
            "prowosma-secret-key-must-be",
            "prowosma-dev-secret-key",
            "local-dev-only-jwt-secret");

    public static boolean isKnownPublished(String secret) {
        if (secret == null) return false;
        String s = secret.trim().toLowerCase(Locale.ROOT);
        return KNOWN_PUBLISHED_PREFIXES.stream().anyMatch(s::startsWith);
    }

    /** @throws IllegalStateException with a plain, actionable message when the secret must not be used. */
    public static void check(String secret, boolean allowInsecureDev) {
        if (secret == null || secret.isBlank()) {
            throw new IllegalStateException("JWT_SECRET is empty. Set it to a long random value (for example: openssl rand -base64 64) and restart. "
                    + "Without it nobody could sign in securely.");
        }
        if (secret.getBytes(StandardCharsets.UTF_8).length < MIN_BYTES) {
            throw new IllegalStateException("JWT_SECRET is too short (" + secret.getBytes(StandardCharsets.UTF_8).length + " bytes; at least " + MIN_BYTES
                    + " are required, 64+ recommended). Generate one with: openssl rand -base64 64");
        }
        if (isKnownPublished(secret) && !allowInsecureDev) {
            throw new IllegalStateException("JWT_SECRET is set to a built-in development value that is visible in the project's source code, so anyone could forge a login for any user. "
                    + "Set JWT_SECRET to your own long random value (openssl rand -base64 64). For local development ONLY you can set ALLOW_INSECURE_DEV_JWT=true.");
        }
    }
}

package com.prowosma.backend.config;

import io.jsonwebtoken.*;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import javax.crypto.SecretKey;
import java.util.Date;

@Component
public class JwtUtil {

    @Value("${jwt.secret:prowosma-secret-key-must-be-at-least-32-chars-long}")
    private String secret;

    @Value("${jwt.expiration:86400000}")
    private long expiration;

    private SecretKey getKey() {
        return Keys.hmacShaKeyFor(secret.getBytes());
    }

    public String generateToken(String email) {
        return Jwts.builder()
                .subject(email)
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + expiration))
                .signWith(getKey())
                .compact();
    }

    /**
     * Same as generateToken(email), but embeds a session id (sid) claim
     * matching a User.LoginSession.id. This is what makes session
     * revocation and timeout/concurrency-cap enforcement real rather than
     * cosmetic — JwtFilter checks this claim against the user's live
     * session list on every request, so removing a session from that list
     * (revoke) or it going stale (idle timeout) or getting evicted (over
     * the concurrency cap) actually invalidates this specific token
     * immediately, instead of it staying valid until natural expiry.
     */
    public String generateToken(String email, String sessionId) {
        return Jwts.builder()
                .subject(email)
                .claim("sid", sessionId)
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + expiration))
                .signWith(getKey())
                .compact();
    }

    /** Null if this token has no session id (e.g. issued before this feature existed). */
    public String extractSessionId(String token) {
        try {
            return Jwts.parser().verifyWith(getKey()).build()
                    .parseSignedClaims(token).getPayload()
                    .get("sid", String.class);
        } catch (Exception e) {
            return null;
        }
    }

    public String extractEmail(String token) {
        return Jwts.parser()
                .verifyWith(getKey())
                .build()
                .parseSignedClaims(token)
                .getPayload()
                .getSubject();
    }

    /** A valid ACCESS token. A second-factor challenge token is signed with the same key but is not one. */
    public boolean isValid(String token) {
        try {
            var claims = Jwts.parser().verifyWith(getKey()).build().parseSignedClaims(token).getPayload();
            return claims.get(PURPOSE_CLAIM) == null;
        } catch (Exception e) {
            return false;
        }
    }

    private static final String PURPOSE_CLAIM = "purpose";
    private static final String PURPOSE_TWO_FACTOR = "2fa";
    private static final long   CHALLENGE_TTL_MS = 5 * 60 * 1000L;

    /**
     * Issued after a correct password when the account has 2FA on. It proves the password step
     * happened, nothing more: isValid() rejects it, so it can't be used as a session, and it is
     * only good for /api/auth/login/2fa, together with a valid code, for five minutes.
     */
    public String generateTwoFactorChallenge(String email) {
        return Jwts.builder()
                .subject(email)
                .claim(PURPOSE_CLAIM, PURPOSE_TWO_FACTOR)
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + CHALLENGE_TTL_MS))
                .signWith(getKey())
                .compact();
    }

    /** The email of a valid, unexpired second-factor challenge; null for anything else (including access tokens). */
    public String extractTwoFactorChallengeEmail(String token) {
        try {
            var claims = Jwts.parser().verifyWith(getKey()).build().parseSignedClaims(token).getPayload();
            return PURPOSE_TWO_FACTOR.equals(claims.get(PURPOSE_CLAIM, String.class)) ? claims.getSubject() : null;
        } catch (Exception e) {
            return null;
        }
    }
}
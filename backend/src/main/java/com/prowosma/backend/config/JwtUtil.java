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

    public boolean isValid(String token) {
        try {
            Jwts.parser().verifyWith(getKey()).build().parseSignedClaims(token);
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
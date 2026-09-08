package com.prowosma.backend.service;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.math.BigInteger;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.spec.RSAPublicKeySpec;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Auth0TokenVerifier — genuinely verifies an Auth0-issued ID token
 * server-side before trusting anything in it.
 *
 * This is what was missing before: the old /api/auth/sso-login endpoint
 * (and the old /api/auth/social-login endpoint) took a client-supplied
 * email/name at face value with no proof they came from a real Auth0
 * session — anyone could POST any email directly to those endpoints and
 * get a real JWT for that account.
 *
 * How this actually verifies the token:
 *   1. Read the token header (without trusting it yet) to get the key ID (kid).
 *   2. Fetch Auth0's public JWKS (https://{domain}/.well-known/jwks.json)
 *      and find the matching RSA public key — cached for an hour so this
 *      isn't a network call on every login.
 *   3. Verify the token's RS256 signature against that public key. This is
 *      the step that actually proves the token was issued by Auth0 and
 *      hasn't been tampered with — a forged token fails here.
 *   4. Verify issuer (https://{domain}/), audience (our client ID), and
 *      expiry, which jjwt checks automatically once a valid signing key is
 *      supplied.
 *   5. Only then return the verified email claim — never trust a
 *      client-supplied email alongside the token.
 */
@Slf4j
@Service
public class Auth0TokenVerifier {

    @Value("${auth0.domain}")
    private String domain;

    @Value("${auth0.audience}")
    private String audience;

    private final RestTemplate restTemplate = new RestTemplate();
    private final Map<String, CachedKey> keyCache = new ConcurrentHashMap<>();
    private static final long CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

    private record CachedKey(PublicKey key, long fetchedAt) {}

    public static class TokenVerificationException extends RuntimeException {
        public TokenVerificationException(String message) { super(message); }
        public TokenVerificationException(String message, Throwable cause) { super(message, cause); }
    }

    /**
     * Verifies the given Auth0 ID token and returns its claims. Throws
     * TokenVerificationException with a clear reason if the token is
     * missing, malformed, expired, signed by the wrong key, or issued for
     * the wrong tenant/audience.
     */
    public Claims verify(String idToken) {
        if (idToken == null || idToken.isBlank()) {
            throw new TokenVerificationException("No ID token provided");
        }

        String kid = extractKidFromHeader(idToken);

        if (kid == null) {
            throw new TokenVerificationException("Token has no key ID (kid) - can't verify");
        }

        PublicKey publicKey = getPublicKey(kid);

        try {
            Claims claims = Jwts.parser()
                    .verifyWith(publicKey)
                    .requireIssuer("https://" + domain + "/")
                    .build()
                    .parseSignedClaims(idToken)
                    .getPayload();

            // Audience can be a single string or an array depending on the
            // token - check both shapes rather than assuming.
            Object aud = claims.get("aud");
            boolean audienceOk = audience.equals(aud) ||
                    (aud instanceof List<?> list && list.contains(audience));
            if (!audienceOk) {
                throw new TokenVerificationException("Token was not issued for this application");
            }

            return claims;
        } catch (TokenVerificationException e) {
            throw e;
        } catch (Exception e) {
            throw new TokenVerificationException("Token signature/claims verification failed: " + e.getMessage(), e);
        }
    }

    /** Convenience — verify and return just the verified email claim. */
    public String verifyAndGetEmail(String idToken) {
        Claims claims = verify(idToken);
        String email = claims.get("email", String.class);
        if (email == null || email.isBlank()) {
            throw new TokenVerificationException("Verified token has no email claim");
        }
        return email;
    }

    private String extractKidFromHeader(String jwt) {
        try {
            String headerPart = jwt.split("\\.")[0];
            String headerJson = new String(Base64.getUrlDecoder().decode(headerPart));
            // Tiny manual extract - avoids pulling in a JSON library just for one field
            int idx = headerJson.indexOf("\"kid\"");
            if (idx < 0) return null;
            int colon = headerJson.indexOf(':', idx);
            int firstQuote = headerJson.indexOf('"', colon + 1);
            int secondQuote = headerJson.indexOf('"', firstQuote + 1);
            return headerJson.substring(firstQuote + 1, secondQuote);
        } catch (Exception e) {
            return null;
        }
    }


    @SuppressWarnings("unchecked")
    private PublicKey getPublicKey(String kid) {
        CachedKey cached = keyCache.get(kid);
        if (cached != null && System.currentTimeMillis() - cached.fetchedAt() < CACHE_TTL_MS) {
            return cached.key();
        }

        String jwksUrl = "https://" + domain + "/.well-known/jwks.json";
        Map<String, Object> jwks;
        try {
            jwks = restTemplate.getForObject(jwksUrl, Map.class);
        } catch (Exception e) {
            throw new TokenVerificationException("Could not reach Auth0 to verify token (" + jwksUrl + "): " + e.getMessage(), e);
        }
        if (jwks == null || !(jwks.get("keys") instanceof List<?> keys)) {
            throw new TokenVerificationException("Auth0 JWKS response was empty or malformed");
        }

        for (Object keyObj : keys) {
            Map<String, Object> keyMap = (Map<String, Object>) keyObj;
            if (!kid.equals(keyMap.get("kid"))) continue;

            try {
                byte[] nBytes = Base64.getUrlDecoder().decode((String) keyMap.get("n"));
                byte[] eBytes = Base64.getUrlDecoder().decode((String) keyMap.get("e"));
                BigInteger modulus = new BigInteger(1, nBytes);
                BigInteger exponent = new BigInteger(1, eBytes);
                PublicKey publicKey = KeyFactory.getInstance("RSA")
                        .generatePublic(new RSAPublicKeySpec(modulus, exponent));
                keyCache.put(kid, new CachedKey(publicKey, System.currentTimeMillis()));
                return publicKey;
            } catch (Exception e) {
                throw new TokenVerificationException("Could not build public key from Auth0 JWKS entry: " + e.getMessage(), e);
            }
        }

        throw new TokenVerificationException("No matching key found in Auth0's JWKS for this token (kid=" + kid + ")");
    }
}

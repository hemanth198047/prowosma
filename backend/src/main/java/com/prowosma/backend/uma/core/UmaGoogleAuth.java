package com.prowosma.backend.uma.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.integration.GoogleHttp;
import com.prowosma.backend.service.FieldEncryptionService;
import com.prowosma.backend.uma.model.UmaGoogleConnection;
import com.prowosma.backend.uma.model.UmaOAuthState;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.*;

/**
 * The AI Meeting Assistant's own Google sign-in (OAuth 2 with PKCE). Separate from the existing assistant's sign-in because it also asks
 * for Calendar access (to create Google Meet meetings and find upcoming ones). Uses the same Google OAuth client, with its own redirect URI.
 * Tokens are stored encrypted; nothing is stored unless the server has an encryption key.
 */
@Component
@Slf4j
public class UmaGoogleAuth {
    public static final String MEET_SCOPE = "https://www.googleapis.com/auth/meetings.space.readonly";
    public static final String CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
    static final String SCOPES = "openid email " + MEET_SCOPE + " " + CALENDAR_SCOPE;
    private static final String AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
    private static final String TOKEN_URL = "https://oauth2.googleapis.com/token";
    private static final String REVOKE_URL = "https://oauth2.googleapis.com/revoke";
    private static final SecureRandom RANDOM = new SecureRandom();

    private final UmaGoogleHttp http;
    private final MongoTemplate mongo;
    private final FieldEncryptionService crypto;
    private final ObjectMapper om = new ObjectMapper();

    @Value("${app.uma.google.client-id:${app.meeting-assistant.google.client-id:${GOOGLE_MEET_OAUTH_CLIENT_ID:}}}") private String clientId = "";
    @Value("${app.uma.google.client-secret:${app.meeting-assistant.google.client-secret:${GOOGLE_MEET_OAUTH_CLIENT_SECRET:}}}") private String clientSecret = "";
    @Value("${app.uma.google.redirect-uri:}") private String redirectSetting = "";
    @Value("${app.frontend.url:http://localhost:5173}") private String frontendUrl = "http://localhost:5173";

    public UmaGoogleAuth(UmaGoogleHttp http, MongoTemplate mongo, FieldEncryptionService crypto) {
        this.http = http; this.mongo = mongo; this.crypto = crypto;
    }

    public boolean configured() { return clientId != null && !clientId.isBlank() && clientSecret != null && !clientSecret.isBlank(); }
    public boolean canStoreTokens() { return crypto.isActive(); }

    public String redirectUri() {
        if (redirectSetting != null && !redirectSetting.isBlank()) return redirectSetting.trim();
        return frontendUrl.replaceAll("/+$", "") + "/ai-meeting-assistant/google-callback";
    }

    private void requireReady() {
        if (!configured()) throw new UmaException(HttpStatus.CONFLICT, "GOOGLE_NOT_CONFIGURED", "Google isn't switched on for this service yet.",
                "Ask your Prowosma administrator to switch on the Google connection. Until then you can upload or paste the transcript.");
        if (!crypto.isActive()) throw new UmaException(HttpStatus.CONFLICT, "ENCRYPTION_NOT_CONFIGURED", "Sign-ins can't be saved safely yet.",
                "Ask your Prowosma administrator to finish the security setup (the server's encryption key).");
    }

    public String authorizeUrl(String org, String email) {
        requireReady();
        String user = email.toLowerCase(Locale.ROOT);
        String state = randomUrlSafe(32), verifier = randomUrlSafe(48);
        mongo.remove(new Query(Criteria.where("organizationId").is(org).and("userEmail").is(user).and("provider").ne("MICROSOFT")), UmaOAuthState.class);
        UmaOAuthState st = new UmaOAuthState();
        st.setOrganizationId(org); st.setUserEmail(user); st.setStateHash(sha256Hex(state));
        st.setCodeVerifierEnc(crypto.encrypt(verifier)); st.setExpiresAt(Instant.now().plusSeconds(600));
        mongo.insert(st);
        Map<String, String> q = new LinkedHashMap<>();
        q.put("response_type", "code"); q.put("client_id", clientId); q.put("redirect_uri", redirectUri()); q.put("scope", SCOPES);
        q.put("state", state); q.put("access_type", "offline"); q.put("prompt", "consent"); q.put("include_granted_scopes", "true");
        q.put("code_challenge", base64Url(sha256(verifier))); q.put("code_challenge_method", "S256");
        return AUTH_URL + "?" + form(q);
    }

    public UmaGoogleConnection complete(String org, String email, String code, String state) {
        requireReady();
        if (code == null || code.isBlank() || state == null || state.isBlank()) throw invalidState();
        String user = email.toLowerCase(Locale.ROOT);
        UmaOAuthState st = mongo.findAndRemove(new Query(Criteria.where("stateHash").is(sha256Hex(state))), UmaOAuthState.class);   // single use
        if (st == null || !org.equals(st.getOrganizationId()) || !user.equals(st.getUserEmail()) || st.getExpiresAt().isBefore(Instant.now())
                || "MICROSOFT".equals(st.getProvider()))
            throw invalidState();
        Map<String, String> body = new LinkedHashMap<>();
        body.put("code", code); body.put("client_id", clientId); body.put("client_secret", clientSecret);
        body.put("redirect_uri", redirectUri()); body.put("grant_type", "authorization_code");
        body.put("code_verifier", crypto.decrypt(st.getCodeVerifierEnc()));
        JsonNode r = tokenCall(body);
        String access = r.path("access_token").asText(""), refresh = r.path("refresh_token").asText("");
        if (access.isEmpty()) throw new UmaException(HttpStatus.BAD_GATEWAY, "GOOGLE_ERROR", "Google didn't complete the sign-in. Please try again.");
        if (refresh.isEmpty()) throw new UmaException(HttpStatus.BAD_REQUEST, "NO_REFRESH_TOKEN", "Google didn't grant lasting access.",
                "Remove Prowosma under your Google account's third-party access, then connect again.");
        List<String> granted = Arrays.asList(r.path("scope").asText("").split("\\s+"));
        UmaGoogleConnection c = connection(org, user).orElseGet(UmaGoogleConnection::new);
        c.setOrganizationId(org); c.setUserEmail(user);
        c.setAccessTokenEnc(crypto.encrypt(access)); c.setRefreshTokenEnc(crypto.encrypt(refresh));
        c.setAccessTokenExpiresAt(Instant.now().plusSeconds(Math.max(60, r.path("expires_in").asLong(3600))));
        c.setScopes(new ArrayList<>(granted));
        c.setAccount(emailFromIdToken(r.path("id_token").asText("")));
        c.setStatus("ACTIVE"); c.setUpdatedAt(Instant.now());
        return mongo.save(c);
    }

    public Optional<UmaGoogleConnection> connection(String org, String email) {
        if (org == null || email == null) return Optional.empty();
        return Optional.ofNullable(mongo.findOne(new Query(Criteria.where("organizationId").is(org)
                .and("userEmail").is(email.toLowerCase(Locale.ROOT))), UmaGoogleConnection.class));
    }

    public boolean active(String org, String email) { return connection(org, email).filter(c -> "ACTIVE".equals(c.getStatus())).isPresent(); }

    public boolean hasScope(String org, String email, String scope) {
        return connection(org, email).map(c -> c.getScopes().contains(scope)).orElse(false);
    }

    public UmaGoogleConnection save(UmaGoogleConnection c) { c.setUpdatedAt(Instant.now()); return mongo.save(c); }

    /** A valid access token, refreshed when needed. */
    public String accessToken(String org, String email) {
        UmaGoogleConnection c = connection(org, email).orElseThrow(() -> new UmaException(HttpStatus.CONFLICT, "GOOGLE_NOT_CONNECTED",
                "Your Google account isn't connected.", "Connect it under Connections on the AI Meeting Assistant page."));
        if (!"ACTIVE".equals(c.getStatus())) throw reauth();
        if (c.getAccessTokenExpiresAt() != null && c.getAccessTokenExpiresAt().isAfter(Instant.now().plusSeconds(60)))
            return crypto.decrypt(c.getAccessTokenEnc());
        requireReady();
        Map<String, String> body = new LinkedHashMap<>();
        body.put("client_id", clientId); body.put("client_secret", clientSecret);
        body.put("refresh_token", crypto.decrypt(c.getRefreshTokenEnc())); body.put("grant_type", "refresh_token");
        JsonNode r;
        try { r = tokenCall(body); }
        catch (UmaException e) {
            if ("GOOGLE_REJECTED".equals(e.getCode())) { c.setStatus("NEEDS_REAUTH"); save(c); throw reauth(); }
            throw e;
        }
        String access = r.path("access_token").asText("");
        if (access.isEmpty()) throw new UmaException(HttpStatus.BAD_GATEWAY, "GOOGLE_ERROR", "Google didn't return an access token.", "Try again.");
        c.setAccessTokenEnc(crypto.encrypt(access));
        c.setAccessTokenExpiresAt(Instant.now().plusSeconds(Math.max(60, r.path("expires_in").asLong(3600))));
        save(c);
        return access;
    }

    public void disconnect(String org, String email) {
        Optional<UmaGoogleConnection> c = connection(org, email);
        if (c.isEmpty()) return;
        try {
            String token = crypto.decrypt(c.get().getRefreshTokenEnc());
            if (token != null) http.send("POST", REVOKE_URL, Map.of("Content-Type", "application/x-www-form-urlencoded"), form(Map.of("token", token)));
        } catch (IOException | RuntimeException e) {
            log.warn("uma google: revoke failed ({}); tokens deleted regardless", e.getClass().getSimpleName());
        }
        mongo.remove(c.get());
    }

    private JsonNode tokenCall(Map<String, String> body) {
        GoogleHttp.Result r;
        try { r = http.send("POST", TOKEN_URL, Map.of("Content-Type", "application/x-www-form-urlencoded"), form(body)); }
        catch (IOException e) { throw new UmaException(HttpStatus.SERVICE_UNAVAILABLE, "GOOGLE_UNAVAILABLE", "Couldn't reach Google.", "Try again in a moment."); }
        if (r.status() >= 500 || r.status() == 429) throw new UmaException(HttpStatus.SERVICE_UNAVAILABLE, "GOOGLE_UNAVAILABLE", "Google had a problem.", "Try again in a moment.");
        if (r.status() < 200 || r.status() >= 300) throw new UmaException(HttpStatus.BAD_REQUEST, "GOOGLE_REJECTED", "Google didn't accept the sign-in.", "Connect your Google account again.");
        try { return om.readTree(r.body()); }
        catch (IOException e) { throw new UmaException(HttpStatus.BAD_GATEWAY, "GOOGLE_BAD_RESPONSE", "Google's reply couldn't be read.", "Try again."); }
    }

    private static UmaException invalidState() {
        return new UmaException(HttpStatus.BAD_REQUEST, "INVALID_STATE", "This sign-in link has expired or was already used.", "Start again from Connections.");
    }

    private static UmaException reauth() {
        return new UmaException(HttpStatus.CONFLICT, "GOOGLE_REAUTH_REQUIRED", "Google asked for a new sign-in.", "Connect your Google account again under Connections.");
    }

    private String emailFromIdToken(String idToken) {
        try {
            String[] parts = idToken.split("\\.");
            if (parts.length < 2) return null;
            String email = om.readTree(Base64.getUrlDecoder().decode(parts[1])).path("email").asText("");
            return email.isEmpty() ? null : email;
        } catch (IOException | IllegalArgumentException e) { return null; }
    }

    static String form(Map<String, String> m) {
        StringJoiner j = new StringJoiner("&");
        m.forEach((k, v) -> j.add(URLEncoder.encode(k, StandardCharsets.UTF_8) + "=" + URLEncoder.encode(v, StandardCharsets.UTF_8)));
        return j.toString();
    }

    private static String randomUrlSafe(int bytes) { byte[] b = new byte[bytes]; RANDOM.nextBytes(b); return base64Url(b); }
    private static String base64Url(byte[] b) { return Base64.getUrlEncoder().withoutPadding().encodeToString(b); }
    private static byte[] sha256(String s) {
        try { return MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)); }
        catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
    private static String sha256Hex(String s) { return HexFormat.of().formatHex(sha256(s)); }
}

package com.prowosma.backend.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.integration.GoogleApiException;
import com.prowosma.backend.integration.GoogleHttp;
import com.prowosma.backend.model.MeetingOAuthState;
import com.prowosma.backend.model.MeetingUserConnection;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.*;

/**
 * Per-person Google sign-in for the Meet REST API (which supports user authentication only).
 * - Least privilege: openid+email (to show which account) and meetings.space.readonly (to read transcripts).
 * - Tokens are stored only through FieldEncryptionService; if encryption is not active nothing is stored.
 * - The sign-in is bound to the person and workspace that started it with a single-use state and PKCE.
 * - Tokens, codes and response bodies are never logged.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class GoogleOAuthService {

    public static final String PROVIDER = "GOOGLE_MEET";
    static final String MEET_SCOPE = "https://www.googleapis.com/auth/meetings.space.readonly";
    static final String SCOPES = "openid email " + MEET_SCOPE;
    private static final String AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
    private static final String TOKEN_URL = "https://oauth2.googleapis.com/token";
    private static final String REVOKE_URL = "https://oauth2.googleapis.com/revoke";
    private static final long STATE_TTL_SECONDS = 600;
    private static final SecureRandom RANDOM = new SecureRandom();

    @Value("${app.meeting-assistant.google.client-id:${GOOGLE_MEET_OAUTH_CLIENT_ID:}}")
    private String clientId;
    @Value("${app.meeting-assistant.google.client-secret:${GOOGLE_MEET_OAUTH_CLIENT_SECRET:}}")
    private String clientSecret;
    @Value("${app.meeting-assistant.google.redirect-uri:${GOOGLE_MEET_OAUTH_REDIRECT_URI:}}")
    private String redirectUriSetting;
    @Value("${app.frontend.url:http://localhost:5173}")
    private String frontendUrl;

    private final GoogleHttp http;
    private final FieldEncryptionService crypto;
    private final MongoTemplate mongo;
    private final ObjectMapper om = new ObjectMapper();

    // ── configuration ─────────────────────────────────────────────────────────

    public boolean isConfigured() {
        return clientId != null && !clientId.isBlank() && clientSecret != null && !clientSecret.isBlank();
    }

    public boolean canStoreTokens() { return crypto.isActive(); }

    public String redirectUri() {
        if (redirectUriSetting != null && !redirectUriSetting.isBlank()) return redirectUriSetting;
        return frontendUrl.replaceAll("/+$", "") + "/integrations/meeting-platforms/google-callback";
    }

    private void requireReady() {
        if (!isConfigured())
            throw new MeetingAssistantException(HttpStatus.CONFLICT, "GOOGLE_NOT_CONFIGURED",
                    "Google sign-in isn't set up on the server yet. Ask an admin to add the Google OAuth client ID and secret.");
        if (!crypto.isActive())
            throw new MeetingAssistantException(HttpStatus.CONFLICT, "ENCRYPTION_NOT_CONFIGURED",
                    "Saved sign-ins must be encrypted, and encryption isn't configured on the server. Ask an admin to set ENCRYPTION_KEY.");
    }

    // ── connect flow ──────────────────────────────────────────────────────────

    public String authorizeUrl(String org, String email) {
        requireReady();
        String user = email.toLowerCase(Locale.ROOT);
        String state = randomUrlSafe(32);
        String verifier = randomUrlSafe(48);
        mongo.remove(new Query(Criteria.where("organizationId").is(org).and("userEmail").is(user).and("provider").is(PROVIDER)),
                MeetingOAuthState.class);
        MeetingOAuthState st = new MeetingOAuthState();
        st.setOrganizationId(org);
        st.setUserEmail(user);
        st.setProvider(PROVIDER);
        st.setStateHash(sha256Hex(state));
        st.setCodeVerifierEnc(crypto.encrypt(verifier));
        st.setExpiresAt(Instant.now().plusSeconds(STATE_TTL_SECONDS));
        mongo.insert(st);

        Map<String, String> q = new LinkedHashMap<>();
        q.put("response_type", "code");
        q.put("client_id", clientId);
        q.put("redirect_uri", redirectUri());
        q.put("scope", SCOPES);
        q.put("state", state);
        q.put("access_type", "offline");
        q.put("prompt", "consent");   // guarantees a refresh token
        q.put("code_challenge", base64Url(sha256(verifier)));
        q.put("code_challenge_method", "S256");
        return AUTH_URL + "?" + form(q);
    }

    public MeetingUserConnection complete(String org, String email, String code, String state) {
        requireReady();
        if (code == null || code.isBlank() || state == null || state.isBlank())
            throw invalidState();
        String user = email.toLowerCase(Locale.ROOT);
        // Single use: the state is removed the moment it is looked up, whether or not the rest succeeds.
        MeetingOAuthState st = mongo.findAndRemove(new Query(Criteria.where("stateHash").is(sha256Hex(state))), MeetingOAuthState.class);
        if (st == null || !org.equals(st.getOrganizationId()) || !user.equals(st.getUserEmail())
                || st.getExpiresAt() == null || st.getExpiresAt().isBefore(Instant.now())) {
            throw invalidState();
        }
        Map<String, String> body = new LinkedHashMap<>();
        body.put("code", code);
        body.put("client_id", clientId);
        body.put("client_secret", clientSecret);
        body.put("redirect_uri", redirectUri());
        body.put("grant_type", "authorization_code");
        body.put("code_verifier", crypto.decrypt(st.getCodeVerifierEnc()));
        JsonNode r = tokenCall(body);

        String refresh = r.path("refresh_token").asText("");
        String access = r.path("access_token").asText("");
        if (access.isEmpty()) throw new MeetingAssistantException(HttpStatus.BAD_GATEWAY, "GOOGLE_ERROR", "Google didn't complete the sign-in. Please try again.");
        if (refresh.isEmpty())
            throw new MeetingAssistantException(HttpStatus.BAD_REQUEST, "NO_REFRESH_TOKEN",
                    "Google didn't grant lasting access. Remove Prowosma under your Google account's third-party access, then connect again.");
        List<String> granted = Arrays.asList(r.path("scope").asText("").split("\\s+"));
        if (!granted.contains(MEET_SCOPE))
            throw new MeetingAssistantException(HttpStatus.BAD_REQUEST, "MISSING_SCOPE",
                    "Please allow access to meeting information, otherwise transcripts can't be imported.");

        MeetingUserConnection c = connection(org, user).orElseGet(MeetingUserConnection::new);
        c.setOrganizationId(org);
        c.setUserEmail(user);
        c.setProvider(PROVIDER);
        c.setAccessTokenEnc(crypto.encrypt(access));
        c.setRefreshTokenEnc(crypto.encrypt(refresh));
        c.setAccessTokenExpiresAt(Instant.now().plusSeconds(Math.max(60, r.path("expires_in").asLong(3600))));
        c.setScopes(new ArrayList<>(granted));
        c.setAccount(emailFromIdToken(r.path("id_token").asText("")));
        c.setStatus("ACTIVE");
        c.setUpdatedAt(Instant.now());
        return mongo.save(c);
    }

    private static MeetingAssistantException invalidState() {
        return new MeetingAssistantException(HttpStatus.BAD_REQUEST, "INVALID_STATE",
                "This sign-in link has expired or was already used. Please start again.");
    }

    // ── tokens ────────────────────────────────────────────────────────────────

    public Optional<MeetingUserConnection> connection(String org, String email) {
        if (org == null || email == null) return Optional.empty();
        return Optional.ofNullable(mongo.findOne(new Query(Criteria.where("organizationId").is(org)
                .and("userEmail").is(email.toLowerCase(Locale.ROOT)).and("provider").is(PROVIDER)), MeetingUserConnection.class));
    }

    public boolean hasActiveConnection(String org, String email) {
        return connection(org, email).filter(c -> "ACTIVE".equals(c.getStatus())).isPresent();
    }

    public long activeCount(String org) {
        return mongo.count(new Query(Criteria.where("organizationId").is(org).and("provider").is(PROVIDER).and("status").is("ACTIVE")),
                MeetingUserConnection.class);
    }

    /** A valid access token for this person, refreshing it if needed. */
    public String accessToken(String org, String email) {
        MeetingUserConnection c = connection(org, email).orElseThrow(() ->
                new MeetingAssistantException(HttpStatus.CONFLICT, "GOOGLE_NOT_CONNECTED",
                        "Connect your Google account first."));
        if (!"ACTIVE".equals(c.getStatus())) throw reauth();
        if (c.getAccessTokenExpiresAt() != null && c.getAccessTokenExpiresAt().isAfter(Instant.now().plusSeconds(60))) {
            return crypto.decrypt(c.getAccessTokenEnc());
        }
        requireReady();
        Map<String, String> body = new LinkedHashMap<>();
        body.put("client_id", clientId);
        body.put("client_secret", clientSecret);
        body.put("refresh_token", crypto.decrypt(c.getRefreshTokenEnc()));
        body.put("grant_type", "refresh_token");
        JsonNode r;
        try {
            r = tokenCall(body);
        } catch (MeetingAssistantException e) {
            if ("GOOGLE_REJECTED".equals(e.getCode())) {      // revoked, expired or password-changed: needs a fresh sign-in
                c.setStatus("NEEDS_REAUTH");
                c.setUpdatedAt(Instant.now());
                mongo.save(c);
                throw reauth();
            }
            throw e;
        }
        String access = r.path("access_token").asText("");
        if (access.isEmpty()) throw new GoogleApiException(GoogleApiException.Kind.BAD_RESPONSE, "No access token");
        c.setAccessTokenEnc(crypto.encrypt(access));
        c.setAccessTokenExpiresAt(Instant.now().plusSeconds(Math.max(60, r.path("expires_in").asLong(3600))));
        c.setUpdatedAt(Instant.now());
        mongo.save(c);
        return access;
    }

    private static MeetingAssistantException reauth() {
        return new MeetingAssistantException(HttpStatus.CONFLICT, "GOOGLE_REAUTH_REQUIRED",
                "Google access was removed or expired. Reconnect your Google account.");
    }

    /** Revokes at Google (best effort) and deletes the stored tokens. */
    public void disconnect(String org, String email) {
        Optional<MeetingUserConnection> c = connection(org, email);
        if (c.isEmpty()) return;
        try {
            String token = crypto.isActive() ? crypto.decrypt(c.get().getRefreshTokenEnc()) : null;
            if (token != null) {
                http.send("POST", REVOKE_URL, Map.of("Content-Type", "application/x-www-form-urlencoded"),
                        form(Map.of("token", token)));
            }
        } catch (IOException | RuntimeException e) {
            log.warn("Google token revoke failed ({}); stored tokens are being deleted regardless", e.getClass().getSimpleName());
        }
        mongo.remove(c.get());
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private JsonNode tokenCall(Map<String, String> body) {
        GoogleHttp.Result r;
        try {
            r = http.send("POST", TOKEN_URL, Map.of("Content-Type", "application/x-www-form-urlencoded"), form(body));
        } catch (IOException e) {
            throw new GoogleApiException(GoogleApiException.Kind.NETWORK, "Network error");
        }
        if (r.status() >= 500 || r.status() == 429)
            throw new GoogleApiException(GoogleApiException.Kind.SERVER, "Google had a problem");
        if (r.status() < 200 || r.status() >= 300)
            throw new MeetingAssistantException(HttpStatus.BAD_REQUEST, "GOOGLE_REJECTED",
                    "Google didn't accept the sign-in. Please try connecting again.");
        try {
            return om.readTree(r.body());
        } catch (IOException e) {
            throw new GoogleApiException(GoogleApiException.Kind.BAD_RESPONSE, "Unreadable response");
        }
    }

    /** The id_token comes straight from Google's token endpoint over TLS, so reading its payload is sufficient to display the account. */
    private String emailFromIdToken(String idToken) {
        try {
            String[] parts = idToken.split("\\.");
            if (parts.length < 2) return null;
            JsonNode payload = om.readTree(Base64.getUrlDecoder().decode(parts[1]));
            String email = payload.path("email").asText("");
            return email.isEmpty() ? null : email;
        } catch (IOException | IllegalArgumentException e) {
            return null;
        }
    }

    private static String form(Map<String, String> m) {
        StringJoiner j = new StringJoiner("&");
        m.forEach((k, v) -> j.add(URLEncoder.encode(k, StandardCharsets.UTF_8) + "=" + URLEncoder.encode(v, StandardCharsets.UTF_8)));
        return j.toString();
    }

    private static String randomUrlSafe(int bytes) {
        byte[] b = new byte[bytes];
        RANDOM.nextBytes(b);
        return base64Url(b);
    }

    private static String base64Url(byte[] b) { return Base64.getUrlEncoder().withoutPadding().encodeToString(b); }

    private static byte[] sha256(String s) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String sha256Hex(String s) { return HexFormat.of().formatHex(sha256(s)); }
}

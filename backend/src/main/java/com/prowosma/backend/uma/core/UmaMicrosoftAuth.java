package com.prowosma.backend.uma.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.integration.GraphHttp;
import com.prowosma.backend.service.FieldEncryptionService;
import com.prowosma.backend.uma.model.UmaMicrosoftConnection;
import com.prowosma.backend.uma.model.UmaOAuthState;
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
 * Each person's Microsoft 365 sign-in for the AI Meeting Assistant (OAuth 2 authorization code + PKCE, Microsoft identity platform).
 * Delegated permissions: create Teams meetings in the person's calendar (Calendars.ReadWrite, OnlineMeetings.ReadWrite) and read the
 * transcripts of meetings they organised (OnlineMeetingTranscript.Read.All - an admin must consent to it for the organisation).
 * The app registration (client id and secret) belongs to the deployment and comes from settings; tokens are stored encrypted.
 * All traffic goes through the existing Microsoft transport, which only allows login.microsoftonline.com and graph.microsoft.com.
 */
@Component
public class UmaMicrosoftAuth {
    public static final String CALENDAR_SCOPE = "Calendars.ReadWrite";
    public static final String MEETINGS_SCOPE = "OnlineMeetings.ReadWrite";
    public static final String TRANSCRIPT_SCOPE = "OnlineMeetingTranscript.Read.All";
    static final String SCOPES = "openid email offline_access User.Read " + CALENDAR_SCOPE + " " + MEETINGS_SCOPE + " " + TRANSCRIPT_SCOPE;
    private static final SecureRandom RANDOM = new SecureRandom();

    private final GraphHttp http;
    private final MongoTemplate mongo;
    private final FieldEncryptionService crypto;
    private final ObjectMapper om = new ObjectMapper();

    @Value("${app.uma.microsoft.client-id:${UMA_MS_CLIENT_ID:}}") private String clientId = "";
    @Value("${app.uma.microsoft.client-secret:${UMA_MS_CLIENT_SECRET:}}") private String clientSecret = "";
    /** "organizations" (any work account), or the company's tenant id to accept only its accounts. */
    @Value("${app.uma.microsoft.tenant:${UMA_MS_TENANT:organizations}}") private String tenant = "organizations";
    @Value("${app.uma.microsoft.redirect-uri:}") private String redirectSetting = "";
    @Value("${app.frontend.url:http://localhost:5173}") private String frontendUrl = "http://localhost:5173";

    public UmaMicrosoftAuth(GraphHttp http, MongoTemplate mongo, FieldEncryptionService crypto) {
        this.http = http; this.mongo = mongo; this.crypto = crypto;
    }

    public boolean configured() { return clientId != null && !clientId.isBlank() && clientSecret != null && !clientSecret.isBlank(); }

    public String redirectUri() {
        if (redirectSetting != null && !redirectSetting.isBlank()) return redirectSetting.trim();
        return frontendUrl.replaceAll("/+$", "") + "/ai-meeting-assistant/microsoft-callback";
    }

    private String tenantPath() {
        String t = tenant == null || tenant.isBlank() ? "organizations" : tenant.trim();
        return t.matches("[A-Za-z0-9.-]{1,100}") ? t : "organizations";
    }

    private void requireReady() {
        if (!configured()) throw new UmaException(HttpStatus.CONFLICT, "MICROSOFT_NOT_CONFIGURED", "Microsoft sign-in isn't set up on the server yet.",
                "An admin registers an app in Microsoft Entra and adds its client ID and secret to the server (see the setup guide).");
        if (!crypto.isActive()) throw new UmaException(HttpStatus.CONFLICT, "ENCRYPTION_NOT_CONFIGURED", "The server can't store sign-ins safely yet.",
                "An admin sets ENCRYPTION_KEY on the server (start-all does this for you locally).");
    }

    public String authorizeUrl(String org, String email) {
        requireReady();
        String user = email.toLowerCase(Locale.ROOT);
        String state = randomUrlSafe(32), verifier = randomUrlSafe(48);
        mongo.remove(new Query(Criteria.where("organizationId").is(org).and("userEmail").is(user).and("provider").is("MICROSOFT")), UmaOAuthState.class);
        UmaOAuthState st = new UmaOAuthState();
        st.setOrganizationId(org); st.setUserEmail(user); st.setStateHash(sha256Hex(state)); st.setProvider("MICROSOFT");
        st.setCodeVerifierEnc(crypto.encrypt(verifier)); st.setExpiresAt(Instant.now().plusSeconds(600));
        mongo.insert(st);
        Map<String, String> q = new LinkedHashMap<>();
        q.put("client_id", clientId); q.put("response_type", "code"); q.put("redirect_uri", redirectUri()); q.put("response_mode", "query");
        q.put("scope", SCOPES); q.put("state", state); q.put("prompt", "select_account");
        q.put("code_challenge", base64Url(sha256(verifier))); q.put("code_challenge_method", "S256");
        return "https://login.microsoftonline.com/" + tenantPath() + "/oauth2/v2.0/authorize?" + form(q);
    }

    public UmaMicrosoftConnection complete(String org, String email, String code, String state) {
        requireReady();
        if (code == null || code.isBlank() || state == null || state.isBlank()) throw invalidState();
        String user = email.toLowerCase(Locale.ROOT);
        UmaOAuthState st = mongo.findAndRemove(new Query(Criteria.where("stateHash").is(sha256Hex(state))), UmaOAuthState.class);   // single use
        if (st == null || !"MICROSOFT".equals(st.getProvider()) || !org.equals(st.getOrganizationId()) || !user.equals(st.getUserEmail())
                || st.getExpiresAt().isBefore(Instant.now()))
            throw invalidState();
        Map<String, String> body = new LinkedHashMap<>();
        body.put("client_id", clientId); body.put("client_secret", clientSecret); body.put("code", code);
        body.put("redirect_uri", redirectUri()); body.put("grant_type", "authorization_code");
        body.put("code_verifier", crypto.decrypt(st.getCodeVerifierEnc())); body.put("scope", SCOPES);
        JsonNode r = tokenCall(body);
        String access = r.path("access_token").asText(""), refresh = r.path("refresh_token").asText("");
        if (access.isEmpty()) throw new UmaException(HttpStatus.BAD_GATEWAY, "MICROSOFT_ERROR", "Microsoft didn't complete the sign-in. Please try again.");
        if (refresh.isEmpty()) throw new UmaException(HttpStatus.BAD_REQUEST, "NO_REFRESH_TOKEN", "Microsoft didn't grant lasting access.", "Connect again and accept all the permissions.");
        Map<String, String> claims = idClaims(r.path("id_token").asText(""));
        UmaMicrosoftConnection c = connection(org, user).orElseGet(UmaMicrosoftConnection::new);
        c.setOrganizationId(org); c.setUserEmail(user);
        c.setAccessTokenEnc(crypto.encrypt(access)); c.setRefreshTokenEnc(crypto.encrypt(refresh));
        c.setAccessTokenExpiresAt(Instant.now().plusSeconds(Math.max(60, r.path("expires_in").asLong(3600))));
        c.setScopes(new ArrayList<>(Arrays.asList(r.path("scope").asText("").split("\\s+"))));
        c.setAccount(claims.getOrDefault("email", claims.get("preferred_username")));
        c.setTenantId(claims.get("tid"));
        c.setStatus("ACTIVE"); c.setUpdatedAt(Instant.now());
        return mongo.save(c);
    }

    public Optional<UmaMicrosoftConnection> connection(String org, String email) {
        if (org == null || email == null) return Optional.empty();
        return Optional.ofNullable(mongo.findOne(new Query(Criteria.where("organizationId").is(org)
                .and("userEmail").is(email.toLowerCase(Locale.ROOT))), UmaMicrosoftConnection.class));
    }

    public boolean active(String org, String email) { return connection(org, email).filter(c -> "ACTIVE".equals(c.getStatus())).isPresent(); }

    /** Scopes come back as full URLs or short names depending on the tenant: compare by the short name. */
    public boolean hasScope(String org, String email, String scope) {
        return connection(org, email).map(c -> c.getScopes().stream().anyMatch(s -> s.equalsIgnoreCase(scope) || s.toLowerCase(Locale.ROOT).endsWith("/" + scope.toLowerCase(Locale.ROOT))))
                .orElse(false);
    }

    public String accessToken(String org, String email) {
        UmaMicrosoftConnection c = connection(org, email).orElseThrow(() -> new UmaException(HttpStatus.CONFLICT, "MICROSOFT_NOT_CONNECTED",
                "Your Microsoft account isn't connected.", "Connect it under Connections on the AI Meeting Assistant page."));
        if (!"ACTIVE".equals(c.getStatus())) throw reauth();
        if (c.getAccessTokenExpiresAt() != null && c.getAccessTokenExpiresAt().isAfter(Instant.now().plusSeconds(60)))
            return crypto.decrypt(c.getAccessTokenEnc());
        requireReady();
        Map<String, String> body = new LinkedHashMap<>();
        body.put("client_id", clientId); body.put("client_secret", clientSecret); body.put("grant_type", "refresh_token");
        body.put("refresh_token", crypto.decrypt(c.getRefreshTokenEnc())); body.put("scope", SCOPES);
        JsonNode r;
        try { r = tokenCall(body); }
        catch (UmaException e) {
            if ("MICROSOFT_REJECTED".equals(e.getCode())) { c.setStatus("NEEDS_REAUTH"); c.setUpdatedAt(Instant.now()); mongo.save(c); throw reauth(); }
            throw e;
        }
        String access = r.path("access_token").asText("");
        if (access.isEmpty()) throw new UmaException(HttpStatus.BAD_GATEWAY, "MICROSOFT_ERROR", "Microsoft didn't return an access token.", "Try again.");
        c.setAccessTokenEnc(crypto.encrypt(access));
        if (!r.path("refresh_token").asText("").isEmpty()) c.setRefreshTokenEnc(crypto.encrypt(r.path("refresh_token").asText()));   // Microsoft rotates them
        c.setAccessTokenExpiresAt(Instant.now().plusSeconds(Math.max(60, r.path("expires_in").asLong(3600))));
        c.setUpdatedAt(Instant.now());
        mongo.save(c);
        return access;
    }

    /** Microsoft has no token-revocation call for this flow: the saved tokens are deleted (the person can also remove the app in their account). */
    public void disconnect(String org, String email) { connection(org, email).ifPresent(mongo::remove); }

    private JsonNode tokenCall(Map<String, String> body) {
        GraphHttp.Result r;
        try { r = http.send("POST", "https://login.microsoftonline.com/" + tenantPath() + "/oauth2/v2.0/token",
                Map.of("Content-Type", "application/x-www-form-urlencoded"), form(body)); }
        catch (IOException e) { throw new UmaException(HttpStatus.SERVICE_UNAVAILABLE, "MICROSOFT_UNAVAILABLE", "Couldn't reach Microsoft.", "Try again in a moment."); }
        if (r.status() >= 500 || r.status() == 429) throw new UmaException(HttpStatus.SERVICE_UNAVAILABLE, "MICROSOFT_UNAVAILABLE", "Microsoft had a problem.", "Try again in a moment.");
        if (r.status() < 200 || r.status() >= 300) {
            String err = "";
            try { err = om.readTree(r.body()).path("error_description").asText(""); } catch (IOException ignored) { }
            if (err.contains("AADSTS65001") || err.contains("AADSTS90094"))
                throw new UmaException(HttpStatus.FORBIDDEN, "MICROSOFT_CONSENT_REQUIRED", "Your organisation's Microsoft admin hasn't approved this app yet.",
                        "Ask a Microsoft 365 admin to grant admin consent for the app (see the setup guide), then connect again.");
            throw new UmaException(HttpStatus.BAD_REQUEST, "MICROSOFT_REJECTED", "Microsoft didn't accept the sign-in.", "Connect your Microsoft account again.");
        }
        try { return om.readTree(r.body()); }
        catch (IOException e) { throw new UmaException(HttpStatus.BAD_GATEWAY, "MICROSOFT_BAD_RESPONSE", "Microsoft's reply couldn't be read.", "Try again."); }
    }

    private Map<String, String> idClaims(String idToken) {
        Map<String, String> out = new HashMap<>();
        try {
            String[] parts = idToken.split("\\.");
            if (parts.length < 2) return out;
            JsonNode n = om.readTree(Base64.getUrlDecoder().decode(parts[1]));
            for (String k : List.of("email", "preferred_username", "tid", "name")) if (n.hasNonNull(k)) out.put(k, n.get(k).asText());
        } catch (IOException | IllegalArgumentException ignored) { }
        return out;
    }

    private static UmaException invalidState() {
        return new UmaException(HttpStatus.BAD_REQUEST, "INVALID_STATE", "This sign-in link has expired or was already used.", "Start again from Connections.");
    }

    private static UmaException reauth() {
        return new UmaException(HttpStatus.CONFLICT, "MICROSOFT_REAUTH_REQUIRED", "Microsoft asked for a new sign-in.", "Connect your Microsoft account again under Connections.");
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

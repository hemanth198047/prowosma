package com.prowosma.backend.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.integration.GraphApiException;
import com.prowosma.backend.integration.GraphApiException.Kind;
import com.prowosma.backend.integration.GraphHttp;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

/**
 * App-only Microsoft sign-in (client-credentials) for reading Teams transcripts. The app registration (client id + secret) belongs to the
 * DEPLOYMENT and lives in environment settings; each workspace only supplies its Microsoft tenant id. Access tokens are cached in memory
 * only — nothing secret is written to the database — and are never logged. A tenant administrator must grant admin consent and create the
 * application access policy; this class can verify the first (via the token's roles) and reports the rest honestly.
 */
@Service
@RequiredArgsConstructor
public class TeamsAuthService {

    public static final String TRANSCRIPT_ROLE = "OnlineMeetingTranscript.Read.All";
    private static final Pattern GUID = Pattern.compile("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");

    @Value("${app.meeting-assistant.teams.client-id:${TEAMS_GRAPH_CLIENT_ID:}}")
    private String clientId;
    @Value("${app.meeting-assistant.teams.client-secret:${TEAMS_GRAPH_CLIENT_SECRET:}}")
    private String clientSecret;

    private final GraphHttp http;
    private final ObjectMapper om = new ObjectMapper();
    private final Map<String, Token> cache = new ConcurrentHashMap<>();

    public record Token(String value, Instant expiresAt, List<String> roles) {}

    public boolean isConfigured() {
        return clientId != null && !clientId.isBlank() && clientSecret != null && !clientSecret.isBlank();
    }

    public static boolean validTenantId(String t) { return t != null && GUID.matcher(t).matches(); }

    /** Where a Microsoft 365 admin approves the app for their tenant (they can also do it in the Entra admin center). */
    public String consentUrl(String tenantId) {
        if (!isConfigured() || !validTenantId(tenantId)) return null;
        return "https://login.microsoftonline.com/" + tenantId.toLowerCase(Locale.ROOT) + "/adminconsent?client_id=" + URLEncoder.encode(clientId, StandardCharsets.UTF_8);
    }

    /** A valid app token for this tenant (cached until shortly before it expires). */
    public Token token(String tenantId) {
        if (!isConfigured()) throw new GraphApiException(Kind.UNAUTHORIZED, "NOT_CONFIGURED", "Microsoft sign-in isn't set up on the server.");
        if (!validTenantId(tenantId)) throw new GraphApiException(Kind.UNAUTHORIZED, "TENANT_NOT_FOUND", "That Microsoft tenant id isn't valid.");
        String key = tenantId.toLowerCase(Locale.ROOT);
        Token c = cache.get(key);
        if (c != null && c.expiresAt().isAfter(Instant.now().plusSeconds(120))) return c;

        String form = "client_id=" + enc(clientId) + "&client_secret=" + enc(clientSecret) + "&grant_type=client_credentials&scope=" + enc("https://graph.microsoft.com/.default");
        GraphHttp.Result r;
        try {
            r = http.send("POST", "https://login.microsoftonline.com/" + key + "/oauth2/v2.0/token",
                    Map.of("Content-Type", "application/x-www-form-urlencoded", "Accept", "application/json"), form);
        } catch (IOException e) {
            throw new GraphApiException(Kind.NETWORK, "NETWORK", "Couldn't reach Microsoft.");
        }
        if (r.status() == 429) throw new GraphApiException(Kind.RATE_LIMITED, "RATE_LIMITED", "Microsoft is rate limiting sign-ins.");
        if (r.status() >= 500) throw new GraphApiException(Kind.SERVER, "SERVER", "Microsoft had a problem.");
        if (r.status() < 200 || r.status() >= 300) throw sanitizedFailure(r.body());
        try {
            JsonNode n = om.readTree(r.body());
            String access = n.path("access_token").asText("");
            if (access.isEmpty()) throw new GraphApiException(Kind.BAD_RESPONSE, "NO_TOKEN", "Microsoft returned no token.");
            Token t = new Token(access, Instant.now().plusSeconds(Math.max(120, n.path("expires_in").asLong(3600))), rolesOf(access));
            cache.put(key, t);
            return t;
        } catch (IOException e) {
            throw new GraphApiException(Kind.BAD_RESPONSE, "UNREADABLE", "Unreadable response from Microsoft.");
        }
    }

    /** Forget a cached token (after a 401 from Graph, or when settings change). */
    public void forget(String tenantId) { if (tenantId != null) cache.remove(tenantId.toLowerCase(Locale.ROOT)); }

    /** Only a fixed set of plain-language reasons is ever produced — Microsoft's error text is read for a code, never repeated. */
    private GraphApiException sanitizedFailure(String body) {
        String text = "";
        try { text = om.readTree(body).path("error_description").asText(""); } catch (IOException | RuntimeException ignored) { /* fall through */ }
        if (text.contains("AADSTS7000215") || text.contains("AADSTS7000222") || text.contains("AADSTS7000112"))
            return new GraphApiException(Kind.UNAUTHORIZED, "BAD_SECRET", "Microsoft rejected the app's client secret. It may be wrong or expired.");
        if (text.contains("AADSTS700016") || text.contains("AADSTS65001") || text.contains("AADSTS500011") || text.contains("AADSTS650051"))
            return new GraphApiException(Kind.UNAUTHORIZED, "CONSENT_MISSING", "The app isn't set up in this Microsoft tenant, or an admin hasn't granted consent yet.");
        if (text.contains("AADSTS90002") || text.contains("AADSTS900023"))
            return new GraphApiException(Kind.UNAUTHORIZED, "TENANT_NOT_FOUND", "Microsoft doesn't recognise that tenant id.");
        return new GraphApiException(Kind.UNAUTHORIZED, "REJECTED", "Microsoft didn't accept the app's sign-in.");
    }

    private List<String> rolesOf(String jwt) {
        try {
            String[] p = jwt.split("\\.");
            if (p.length < 2) return List.of();
            List<String> out = new ArrayList<>();
            for (JsonNode r : om.readTree(Base64.getUrlDecoder().decode(p[1])).path("roles")) out.add(r.asText());
            return out;
        } catch (IOException | IllegalArgumentException e) {
            return List.of();
        }
    }

    private static String enc(String s) { return URLEncoder.encode(s, StandardCharsets.UTF_8); }
}

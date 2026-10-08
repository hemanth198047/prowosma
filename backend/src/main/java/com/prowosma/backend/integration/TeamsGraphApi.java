package com.prowosma.backend.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.*;
import java.util.regex.Pattern;

/**
 * Read-only client for the Microsoft Graph transcript APIs (v1.0): list an organizer's transcripts in a time window, and download one as
 * WebVTT. Needs only the application permission OnlineMeetingTranscript.Read.All plus the tenant's application access policy.
 * Written against Microsoft's published reference; confirm against a real, authorized meeting before calling it verified.
 */
@Component
@RequiredArgsConstructor
public class TeamsGraphApi {

    private static final String BASE = "https://graph.microsoft.com/v1.0/";
    private static final Pattern GUID = Pattern.compile("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");
    private static final Pattern GRAPH_ID = Pattern.compile("^[A-Za-z0-9_=+/.\\-]{1,2000}$");
    private static final int MAX_PAGES = 50;

    public record Transcript(String id, String meetingId, Instant createdAt, Instant endedAt) {}

    private final GraphHttp http;
    private final ObjectMapper om = new ObjectMapper();

    public List<Transcript> listOrganizerTranscripts(String token, String organizerId, Instant from, Instant to) {
        requireGuid(organizerId);
        String filter = "createdDateTime ge " + from + " and createdDateTime le " + to;
        String url = BASE + "users/" + organizerId + "/onlineMeetings/getAllTranscripts(meetingOrganizerUserId='" + organizerId + "')?$filter="
                + URLEncoder.encode(filter, StandardCharsets.UTF_8).replace("+", "%20");
        List<Transcript> out = new ArrayList<>();
        for (int i = 0; i < MAX_PAGES && url != null; i++) {
            JsonNode page = getJson(token, url);
            for (JsonNode n : page.path("value")) {
                String id = n.path("id").asText(null), meeting = n.path("meetingId").asText(null);
                if (id == null || meeting == null) continue;
                out.add(new Transcript(id, meeting, instant(n, "createdDateTime"), instant(n, "endDateTime")));
            }
            String next = page.path("@odata.nextLink").asText("");
            url = next.startsWith(BASE) ? next : null;                    // never follow a link to anywhere but Graph v1.0
        }
        return out;
    }

    /** WebVTT text with timestamps and &lt;v Speaker&gt; voice tags. */
    public String transcriptVtt(String token, String organizerId, String meetingId, String transcriptId) {
        requireGuid(organizerId);
        requireId(meetingId);
        requireId(transcriptId);
        String url = BASE + "users/" + organizerId + "/onlineMeetings/" + enc(meetingId) + "/transcripts/" + enc(transcriptId) + "/content";
        return send(token, url, "text/vtt");
    }

    // ── internals ────────────────────────────────────────────────────────────

    private static void requireGuid(String v) {
        if (v == null || !GUID.matcher(v).matches()) throw new GraphApiException(GraphApiException.Kind.BAD_RESPONSE, "BAD_ID", "Unexpected organizer id");
    }

    private static void requireId(String v) {
        if (v == null || !GRAPH_ID.matcher(v).matches()) throw new GraphApiException(GraphApiException.Kind.BAD_RESPONSE, "BAD_ID", "Unexpected resource id");
    }

    private static String enc(String s) { return URLEncoder.encode(s, StandardCharsets.UTF_8).replace("+", "%20"); }

    private JsonNode getJson(String token, String url) {
        String body = send(token, url, "application/json");
        try {
            return om.readTree(body == null || body.isBlank() ? "{}" : body);
        } catch (IOException e) {
            throw new GraphApiException(GraphApiException.Kind.BAD_RESPONSE, "UNREADABLE", "Unreadable response");
        }
    }

    private String send(String token, String url, String accept) {
        GraphHttp.Result r;
        try {
            r = http.send("GET", url, Map.of("Authorization", "Bearer " + token, "Accept", accept), null);
        } catch (IOException e) {
            boolean big = e.getMessage() != null && e.getMessage().contains("too large");
            throw new GraphApiException(big ? GraphApiException.Kind.TOO_LARGE : GraphApiException.Kind.NETWORK, big ? "TOO_LARGE" : "NETWORK", big ? "Response too large" : "Network error");
        }
        int s = r.status();
        if (s >= 200 && s < 300) return r.body();
        // Response bodies are never copied into messages or logs; only a short, whitelisted error CODE is read.
        String code = errorCode(r.body());
        if (s == 401) throw new GraphApiException(GraphApiException.Kind.UNAUTHORIZED, "UNAUTHORIZED", "Microsoft rejected the app's sign-in");
        if (s == 403) {
            boolean disabled = code != null && code.toLowerCase(Locale.ROOT).contains("accesstotranscriptsdisabled");
            throw new GraphApiException(disabled ? GraphApiException.Kind.TRANSCRIPTS_DISABLED : GraphApiException.Kind.FORBIDDEN, disabled ? "TRANSCRIPTS_DISABLED" : "FORBIDDEN", "Microsoft denied access");
        }
        if (s == 404) throw new GraphApiException(GraphApiException.Kind.NOT_FOUND, "NOT_FOUND", "Not found");
        if (s == 429) throw new GraphApiException(GraphApiException.Kind.RATE_LIMITED, "RATE_LIMITED", "Rate limited");
        if (s >= 500) throw new GraphApiException(GraphApiException.Kind.SERVER, "SERVER", "Microsoft had a problem");
        throw new GraphApiException(GraphApiException.Kind.BAD_RESPONSE, "STATUS_" + s, "Unexpected status " + s);
    }

    private String errorCode(String body) {
        try {
            if (body == null) return null;
            String c = om.readTree(body).path("error").path("code").asText(null);
            return c != null && c.matches("[A-Za-z0-9_.\\-]{1,80}") ? c : null;
        } catch (IOException e) {
            return null;
        }
    }

    private static Instant instant(JsonNode n, String field) {
        String v = n.path(field).asText("");
        if (v.isEmpty()) return null;
        try {
            return Instant.parse(v);
        } catch (DateTimeParseException e) {
            return null;
        }
    }
}

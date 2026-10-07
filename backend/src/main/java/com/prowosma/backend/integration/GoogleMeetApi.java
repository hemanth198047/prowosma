package com.prowosma.backend.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.meetingassistant.ConferenceSelector.Conference;
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
 * Thin client for the Google Meet REST API v2 (read-only: conferenceRecords, transcripts, entries, participants).
 * Written against Google's published reference; field names should be re-checked against a real, authorized
 * meeting before this is called verified (see docs/MEETING_ASSISTANT.md).
 */
@Component
@RequiredArgsConstructor
public class GoogleMeetApi {

    private static final String BASE = "https://meet.googleapis.com/v2/";
    private static final Pattern MEETING_CODE = Pattern.compile("^[a-z]{3}-[a-z]{4}-[a-z]{3}$");
    private static final Pattern RESOURCE = Pattern.compile("^conferenceRecords/[A-Za-z0-9_-]+(/transcripts/[A-Za-z0-9_-]+)?$");
    private static final int MAX_PAGES = 600;   // 60,000 entries at 100 per page; beyond that we refuse rather than truncate

    public record TranscriptInfo(String name, String state, Instant start, Instant end) {}
    public record Entry(String participant, String text, String languageCode, Instant start, Instant end) {}

    private final GoogleHttp http;
    private final ObjectMapper om = new ObjectMapper();

    public List<Conference> listConferenceRecords(String token, String meetingCode) {
        if (meetingCode == null || !MEETING_CODE.matcher(meetingCode).matches())
            throw new GoogleApiException(GoogleApiException.Kind.BAD_RESPONSE, "Unsupported meeting code");
        String filter = URLEncoder.encode("space.meeting_code = \"" + meetingCode + "\"", StandardCharsets.UTF_8);
        List<Conference> out = new ArrayList<>();
        for (JsonNode page : pages(token, BASE + "conferenceRecords?pageSize=100&filter=" + filter)) {
            for (JsonNode n : page.path("conferenceRecords")) {
                out.add(new Conference(n.path("name").asText(null), instant(n, "startTime"), instant(n, "endTime")));
            }
        }
        return out;
    }

    public List<TranscriptInfo> listTranscripts(String token, String conferenceRecord) {
        requireResource(conferenceRecord);
        List<TranscriptInfo> out = new ArrayList<>();
        for (JsonNode page : pages(token, BASE + conferenceRecord + "/transcripts?pageSize=100")) {
            for (JsonNode n : page.path("transcripts")) {
                out.add(new TranscriptInfo(n.path("name").asText(null), n.path("state").asText(""),
                        instant(n, "startTime"), instant(n, "endTime")));
            }
        }
        return out;
    }

    public List<Entry> listEntries(String token, String transcriptName) {
        requireResource(transcriptName);
        List<Entry> out = new ArrayList<>();
        for (JsonNode page : pages(token, BASE + transcriptName + "/entries?pageSize=100")) {
            for (JsonNode n : page.path("transcriptEntries")) {
                String text = n.path("text").asText("");
                if (text.isBlank()) continue;
                out.add(new Entry(n.path("participant").asText(null), text, n.path("languageCode").asText(null),
                        instant(n, "startTime"), instant(n, "endTime")));
            }
        }
        return out;
    }

    /** participant resource name → display name, exactly as Google reports it (never an email, never guessed). */
    public Map<String, String> listParticipants(String token, String conferenceRecord) {
        requireResource(conferenceRecord);
        Map<String, String> out = new HashMap<>();
        for (JsonNode page : pages(token, BASE + conferenceRecord + "/participants?pageSize=100")) {
            for (JsonNode n : page.path("participants")) {
                String name = n.path("name").asText(null);
                String display = firstNonBlank(n.path("signedinUser").path("displayName").asText(null),
                        n.path("anonymousUser").path("displayName").asText(null),
                        n.path("phoneUser").path("displayName").asText(null));
                if (name != null && display != null) out.put(name, display);
            }
        }
        return out;
    }

    /** Cheapest authenticated call, used by "Test connection". */
    public void healthCheck(String token) {
        get(token, BASE + "conferenceRecords?pageSize=1");
    }

    // ── internals ────────────────────────────────────────────────────────────

    private static void requireResource(String name) {
        if (name == null || !RESOURCE.matcher(name).matches())
            throw new GoogleApiException(GoogleApiException.Kind.BAD_RESPONSE, "Unexpected resource name");
    }

    /** Follows nextPageToken. Refuses (rather than truncates) when a result set is absurdly large. */
    private List<JsonNode> pages(String token, String firstUrl) {
        List<JsonNode> out = new ArrayList<>();
        String pageToken = null;
        for (int i = 0; i < MAX_PAGES; i++) {
            String url = pageToken == null ? firstUrl : firstUrl + "&pageToken=" + URLEncoder.encode(pageToken, StandardCharsets.UTF_8);
            JsonNode body = get(token, url);
            out.add(body);
            pageToken = body.path("nextPageToken").asText("");
            if (pageToken.isEmpty()) return out;
        }
        throw new GoogleApiException(GoogleApiException.Kind.TOO_LARGE, "Too many pages");
    }

    private JsonNode get(String token, String url) {
        GoogleHttp.Result r;
        try {
            r = http.send("GET", url, Map.of("Authorization", "Bearer " + token, "Accept", "application/json"), null);
        } catch (IOException e) {
            throw new GoogleApiException(GoogleApiException.Kind.NETWORK, "Network error");
        }
        int s = r.status();
        if (s >= 200 && s < 300) {
            try {
                return om.readTree(r.body() == null || r.body().isBlank() ? "{}" : r.body());
            } catch (IOException e) {
                throw new GoogleApiException(GoogleApiException.Kind.BAD_RESPONSE, "Unreadable response");
            }
        }
        // Response bodies are deliberately not copied into messages or logs.
        if (s == 401) throw new GoogleApiException(GoogleApiException.Kind.UNAUTHORIZED, "Google rejected the sign-in");
        if (s == 403) throw new GoogleApiException(GoogleApiException.Kind.FORBIDDEN, "Google denied access");
        if (s == 404) throw new GoogleApiException(GoogleApiException.Kind.NOT_FOUND, "Not found");
        if (s == 429) throw new GoogleApiException(GoogleApiException.Kind.RATE_LIMITED, "Rate limited");
        if (s >= 500) throw new GoogleApiException(GoogleApiException.Kind.SERVER, "Google had a problem");
        throw new GoogleApiException(GoogleApiException.Kind.BAD_RESPONSE, "Unexpected status " + s);
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

    private static String firstNonBlank(String... values) {
        for (String v : values) if (v != null && !v.isBlank()) return v.strip();
        return null;
    }
}

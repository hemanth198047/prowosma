package com.prowosma.backend.uma;

import com.prowosma.backend.integration.GoogleHttp;
import com.prowosma.backend.uma.core.UmaGoogleHttp;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

/** SCRIPTED stand-in for Google's token endpoint and Calendar API (tests only). Proves our wiring, not Google's behaviour. */
class UmaGoogleHttpFake extends UmaGoogleHttp {
    record Req(String method, String url, String body) {}
    final List<Req> requests = new CopyOnWriteArrayList<>();
    volatile String calendarItems = "[]";      // JSON array returned by events.list
    volatile boolean grantCalendar = true;

    void reset() { requests.clear(); calendarItems = "[]"; grantCalendar = true; }

    static String event(String id, String title, Instant start, Instant end, String meet, String status) {
        return """
               {"id":"%s","summary":"%s","status":"%s","htmlLink":"https://calendar.google.com/event?eid=%s",
                "start":{"dateTime":"%s"},"end":{"dateTime":"%s"}%s,
                "attendees":[{"email":"priya@acme.test"},{"email":"ravi@acme.test"}]}"""
                .formatted(id, title, status, id, start, end, meet == null ? "" : ",\"hangoutLink\":\"" + meet + "\"");
    }

    @Override
    public GoogleHttp.Result send(String method, String url, Map<String, String> headers, String body) {
        requests.add(new Req(method, url, body));
        if (url.startsWith("https://oauth2.googleapis.com/token")) {
            String payload = Base64.getUrlEncoder().withoutPadding().encodeToString("{\"email\":\"owner@acme.test\"}".getBytes(StandardCharsets.UTF_8));
            String scope = "openid email https://www.googleapis.com/auth/meetings.space.readonly" + (grantCalendar ? " https://www.googleapis.com/auth/calendar.events" : "");
            return new GoogleHttp.Result(200, "{\"access_token\":\"tok-123\",\"refresh_token\":\"ref-1\",\"expires_in\":3600,\"scope\":\"" + scope
                    + "\",\"id_token\":\"x." + payload + ".y\"}");
        }
        if (url.startsWith("https://oauth2.googleapis.com/revoke")) return new GoogleHttp.Result(200, "{}");
        if (!"Bearer tok-123".equals(headers.get("Authorization"))) return new GoogleHttp.Result(401, "{}");
        if (url.contains("/calendar/v3/calendars/primary/events") && "POST".equals(method)) {
            // echo back what was asked, with the Meet link Google would add
            String start = body.replaceAll("(?s).*\"start\":\\{\"dateTime\":\"([^\"]+)\".*", "$1");
            String end = body.replaceAll("(?s).*\"end\":\\{\"dateTime\":\"([^\"]+)\".*", "$1");
            return new GoogleHttp.Result(200, event("ev-new", "x", java.time.OffsetDateTime.parse(start).toInstant(),
                    java.time.OffsetDateTime.parse(end).toInstant(), "https://meet.google.com/abc-defg-hij", "confirmed"));
        }
        if (url.contains("/calendar/v3/calendars/primary/events") && "GET".equals(method)) return new GoogleHttp.Result(200, "{\"items\":" + calendarItems + "}");
        return new GoogleHttp.Result(404, "{}");
    }
}

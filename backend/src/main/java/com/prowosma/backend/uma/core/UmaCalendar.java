package com.prowosma.backend.uma.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.prowosma.backend.integration.GoogleHttp;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.*;

/**
 * Google Calendar for the AI Meeting Assistant, through the person's own connection: create an event with a Google Meet link (Google sends the
 * invitations), and list upcoming events that have a Meet link.
 */
@Component
public class UmaCalendar {
    private static final String BASE = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
    private final UmaGoogleHttp http;
    private final UmaGoogleAuth auth;
    private final ObjectMapper om = new ObjectMapper();

    public UmaCalendar(UmaGoogleHttp http, UmaGoogleAuth auth) { this.http = http; this.auth = auth; }

    public record Event(String id, String title, Instant start, Instant end, String meetUrl, String htmlLink, String status,
                        List<String> attendees, String organizer) {}

    public void requireCalendar(String org, String email) {
        if (!auth.active(org, email)) throw new UmaException(HttpStatus.CONFLICT, "GOOGLE_NOT_CONNECTED", "Your Google account isn't connected.",
                "Connect it under Connections on the AI Meeting Assistant page.");
        if (!auth.hasScope(org, email, UmaGoogleAuth.CALENDAR_SCOPE))
            throw new UmaException(HttpStatus.CONFLICT, "GOOGLE_NO_CALENDAR", "Calendar access wasn't granted when you connected Google.",
                    "Disconnect and connect your Google account again, and allow Calendar.");
    }

    /** Creates the event with a new Meet link and sends Google's invitations to the attendees. */
    public Event createMeeting(String org, String email, String title, Instant start, Instant end, String timezone,
                               List<String> attendees, String description) {
        requireCalendar(org, email);
        String token = auth.accessToken(org, email);
        String tz = validZone(timezone);
        ObjectNode body = om.createObjectNode();
        body.put("summary", title);
        if (description != null && !description.isBlank()) body.put("description", description);
        body.putObject("start").put("dateTime", DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(start.atZone(ZoneId.of(tz)))).put("timeZone", tz);
        body.putObject("end").put("dateTime", DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(end.atZone(ZoneId.of(tz)))).put("timeZone", tz);
        ArrayNode att = body.putArray("attendees");
        for (String a : attendees) att.addObject().put("email", a);
        body.putObject("conferenceData").putObject("createRequest").put("requestId", UUID.randomUUID().toString())
                .putObject("conferenceSolutionKey").put("type", "hangoutsMeet");
        JsonNode r = call("POST", BASE + "?conferenceDataVersion=1&sendUpdates=all", token, body.toString());
        Event e = toEvent(r);
        // Google may still be creating the Meet room; look again a couple of times.
        for (int i = 0; i < 3 && e.meetUrl() == null && e.id() != null; i++) {
            try { Thread.sleep(800); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); break; }
            e = toEvent(call("GET", BASE + "/" + enc(e.id()), token, null));
        }
        if (e.meetUrl() == null) throw new UmaException(HttpStatus.BAD_GATEWAY, "NO_MEET_LINK",
                "The calendar event was created, but Google didn't add a Meet link.", "Open the event in Google Calendar and add Google Meet video conferencing.");
        return e;
    }

    /** Upcoming events with a Google Meet link, between now and {@code until}. */
    public List<Event> upcomingMeet(String org, String email, Instant from, Instant until) {
        String token = auth.accessToken(org, email);
        String url = BASE + "?singleEvents=true&orderBy=startTime&maxResults=50&timeMin=" + enc(from.toString()) + "&timeMax=" + enc(until.toString());
        JsonNode r = call("GET", url, token, null);
        List<Event> out = new ArrayList<>();
        for (JsonNode n : r.path("items")) {
            Event e = toEvent(n);
            if (e.meetUrl() != null && e.start() != null) out.add(e);
        }
        return out;
    }

    private Event toEvent(JsonNode n) {
        String meet = n.path("hangoutLink").asText(null);
        if (meet == null) {
            for (JsonNode ep : n.path("conferenceData").path("entryPoints"))
                if ("video".equals(ep.path("entryPointType").asText()) && ep.path("uri").asText("").startsWith("https://meet.google.com/")) meet = ep.path("uri").asText();
        }
        List<String> att = new ArrayList<>();
        for (JsonNode a : n.path("attendees")) if (a.hasNonNull("email")) att.add(a.get("email").asText());
        return new Event(n.path("id").asText(null), n.path("summary").asText(null), time(n.path("start")), time(n.path("end")),
                meet, n.path("htmlLink").asText(null), n.path("status").asText(null), att, n.path("organizer").path("email").asText(null));
    }

    private static Instant time(JsonNode t) {
        String dt = t.path("dateTime").asText(null);
        if (dt == null) return null;                                    // all-day events have no time: not meetings to join
        try { return java.time.OffsetDateTime.parse(dt).toInstant(); } catch (Exception e) { return null; }
    }

    private JsonNode call(String method, String url, String token, String body) {
        Map<String, String> h = new LinkedHashMap<>();
        h.put("Authorization", "Bearer " + token);
        if (body != null) h.put("Content-Type", "application/json");
        GoogleHttp.Result r;
        try { r = http.send(method, url, h, body); }
        catch (IOException e) { throw new UmaException(HttpStatus.SERVICE_UNAVAILABLE, "GOOGLE_UNAVAILABLE", "Couldn't reach Google Calendar.", "Try again in a moment."); }
        if (r.status() == 401) throw new UmaException(HttpStatus.CONFLICT, "GOOGLE_REAUTH_REQUIRED", "Google asked for a new sign-in.", "Connect your Google account again under Connections.");
        if (r.status() == 403) throw new UmaException(HttpStatus.FORBIDDEN, "GOOGLE_FORBIDDEN", "Google Calendar didn't allow this.",
                "Check that the Calendar API is enabled in the Google Cloud project and that you allowed Calendar when connecting.");
        if (r.status() == 429 || r.status() >= 500) throw new UmaException(HttpStatus.SERVICE_UNAVAILABLE, "GOOGLE_UNAVAILABLE", "Google Calendar is busy.", "Try again in a moment.");
        if (r.status() < 200 || r.status() >= 300) throw new UmaException(HttpStatus.BAD_REQUEST, "GOOGLE_CALENDAR_REJECTED", "Google Calendar didn't accept the meeting.", "Check the time and the attendees' email addresses.");
        try { return om.readTree(r.body()); }
        catch (IOException e) { throw new UmaException(HttpStatus.BAD_GATEWAY, "GOOGLE_BAD_RESPONSE", "Google's reply couldn't be read.", "Try again."); }
    }

    public static String validZone(String tz) {
        try { return tz == null || tz.isBlank() ? "UTC" : ZoneId.of(tz).getId(); } catch (Exception e) { return "UTC"; }
    }

    private static String enc(String s) { return URLEncoder.encode(s, StandardCharsets.UTF_8); }
}

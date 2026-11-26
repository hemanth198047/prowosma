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

    /**
     * Puts people who are missing from the Google event onto it; Google sends each of them its own invitation (and from then on they are
     * "invited", so Meet lets them in without asking the host). Returns the addresses added. People already on the event are left untouched.
     */
    public List<String> addMissingAttendees(String org, String email, String eventId, Collection<String> wanted) {
        requireCalendar(org, email);
        String token = auth.accessToken(org, email);
        JsonNode ev = call("GET", BASE + "/" + enc(eventId), token, null);
        Set<String> have = new HashSet<>();
        ArrayNode all = om.createArrayNode();
        for (JsonNode a : ev.path("attendees")) { all.add(a); if (a.hasNonNull("email")) have.add(a.get("email").asText().trim().toLowerCase(Locale.ROOT)); }
        List<String> added = new ArrayList<>();
        for (String w : wanted) {
            String a = w == null ? "" : w.trim().toLowerCase(Locale.ROOT);
            if (a.isEmpty() || !have.add(a)) continue;
            all.addObject().put("email", a);
            added.add(a);
        }
        if (added.isEmpty()) return added;
        ObjectNode body = om.createObjectNode();
        body.set("attendees", all);
        call("PATCH", BASE + "/" + enc(eventId) + "?sendUpdates=all", token, body.toString());
        return added;
    }

    /** One event of the person's Google Calendar, as the calendar page shows it. */
    public record Entry(String id, String title, Instant start, Instant end, boolean allDay, String startDate, String endDate,
                        String meetUrl, String htmlLink, String myResponse, String location) {}

    /**
     * Everything on the person's primary Google Calendar between {@code from} and {@code until} - meetings and plain events, timed and
     * all-day - so the Prowosma calendar can show what Google Calendar shows. Cancelled events and ones the person declined are left out.
     */
    public List<Entry> listEvents(String org, String email, Instant from, Instant until) {
        requireCalendar(org, email);
        String token = auth.accessToken(org, email);
        List<Entry> out = new ArrayList<>();
        String page = null;
        for (int i = 0; i < 4; i++) {
            String url = BASE + "?singleEvents=true&orderBy=startTime&maxResults=250&timeMin=" + enc(from.toString()) + "&timeMax=" + enc(until.toString())
                    + (page == null ? "" : "&pageToken=" + enc(page));
            JsonNode r = call("GET", url, token, null);
            for (JsonNode n : r.path("items")) {
                if ("cancelled".equals(n.path("status").asText())) continue;
                String mine = null;
                for (JsonNode a : n.path("attendees")) if (a.path("self").asBoolean(false)) mine = a.path("responseStatus").asText(null);
                if ("declined".equals(mine)) continue;
                Event e = toEvent(n);
                String sd = n.path("start").path("date").asText(null), ed = n.path("end").path("date").asText(null);
                boolean allDay = sd != null && e.start() == null;
                if (e.start() == null && !allDay) continue;
                out.add(new Entry(e.id(), e.title(), e.start(), e.end(), allDay, sd, ed, e.meetUrl(), e.htmlLink(), mine, n.path("location").asText(null)));
            }
            page = r.path("nextPageToken").asText(null);
            if (page == null) break;
        }
        return out;
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

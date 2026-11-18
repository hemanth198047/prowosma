package com.prowosma.backend.uma.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.prowosma.backend.integration.GraphHttp;
import com.prowosma.backend.meetingassistant.TranscriptParser;
import com.prowosma.backend.uma.model.UmaMeeting;
import com.prowosma.backend.uma.model.UmaSegment;
import com.prowosma.backend.uma.model.UmaStatus;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.*;

/**
 * Microsoft Teams for the AI Meeting Assistant, through each person's own Microsoft 365 sign-in (Microsoft Graph, delegated):
 * <ul>
 *   <li>create a Teams meeting as an Outlook calendar event (Microsoft sends the invitations), for now or later;</li>
 *   <li>after the meeting, read the transcript Teams made (transcription must be turned on in the meeting) - the meeting is found
 *       from its join link among the organiser's online meetings.</li>
 * </ul>
 * Teams doesn't tell a delegated app when a meeting starts or ends, so the transcript is looked for from a few minutes after the
 * start until some hours after the planned end. Prowosma's own bot cannot join Teams calls (that needs a separate media bot service).
 */
@Component
public class UmaTeams {
    private static final String GRAPH = "https://graph.microsoft.com/v1.0";
    public static final Duration FIRST_LOOK = Duration.ofMinutes(5);
    static final Duration GIVE_UP_AFTER_END = Duration.ofHours(6);

    private final GraphHttp http;
    private final UmaMicrosoftAuth auth;
    private final UmaStore store;
    private final ObjectMapper om = new ObjectMapper();

    public UmaTeams(GraphHttp http, UmaMicrosoftAuth auth, UmaStore store) { this.http = http; this.auth = auth; this.store = store; }

    public static boolean isTeamsLink(String url) {
        if (url == null) return false;
        String u = url.toLowerCase(Locale.ROOT);
        return u.startsWith("https://teams.microsoft.com/") || u.startsWith("https://teams.live.com/");
    }

    public Map<String, Object> status(String org, String email) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("configured", auth.configured());
        r.put("redirectUri", auth.redirectUri());
        var c = auth.connection(org, email);
        r.put("connected", c.filter(x -> "ACTIVE".equals(x.getStatus())).isPresent());
        r.put("status", c.map(x -> x.getStatus()).orElse("NOT_CONNECTED"));
        r.put("account", c.map(x -> x.getAccount()).orElse(null));
        r.put("canSchedule", auth.hasScope(org, email, UmaMicrosoftAuth.CALENDAR_SCOPE));
        r.put("canReadTranscripts", auth.hasScope(org, email, UmaMicrosoftAuth.TRANSCRIPT_SCOPE));
        return r;
    }

    public record Created(String eventId, String joinUrl, String webLink) {}

    /** Creates a Teams meeting in the person's calendar and invites the attendees (Microsoft sends the invitations). */
    public Created createMeeting(String org, String email, String title, Instant start, Instant end, String timezone, List<String> attendees, String description) {
        if (!auth.active(org, email)) throw new UmaException(HttpStatus.CONFLICT, "MICROSOFT_NOT_CONNECTED", "Your Microsoft account isn't connected.",
                "Connect it under Connections on the AI Meeting Assistant page.");
        String token = auth.accessToken(org, email);
        String tz = UmaCalendar.validZone(timezone);
        ObjectNode body = om.createObjectNode();
        body.put("subject", title);
        if (description != null && !description.isBlank()) body.putObject("body").put("contentType", "text").put("content", description);
        DateTimeFormatter f = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss");
        body.putObject("start").put("dateTime", f.format(LocalDateTime.ofInstant(start, ZoneId.of(tz)))).put("timeZone", tz);
        body.putObject("end").put("dateTime", f.format(LocalDateTime.ofInstant(end, ZoneId.of(tz)))).put("timeZone", tz);
        ArrayNode att = body.putArray("attendees");
        for (String a : attendees) {
            ObjectNode n = att.addObject();
            n.putObject("emailAddress").put("address", a);
            n.put("type", "required");
        }
        body.put("isOnlineMeeting", true);
        body.put("onlineMeetingProvider", "teamsForBusiness");
        JsonNode r = call("POST", GRAPH + "/me/events", token, body.toString(), Map.of("Prefer", "outlook.timezone=\"UTC\""));
        String join = r.path("onlineMeeting").path("joinUrl").asText(null);
        if (join == null || join.isBlank()) throw new UmaException(HttpStatus.BAD_GATEWAY, "NO_TEAMS_LINK",
                "The calendar event was created, but Microsoft didn't add a Teams link.",
                "Your account may not have a Teams licence, or Teams meetings may be turned off for it. Open the event in Outlook to check.");
        return new Created(r.path("id").asText(null), join, r.path("webLink").asText(null));
    }

    public record Check(String outcome, String note, Duration again, String code, String recovery) {
        static Check waitFor(String note, Duration again) { return new Check("WAIT", note, again, null, null); }
        static Check done(String note) { return new Check("DONE", note, null, null, null); }
        static Check fail(String code, String note, String recovery) { return new Check("FAIL", note, null, code, recovery); }
    }

    /** One look for the meeting's Teams transcript; on success the lines are stored and the meeting moves on to the analysis. */
    public Check fetch(UmaMeeting m) {
        String org = m.getOrganizationId();
        String who = m.getCreatedBy();
        if (!isTeamsLink(m.getMeetingUrl())) return Check.fail("NOT_A_TEAMS_LINK", "This isn't a Teams meeting link.", "Upload the recording instead.");
        if (!auth.active(org, who)) return Check.fail("MICROSOFT_NOT_CONNECTED", "The organiser's Microsoft account isn't connected to Prowosma.",
                "Connect it under Connections, then press Check now.");
        if (!auth.hasScope(org, who, UmaMicrosoftAuth.TRANSCRIPT_SCOPE)) return Check.fail("MICROSOFT_NO_TRANSCRIPT_ACCESS",
                "Reading Teams transcripts wasn't allowed when the Microsoft account was connected.",
                "A Microsoft 365 admin grants consent for OnlineMeetingTranscript.Read.All; then connect again.");
        Instant now = Instant.now();
        Instant start = m.getMeetingAt() == null ? m.getCreatedAt() : m.getMeetingAt();
        Instant plannedEnd = m.getMeetingEndAt() == null ? start.plus(Duration.ofHours(1)) : m.getMeetingEndAt();
        String token = auth.accessToken(org, who);
        JsonNode meetings = call("GET", GRAPH + "/me/onlineMeetings?$filter=" + enc("JoinWebUrl eq '" + m.getMeetingUrl().replace("'", "''") + "'"), token, null, Map.of());
        JsonNode meeting = meetings.path("value").path(0);
        if (meeting.isMissingNode() || !meeting.hasNonNull("id"))
            return Check.fail("TEAMS_MEETING_NOT_FOUND", "Microsoft couldn't find this meeting among the organiser's Teams meetings.",
                    "Transcripts can only be read for meetings the connected account organised. Upload the recording instead.");
        String meetingId = meeting.get("id").asText();
        JsonNode list = call("GET", GRAPH + "/me/onlineMeetings/" + enc(meetingId) + "/transcripts", token, null, Map.of());
        List<JsonNode> transcripts = new ArrayList<>();
        list.path("value").forEach(transcripts::add);
        if (transcripts.isEmpty()) {
            if (now.isAfter(plannedEnd.plus(GIVE_UP_AFTER_END)))
                return Check.fail("NO_TRANSCRIPT", "Teams has no transcript for this meeting. Transcription has to be turned on during the meeting.",
                        "Upload the recording, or record the meeting from your browser next time.");
            return Check.waitFor(now.isBefore(plannedEnd) ? "Waiting for the meeting to end and Teams to write its transcript."
                    : "The meeting should have ended; waiting for Teams' transcript.", now.isBefore(plannedEnd.plus(Duration.ofMinutes(30))) ? Duration.ofMinutes(3) : Duration.ofMinutes(15));
        }
        if (now.isBefore(plannedEnd) && transcripts.stream().anyMatch(t -> !t.hasNonNull("endDateTime")))
            return Check.waitFor("Teams is still transcribing the meeting.", Duration.ofMinutes(3));
        transcripts.sort(Comparator.comparing(t -> t.path("createdDateTime").asText("")));
        List<UmaSegment> segs = new ArrayList<>();
        int seq = 0;
        for (JsonNode t : transcripts) {
            String vtt = callText(GRAPH + "/me/onlineMeetings/" + enc(meetingId) + "/transcripts/" + enc(t.path("id").asText()) + "/content?$format=text/vtt", token);
            TranscriptParser.Parsed parsed;
            try { parsed = TranscriptParser.parse(vtt, "VTT"); }
            catch (TranscriptParser.TranscriptFormatException e) { return Check.fail("TRANSCRIPT_UNREADABLE", "Teams' transcript couldn't be read.", "Upload the recording instead."); }
            for (TranscriptParser.Segment s : parsed.segments()) {
                UmaSegment u = new UmaSegment();
                u.setOrganizationId(org); u.setMeetingId(m.getId()); u.setSeq(++seq);
                u.setStartMs(s.startMs()); u.setEndMs(s.endMs());
                u.setSpeaker(s.speaker() == null || s.speaker().isBlank() ? null : s.speaker().strip());   // Teams names the signed-in speaker
                u.setText(s.text());
                segs.add(u);
                if (segs.size() > 20000) return Check.fail("TRANSCRIPT_TOO_LONG", "This transcript is too long to import.", "Upload it in parts.");
            }
        }
        if (segs.isEmpty()) return Check.fail("NO_TRANSCRIPT", "Teams' transcript for this meeting has no spoken text.", "Upload the recording instead.");
        store.replaceSegments(org, m.getId(), segs);
        m.setLiveState("ENDED"); m.setLiveSource("Microsoft Teams");
        UmaMeeting.TranscriptInfo info = new UmaMeeting.TranscriptInfo();
        info.setOrigin("MS_TEAMS"); info.setEngine("Microsoft Teams"); info.setSegmentCount(segs.size());
        info.setSpeakersKnown(segs.stream().anyMatch(x -> x.getSpeaker() != null)); info.setUpdatedAt(Instant.now());
        m.setTranscript(info);
        m.setProgressPercent(80);
        store.save(m);
        store.transition(org, m.getId(), UmaStatus.ANALYZING, "system", "Writing the summary and finding decisions and actions…", "Teams transcript");
        store.audit(org, m.getId(), "system", "TEAMS_TRANSCRIPT_IMPORTED", segs.size() + " lines");
        return Check.done(segs.size() + " lines from Microsoft Teams.");
    }

    private JsonNode call(String method, String url, String token, String body, Map<String, String> extra) {
        GraphHttp.Result r = send(method, url, token, body, extra, "application/json");
        try { return om.readTree(r.body() == null || r.body().isBlank() ? "{}" : r.body()); }
        catch (IOException e) { throw new UmaException(HttpStatus.BAD_GATEWAY, "MICROSOFT_BAD_RESPONSE", "Microsoft's reply couldn't be read.", "Try again."); }
    }

    private String callText(String url, String token) { return send("GET", url, token, null, Map.of(), "text/vtt").body(); }

    private GraphHttp.Result send(String method, String url, String token, String body, Map<String, String> extra, String accept) {
        Map<String, String> h = new LinkedHashMap<>(extra);
        h.put("Authorization", "Bearer " + token);
        h.put("Accept", accept);
        if (body != null) h.put("Content-Type", "application/json");
        GraphHttp.Result r;
        try { r = http.send(method, url, h, body); }
        catch (IOException e) { throw new UmaException(HttpStatus.SERVICE_UNAVAILABLE, "MICROSOFT_UNAVAILABLE", "Couldn't reach Microsoft.", "It will be tried again."); }
        if (r.status() == 401) throw new UmaException(HttpStatus.CONFLICT, "MICROSOFT_REAUTH_REQUIRED", "Microsoft asked for a new sign-in.", "Connect your Microsoft account again under Connections.");
        if (r.status() == 403) throw new UmaException(HttpStatus.FORBIDDEN, "MICROSOFT_FORBIDDEN", "Microsoft didn't allow this.",
                "Your organisation's admin may need to approve the app's permissions, or your account may not have Teams.");
        if (r.status() == 429 || r.status() >= 500) throw new UmaException(HttpStatus.SERVICE_UNAVAILABLE, "MICROSOFT_UNAVAILABLE", "Microsoft is busy.", "It will be tried again.");
        if (r.status() == 404) throw new UmaException(HttpStatus.NOT_FOUND, "TEAMS_MEETING_NOT_FOUND", "Microsoft couldn't find this meeting.", "Upload the recording instead.");
        if (r.status() < 200 || r.status() >= 300) throw new UmaException(HttpStatus.BAD_REQUEST, "MICROSOFT_REJECTED", "Microsoft didn't accept the request.", "Check the time and the attendees' email addresses.");
        return r;
    }

    private static String enc(String s) { return URLEncoder.encode(s, StandardCharsets.UTF_8).replace("+", "%20"); }
}

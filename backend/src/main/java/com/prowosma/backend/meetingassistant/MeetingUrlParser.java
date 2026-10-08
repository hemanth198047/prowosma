package com.prowosma.backend.meetingassistant;

import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Detects and validates a pasted meeting URL. Pure string/URI logic — this class
 * NEVER opens a connection to the URL, so a hostile link cannot cause a
 * server-side request. Hosts are compared for exact equality (no suffix matching),
 * which rejects look-alikes such as {@code meet.google.com.evil.example}.
 */
public final class MeetingUrlParser {

    private MeetingUrlParser() {}

    public enum Platform { GOOGLE_MEET, MS_TEAMS }

    /**
     * @param meetingKey stable identifier of the meeting (same for every occurrence
     *                   of a recurring meeting that reuses the link)
     * @param warning    non-blocking limitation to show the user, or null
     * @param organizerId Microsoft Entra object id of the organizer (Teams "meetup-join" links carry it), or null
     * @param tenantId    Microsoft tenant id the meeting belongs to (same source), or null
     */
    public record Result(boolean valid, Platform platform, String canonicalUrl, String meetingKey,
                         String errorCode, String message, String warning, String organizerId, String tenantId) {
        static Result ok(Platform p, String url, String key, String warning) {
            return new Result(true, p, url, key, null, null, warning, null, null);
        }
        static Result fail(String code, String msg) {
            return new Result(false, null, null, null, code, msg, null, null, null);
        }
    }

    private static final int MAX_LEN = 2048;
    private static final Pattern MEET_CODE = Pattern.compile("^/([a-z]{3}-[a-z]{4}-[a-z]{3})/?$");
    private static final Pattern MEET_LOOKUP = Pattern.compile("^/lookup/([A-Za-z0-9_-]{4,64})/?$");
    private static final Pattern TEAMS_THREAD = Pattern.compile("^19:meeting_[A-Za-z0-9_-]+@thread\\.(v2|skype)$");
    private static final Pattern TEAMS_MEET_ID = Pattern.compile("^/meet/(\\d{9,15})/?$");
    private static final Pattern GUID = Pattern.compile("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");
    private static final Pattern CTX_OID = Pattern.compile("\"Oid\"\\s*:\\s*\"([^\"]{1,64})\"");
    private static final Pattern CTX_TID = Pattern.compile("\"Tid\"\\s*:\\s*\"([^\"]{1,64})\"");
    private static final Pattern CONTROL_OR_SPACE = Pattern.compile("[\\p{Cntrl}\\s]");

    public static Result parse(String raw) {
        if (raw == null || raw.isBlank()) {
            return Result.fail("EMPTY_URL", "Paste the meeting link to continue.");
        }
        String s = raw.trim();
        if (s.length() > MAX_LEN) {
            return Result.fail("URL_TOO_LONG", "That link is too long to be a meeting link.");
        }
        if (CONTROL_OR_SPACE.matcher(s).find()) {
            return Result.fail("INVALID_URL", "That doesn't look like a single meeting link. Copy it again from the invitation.");
        }
        URI uri;
        try {
            uri = new URI(s);
        } catch (URISyntaxException e) {
            return Result.fail("INVALID_URL", "That doesn't look like a valid link. Copy it again from the invitation.");
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (scheme.equals("http")) {
            return Result.fail("INSECURE_URL", "Meeting links must start with https://");
        }
        if (!scheme.equals("https") || uri.getHost() == null) {
            return Result.fail("INVALID_URL", "Paste the full meeting link, starting with https://");
        }
        if (uri.getUserInfo() != null || (uri.getPort() != -1 && uri.getPort() != 443)) {
            return Result.fail("INVALID_URL", "That link has unexpected parts and can't be used.");
        }
        String host = uri.getHost().toLowerCase(Locale.ROOT);
        String path = uri.getRawPath() == null ? "" : uri.getRawPath();

        switch (host) {
            case "meet.google.com":
                return parseMeet(path);
            case "teams.microsoft.com":
                return parseTeams(host, path, uri.getRawQuery(), false);
            case "teams.live.com":
                return parseTeams(host, path, uri.getRawQuery(), true);
            case "g.co":
            case "meet.app.goo.gl":
                return Result.fail("UNSUPPORTED_SHORT_LINK",
                        "Short links can't be checked safely. Open the link, then copy the full meet.google.com address.");
            default:
                if (host.equals("zoom.us") || host.endsWith(".zoom.us")) {
                    return Result.fail("UNSUPPORTED_PLATFORM", "Zoom isn't supported yet. Google Meet and Microsoft Teams are.");
                }
                return Result.fail("UNSUPPORTED_PLATFORM",
                        "This isn't a Google Meet or Microsoft Teams link.");
        }
    }

    private static String rawQueryParam(String rawQuery, String name) {
        if (rawQuery == null) return null;
        for (String kv : rawQuery.split("&")) {
            int i = kv.indexOf('=');
            if (i > 0 && kv.substring(0, i).equals(name)) {
                String v = kv.substring(i + 1);
                return v.length() <= 600 && v.matches("[A-Za-z0-9%._~\\-]*") ? v : null;       // only characters that can't change the URL's meaning
            }
        }
        return null;
    }

    private static String guidFrom(String rawContext, Pattern field) {
        if (rawContext == null) return null;
        try {
            var m = field.matcher(URLDecoder.decode(rawContext, StandardCharsets.UTF_8));
            if (m.find() && GUID.matcher(m.group(1)).matches()) return m.group(1).toLowerCase(Locale.ROOT);
        } catch (IllegalArgumentException e) {
            return null;
        }
        return null;
    }

    private static Result parseMeet(String path) {
        var code = MEET_CODE.matcher(path);
        if (code.matches()) {
            return Result.ok(Platform.GOOGLE_MEET, "https://meet.google.com/" + code.group(1), code.group(1), null);
        }
        var lookup = MEET_LOOKUP.matcher(path);
        if (lookup.matches()) {
            return Result.ok(Platform.GOOGLE_MEET, "https://meet.google.com/lookup/" + lookup.group(1),
                    "lookup:" + lookup.group(1), null);
        }
        return Result.fail("INVALID_MEET_LINK",
                "Google Meet links look like meet.google.com/abc-defg-hij.");
    }

    private static Result parseTeams(String host, String path, String rawQuery, boolean personal) {
        String warning = personal
                ? "Personal Microsoft accounts don't allow transcript retrieval. You'll need to upload the transcript yourself."
                : null;
        var meetId = TEAMS_MEET_ID.matcher(path);
        if (meetId.matches()) {
            // Passcode (?p=...) is a secret: it is deliberately dropped from the canonical form.
            return Result.ok(Platform.MS_TEAMS, "https://" + host + "/meet/" + meetId.group(1),
                    "meet:" + meetId.group(1), warning);
        }
        if (!personal && path.startsWith("/l/meetup-join/")) {
            String[] seg = path.split("/");
            // ["", "l", "meetup-join", "<thread>", "<n>"]
            if (seg.length >= 4) {
                String thread;
                try {
                    thread = URLDecoder.decode(seg[3], StandardCharsets.UTF_8);
                } catch (IllegalArgumentException e) {
                    return Result.fail("INVALID_TEAMS_LINK", "That Teams link couldn't be read. Copy it again from the invitation.");
                }
                if (TEAMS_THREAD.matcher(thread).matches()) {
                    // The organizer and tenant ids Teams embeds in the link are used to find the transcript later. They are accepted
                    // ONLY if they are well-formed GUIDs; nothing else from the query string is kept (no URL, no passcode).
                    String ctx = rawQueryParam(rawQuery, "context");
                    return new Result(true, Platform.MS_TEAMS, "https://" + host + "/l/meetup-join/" + seg[3], thread, null, null, warning,
                            guidFrom(ctx, CTX_OID), guidFrom(ctx, CTX_TID));
                }
            }
        }
        return Result.fail("INVALID_TEAMS_LINK",
                "Teams meeting links contain /l/meetup-join/ or /meet/. Copy the \"Join the meeting\" link from the invitation.");
    }
}

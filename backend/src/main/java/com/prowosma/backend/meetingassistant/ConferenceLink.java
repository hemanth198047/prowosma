package com.prowosma.backend.meetingassistant;

import java.net.URI;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Recognises the meeting links a notetaker service can join — Google Meet, Zoom, Microsoft Teams and Webex — and reduces each to a stable KEY, so a
 * transcript can be matched to the meeting it came from however the link was written (extra parameters, another Zoom region, a trailing slash…).
 * Only https links on those platforms' own domains are accepted: the link is handed to a third party, so nothing else may pass.
 */
public final class ConferenceLink {

    private ConferenceLink() {}

    public static final String GOOGLE_MEET = "GOOGLE_MEET";
    public static final String ZOOM = "ZOOM";
    public static final String MS_TEAMS = "MS_TEAMS";
    public static final String WEBEX = "WEBEX";

    /** {@code url} is what is sent to the notetaker (query kept: Zoom passcodes live there; fragment removed); {@code key} is for matching only. */
    public record Link(String platform, String url, String key) {}

    private static final Pattern MEET_PATH = Pattern.compile("^/([a-z]{3}-[a-z]{4}-[a-z]{3})/?$");
    private static final Pattern ZOOM_PATH = Pattern.compile("^/(?:j|wc/join|s)/(\\d{8,12})/?$");
    private static final Pattern ZOOM_PERSONAL = Pattern.compile("^/my/([A-Za-z0-9._-]{1,64})/?$");
    private static final Pattern TEAMS_MEET = Pattern.compile("^/meet/(\\d{6,20})/?$");
    private static final Pattern TEAMS_JOIN = Pattern.compile("^/l/meetup-join/([^/]{10,300})(?:/.*)?$");
    private static final String SUPPORTED = "Fireflies works with Google Meet, Zoom, Microsoft Teams and Webex links.";

    public static String platformName(String platform) {
        if (platform == null) return "Unknown platform";
        return switch (platform) {
            case GOOGLE_MEET -> "Google Meet";
            case ZOOM -> "Zoom";
            case MS_TEAMS -> "Microsoft Teams";
            case WEBEX -> "Webex";
            default -> platform;
        };
    }

    public static Link parse(String raw) {
        if (raw == null || raw.isBlank()) throw new IllegalArgumentException("Paste the meeting link first.");
        String s = raw.trim();
        if (s.length() > 2000) throw new IllegalArgumentException("That link is too long.");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (Character.isWhitespace(c) || Character.isISOControl(c)) throw new IllegalArgumentException("A meeting link can't contain spaces or hidden characters.");
        }
        URI uri;
        try { uri = new URI(s); } catch (Exception e) { throw new IllegalArgumentException("That doesn't look like a valid link."); }
        if (!"https".equalsIgnoreCase(uri.getScheme())) throw new IllegalArgumentException("Meeting links must start with https://");
        if (uri.getUserInfo() != null) throw new IllegalArgumentException("A meeting link can't contain a user name or password.");
        if (uri.getHost() == null) throw new IllegalArgumentException("That doesn't look like a valid link.");
        String host = uri.getHost().toLowerCase(Locale.ROOT);
        String path = uri.getRawPath() == null ? "" : uri.getRawPath();
        String clean = s.contains("#") ? s.substring(0, s.indexOf('#')) : s;

        if (host.equals("meet.google.com")) {
            Matcher m = MEET_PATH.matcher(path);
            if (!m.matches()) throw new IllegalArgumentException("That doesn't look like a Google Meet link (it should end in a code like abc-defg-hij).");
            return new Link(GOOGLE_MEET, clean, "meet:" + m.group(1));
        }
        if (host.equals("zoom.us") || host.endsWith(".zoom.us") || host.equals("zoomgov.com") || host.endsWith(".zoomgov.com")) {
            Matcher m = ZOOM_PATH.matcher(path);
            if (m.matches()) return new Link(ZOOM, clean, "zoom:" + m.group(1));
            Matcher p = ZOOM_PERSONAL.matcher(path);
            if (p.matches()) return new Link(ZOOM, clean, "zoom:my:" + p.group(1).toLowerCase(Locale.ROOT));
            throw new IllegalArgumentException("That doesn't look like a Zoom meeting link (it should contain /j/ and the meeting number).");
        }
        if (host.equals("teams.microsoft.com") || host.equals("teams.live.com")) {
            Matcher m = TEAMS_MEET.matcher(path);
            if (m.matches()) return new Link(MS_TEAMS, clean, "teams:meet:" + m.group(1));
            Matcher j = TEAMS_JOIN.matcher(path);
            if (j.matches()) return new Link(MS_TEAMS, clean, "teams:join:" + j.group(1).toLowerCase(Locale.ROOT));
            throw new IllegalArgumentException("That doesn't look like a Microsoft Teams meeting link.");
        }
        if (host.endsWith(".webex.com") || host.equals("webex.com")) {
            if (path.length() < 2) throw new IllegalArgumentException("That doesn't look like a Webex meeting link.");
            return new Link(WEBEX, clean, "webex:" + host + path.replaceAll("/+$", "").toLowerCase(Locale.ROOT));
        }
        throw new IllegalArgumentException(SUPPORTED);
    }

    /** The matching key of a link, or null if it isn't a link we recognise. Never throws. */
    public static String keyOf(String raw) {
        try { return parse(raw).key(); } catch (RuntimeException e) { return null; }
    }
}

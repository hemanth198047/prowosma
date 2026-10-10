package com.prowosma.backend.meetingassistant;

import com.prowosma.backend.meetingassistant.FirefliesMatcher.Decision;

import java.util.LinkedHashMap;
import java.util.Map;

/** Plain-language explanations of what Fireflies answered, shown on the waiting meeting. Only counts and states — never keys, titles or transcript text. */
public final class FirefliesReport {

    private FirefliesReport() {}

    public record Report(String code, String message, Map<String, Object> facts) {}

    private static Map<String, Object> facts(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) if (kv[i + 1] != null) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    public static Report waiting(Decision d) {
        StringBuilder m = new StringBuilder();
        if (d.linkMatches() == 0) {
            m.append("Fireflies has no transcript for this meeting yet. The notetaker (it appears as a participant named \"Fireflies\" or \"Fred\") has to be ")
                    .append("admitted to the meeting by the host before it can record — check that someone let it in. Prowosma looked at your ")
                    .append(d.returned()).append(" most recent Fireflies meeting").append(d.returned() == 1 ? "" : "s").append(" and none came from this meeting link.");
        } else if (d.alreadyImported() > 0 && d.alreadyImported() == d.linkMatches() - d.outsideWindow()) {
            m.append("Fireflies has a transcript for this link, but it was already imported for another meeting in Prowosma.");
        } else {
            m.append("Fireflies has transcripts for this link, but none from around the time of this meeting.");
        }
        return new Report("FIREFLIES_WAITING", m.toString(), facts("recentMeetingsChecked", d.returned(), "fromThisLink", d.linkMatches(), "alreadyImported", d.alreadyImported(), "fromOtherTimes", d.outsideWindow()));
    }

    public static Report live() {
        return new Report("FIREFLIES_LIVE", "The Fireflies notetaker is in the meeting (or still recording it). Prowosma imports the transcript after the meeting ends.", facts());
    }

    public static Report processing() {
        return new Report("FIREFLIES_PROCESSING", "The meeting has ended and Fireflies is still processing the transcript. This usually takes a few minutes; Prowosma will check again.", facts());
    }

    public static Report imported(int lines) {
        return new Report("FIREFLIES_IMPORTED", "The transcript was imported from Fireflies (" + lines + " lines).", facts("lines", lines));
    }

    public static Report sent(String platform) {
        return new Report("FIREFLIES_SENT", "The Fireflies notetaker was sent to your " + ConferenceLink.platformName(platform)
                + " meeting. If you're the host, look for it in the lobby or participant list and admit it. Prowosma imports the transcript after the meeting ends.", facts("platform", platform));
    }

    public static Report problem(String kind) {
        return switch (kind == null ? "" : kind) {
            case "AUTH" -> new Report("FIREFLIES_KEY_REJECTED", "Fireflies rejected the saved API key. An admin needs to enter a new one in the Fireflies settings.", facts());
            case "PLAN" -> new Report("FIREFLIES_PLAN", "Your Fireflies plan or account doesn't allow this. Check the plan and that the account is active.", facts());
            case "RATE_LIMITED" -> new Report("FIREFLIES_RATE_LIMITED", "Fireflies' daily or per-minute request limit was reached. Prowosma will try again automatically after the pause Fireflies asked for.", facts());
            case "NOT_FOUND" -> new Report("FIREFLIES_NOT_FOUND", "Fireflies couldn't find that transcript, or this account has no access to it.", facts());
            default -> new Report("FIREFLIES_TEMPORARY", "Fireflies didn't answer properly just now (a temporary problem). Prowosma will try again automatically.", facts());
        };
    }
}

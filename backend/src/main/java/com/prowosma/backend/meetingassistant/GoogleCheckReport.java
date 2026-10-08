package com.prowosma.backend.meetingassistant;

import com.prowosma.backend.meetingassistant.ConferenceSelector.Conference;
import com.prowosma.backend.meetingassistant.ConferenceSelector.Diagnosis;

import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Turns what Google answered into a plain-language explanation for the person waiting. Every automatic check, and every press of
 * "Check now", records one of these on the meeting — so the page can say what Google actually said instead of repeating the
 * message written when the meeting was registered.
 *
 * Nothing in here contains tokens, transcript text or participant names; only counts, states and times.
 */
public final class GoogleCheckReport {

    private GoogleCheckReport() {}

    public record Report(String code, String message, Map<String, Object> facts) {}

    public record TranscriptFact(String state, Instant start, Instant end) {}

    /** True for consumer accounts. Google describes saved Meet transcripts as a Google Workspace feature. */
    public static boolean isPersonalAccount(String email) {
        if (email == null) return false;
        String e = email.trim().toLowerCase(Locale.ROOT);
        return e.endsWith("@gmail.com") || e.endsWith("@googlemail.com");
    }

    private static String ago(Instant t, Instant now) {
        if (t == null) return "a while ago";
        long min = Math.max(0, Duration.between(t, now).toMinutes());
        if (min < 1) return "less than a minute ago";
        if (min == 1) return "1 minute ago";
        if (min < 120) return min + " minutes ago";
        return Math.round(min / 60.0) + " hours ago";
    }

    private static Map<String, Object> facts(String account, Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("connectedAccount", account);
        m.put("accountType", isPersonalAccount(account) ? "PERSONAL" : "WORKSPACE_OR_OTHER");
        for (int i = 0; i + 1 < kv.length; i += 2) if (kv[i + 1] != null) m.put((String) kv[i], kv[i + 1] instanceof Instant t ? t.toString() : kv[i + 1]);
        return m;
    }

    private static final String PERSONAL_NOTE = " Note: you're connected as a personal Google account (" + "%s" + "). Google describes saved Meet transcripts as a Google Workspace "
            + "feature, so a personal account often has none — see \"How to turn on a transcript\" below, or upload the transcript.";

    // ── no conference record ─────────────────────────────────────────────────

    public static Report noConference(Diagnosis d, String account, Instant now) {
        StringBuilder m = new StringBuilder();
        if (d.returned() == 0) {
            m.append("Google has no record of this meeting under the connected Google account");
            if (account != null) m.append(" (").append(account).append(")");
            m.append(" yet. Meeting records usually appear shortly after the meeting ends. If it ended a few minutes ago, wait and check again. If it ended a while ago, "
                    + "check that you connected the same Google account that organized (or attended) the meeting, and that this is the right meeting link.");
        } else if (d.claimedByOtherMeetings() > 0 && d.inWindow() == d.claimedByOtherMeetings()) {
            m.append("Google has a record for this link, but it was already imported for another meeting in Prowosma. A reused link makes one record per meeting; "
                    + "this one is still waiting for its own.");
        } else {
            m.append("Google returned ").append(d.returned()).append(d.returned() == 1 ? " record" : " records").append(" for this link, but none from the time of this meeting. ")
                    .append("Prowosma looks for a meeting that started around when you registered it.");
            if (d.latestOutsideWindow() != null) m.append(" The closest one started ").append(ago(d.latestOutsideWindow(), now)).append(".");
        }
        if (isPersonalAccount(account)) m.append(String.format(PERSONAL_NOTE, account));
        return new Report("NO_CONFERENCE_YET", m.toString(),
                facts(account, "recordsReturned", d.returned(), "recordsFromThisMeetingsTime", d.inWindow(), "alreadyImportedElsewhere", d.claimedByOtherMeetings(),
                        "recordsFromOtherTimes", d.outsideWindow()));
    }

    // ── meeting still running ────────────────────────────────────────────────

    public static Report inProgress(Conference c, String account, Instant now) {
        String m = "Google still shows this meeting as running (it started " + ago(c.start(), now) + "). A meeting only ends in Google's records when everyone has left — "
                + "including anyone still in the call on another tab or device. Make sure every participant has left, then check again.";
        return new Report("MEETING_IN_PROGRESS", m, facts(account, "meetingStarted", c.start(), "meetingEnded", null));
    }

    // ── transcripts ──────────────────────────────────────────────────────────

    public static Report transcriptNotReady(Conference c, List<TranscriptFact> all, String account, Instant now) {
        long active = all.stream().filter(t -> !"ENDED".equals(t.state()) && !"FILE_GENERATED".equals(t.state())).count();
        String m = active > 0
                ? "Transcription is still running for this meeting (Google shows " + active + " active transcription session" + (active == 1 ? "" : "s") + "). "
                  + "Stop it with Activities → Transcripts → Stop transcription, or end the meeting for everyone, and Prowosma will import it."
                : "Google is still preparing the transcript file. This normally takes a few minutes after the meeting ends. Prowosma will check again shortly.";
        return new Report("TRANSCRIPT_NOT_READY", m, facts(account, "meetingStarted", c.start(), "meetingEnded", c.end(), "transcriptSessions", all.size(), "transcriptsStillRunning", (int) active));
    }

    public static Report noTranscript(Conference c, Instant now, Instant giveUpAt, String account) {
        StringBuilder m = new StringBuilder("The meeting ended ").append(ago(c.end(), now))
                .append(", but Google has no transcript for it. A transcript only exists if it was started during the meeting (Activities → Transcripts → Start transcription). ")
                .append("Turning on captions does not save anything, and Gemini's meeting notes are a separate thing from a transcript.");
        if (giveUpAt != null && giveUpAt.isAfter(now))
            m.append(" Prowosma will keep checking for about ").append(Math.max(1, Duration.between(now, giveUpAt).toMinutes())).append(" more minutes, then ask you to upload the transcript instead.");
        if (isPersonalAccount(account)) m.append(String.format(PERSONAL_NOTE, account));
        return new Report("NO_TRANSCRIPT_YET", m.toString(),
                facts(account, "meetingStarted", c.start(), "meetingEnded", c.end(), "transcriptSessions", 0, "willKeepCheckingUntil", giveUpAt));
    }

    public static Report imported(int lines, String account) {
        return new Report("IMPORTED", "Transcript imported from Google Meet (" + lines + " lines).", facts(account, "lines", lines));
    }

    // ── errors talking to Google ─────────────────────────────────────────────

    public static Report googleProblem(String kind, String account) {
        return switch (kind == null ? "" : kind) {
            case "UNAUTHORIZED" -> new Report("GOOGLE_SIGN_IN_EXPIRED", "Google rejected the saved sign-in. Reconnect your Google account under Integrations → Meeting Platforms.", facts(account));
            case "FORBIDDEN" -> new Report("GOOGLE_ACCESS_DENIED", "Google didn't allow access to this meeting's records. Only the organizer and participants can read them — connect the Google account that was in the meeting.", facts(account));
            case "RATE_LIMITED", "SERVER", "NETWORK" -> new Report("GOOGLE_TEMPORARY", "Google didn't answer properly just now (a temporary problem). Prowosma will try again automatically.", facts(account));
            default -> new Report("GOOGLE_PROBLEM", "Google returned an unexpected answer. Prowosma will try again automatically.", facts(account));
        };
    }

    public static Report notConnected(String account) {
        return new Report("GOOGLE_NOT_CONNECTED", "Your Google account isn't connected, so Prowosma can't look for this meeting. Connect it under Integrations → Meeting Platforms.", facts(account));
    }
}

package com.prowosma.backend.meetingassistant;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/** Turns a notetaker's sentences into transcript lines. Pure logic: cleans text and names, converts times to milliseconds, and never trusts the units blindly. */
public final class FirefliesMapper {

    private FirefliesMapper() {}

    public record Sentence(String speaker, String text, Double start, Double end) {}
    public record Line(long startMs, long endMs, String speaker, String text) {}

    private static final Pattern CONTROL = Pattern.compile("[\\p{Cntrl}&&[^\\n\\t]]");

    static String clean(String t) {
        return t == null ? "" : CONTROL.matcher(t).replaceAll(" ").replaceAll("\\s+", " ").strip();
    }

    /**
     * The service documents times in seconds. If the largest time is wildly more than the meeting's own length (in minutes) they must be milliseconds —
     * a mistake here would make every line seem hours long, so it is checked rather than assumed.
     */
    static boolean looksLikeMilliseconds(List<Sentence> sentences, Double durationMinutes) {
        if (durationMinutes == null || durationMinutes <= 0) return false;
        double max = 0;
        for (Sentence s : sentences) if (s != null && s.end() != null) max = Math.max(max, s.end());
        return max > durationMinutes * 60 * 10;
    }

    public static List<Line> toLines(List<Sentence> sentences, Double durationMinutes) {
        List<Line> out = new ArrayList<>();
        if (sentences == null) return out;
        double factor = looksLikeMilliseconds(sentences, durationMinutes) ? 1.0 : 1000.0;
        for (Sentence s : sentences) {
            if (s == null) continue;
            String text = clean(s.text());
            if (text.isEmpty()) continue;
            String who = clean(s.speaker());
            if (who.length() > 100) who = who.substring(0, 100);
            long start = s.start() == null ? 0 : Math.max(0, Math.round(s.start() * factor));
            long end = s.end() == null ? start : Math.max(start, Math.round(s.end() * factor));
            out.add(new Line(start, end, who.isEmpty() ? null : who, text));
        }
        return out;
    }
}

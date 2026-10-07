package com.prowosma.backend.meetingassistant;

import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Turns a pasted or uploaded transcript (WebVTT, SRT or plain text) into segments. Pure string logic.
 * The text is treated strictly as DATA: nothing in it is interpreted, executed or fetched. Speakers are only
 * what the file itself states; nobody is guessed, and unlabeled speech keeps a null speaker ("unknown").
 */
public final class TranscriptParser {

    private TranscriptParser() {}

    public static final int MAX_SEGMENTS = 50_000;
    public static final int MAX_TEXT = 4_000;

    public record Segment(Long startMs, Long endMs, String speaker, String text) {}
    public record Parsed(String format, List<Segment> segments, List<String> warnings) {}

    public static class TranscriptFormatException extends RuntimeException {
        private final String code;
        public TranscriptFormatException(String code, String message) { super(message); this.code = code; }
        public String getCode() { return code; }
    }

    private static final String TS = "(?:\\d{1,2}:)?\\d{1,2}:\\d{2}(?:[.,]\\d{1,3})?";
    private static final Pattern CUE_LINE = Pattern.compile("^\\s*(" + TS + ")\\s*-->\\s*(" + TS + ")");
    private static final Pattern SRT_HINT = Pattern.compile("(?m)^\\d{1,2}:\\d{2}:\\d{2},\\d{3}\\s*-->");
    private static final Pattern LEADING_TS = Pattern.compile("^[\\[(]?(" + TS + ")[\\])]?\\s*[-–—]?\\s*(.*)$");
    private static final Pattern VOICE = Pattern.compile("<v(?:\\.[^\\s>]*)?\\s+([^>]+)>");
    private static final Pattern TAG = Pattern.compile("<[^>]+>");
    private static final Pattern LABEL = Pattern.compile("^(\\p{L}[\\p{L}\\p{N} .'’\\-]{0,59}?):\\s+(\\S.*)$");

    private record Raw(Long start, Long end, String speaker, String text) {}

    public static Parsed parse(String content, String formatHint) {
        if (content == null || content.isBlank())
            throw new TranscriptFormatException("EMPTY_TRANSCRIPT", "The transcript is empty.");
        String s = content.replace("\uFEFF", "").replace("\r\n", "\n").replace('\r', '\n')
                .replaceAll("[\\p{Cntrl}&&[^\n\t]]", "");
        String format = detect(s, formatHint);
        List<String> warnings = new ArrayList<>();
        List<Raw> raw = switch (format) {
            case "VTT", "SRT" -> parseCues(s);
            default -> parseText(s);
        };
        List<Segment> out = applySpeakerLabels(raw, warnings);
        if (out.isEmpty())
            throw new TranscriptFormatException("NO_SEGMENTS", "No spoken text could be found in that file.");
        if (out.size() > MAX_SEGMENTS)
            throw new TranscriptFormatException("TOO_MANY_SEGMENTS",
                    "That transcript is too long to import in one go (limit " + MAX_SEGMENTS + " lines).");
        return new Parsed(format, out, warnings);
    }

    private static String detect(String s, String hint) {
        if (hint != null) {
            String h = hint.trim().toUpperCase(Locale.ROOT);
            if (h.equals("VTT") || h.equals("SRT") || h.equals("TEXT")) return h;
        }
        if (s.stripLeading().startsWith("WEBVTT")) return "VTT";
        if (SRT_HINT.matcher(s).find()) return "SRT";
        return "TEXT";
    }

    // ── cues (VTT / SRT) ─────────────────────────────────────────────────────

    private static List<Raw> parseCues(String s) {
        List<Raw> out = new ArrayList<>();
        for (String block : s.split("\n\\s*\n")) {
            String[] lines = block.strip().split("\n");
            int cue = -1;
            for (int i = 0; i < lines.length; i++) if (CUE_LINE.matcher(lines[i]).find()) { cue = i; break; }
            if (cue < 0) continue;                       // WEBVTT header, NOTE, STYLE, stray text
            Matcher m = CUE_LINE.matcher(lines[cue]);
            m.find();
            Long start = ms(m.group(1)), end = ms(m.group(2));
            StringBuilder text = new StringBuilder();
            String speaker = null;
            for (int i = cue + 1; i < lines.length; i++) {
                String line = lines[i];
                Matcher v = VOICE.matcher(line);
                if (speaker == null && v.find()) speaker = clean(v.group(1));
                String plain = decode(TAG.matcher(line).replaceAll("")).strip();
                if (!plain.isEmpty()) { if (text.length() > 0) text.append(' '); text.append(plain); }
            }
            if (text.length() > 0) out.add(new Raw(start, end, speaker, text.toString()));
        }
        return out;
    }

    // ── plain text ───────────────────────────────────────────────────────────

    private static List<Raw> parseText(String s) {
        List<Raw> out = new ArrayList<>();
        for (String line : s.split("\n")) {
            String l = line.strip();
            if (l.isEmpty()) continue;
            Long start = null;
            Matcher m = LEADING_TS.matcher(l);
            if (m.matches() && !m.group(2).isBlank()) { start = ms(m.group(1)); l = m.group(2).strip(); }
            out.add(new Raw(start, null, null, l));
        }
        return out;
    }

    /**
     * "Name: text" is treated as a speaker only when the same label appears at least twice — so a one-off
     * line such as "Action: send the report" is never mistaken for a person.
     */
    private static List<Segment> applySpeakerLabels(List<Raw> raw, List<String> warnings) {
        Map<String, Integer> counts = new HashMap<>();
        for (Raw r : raw) {
            if (r.speaker() != null) continue;
            Matcher m = LABEL.matcher(r.text());
            if (m.matches() && plausibleName(m.group(1))) counts.merge(m.group(1).strip().toLowerCase(Locale.ROOT), 1, Integer::sum);
        }
        List<Segment> out = new ArrayList<>();
        for (Raw r : raw) {
            String speaker = r.speaker();
            String text = r.text();
            if (speaker == null) {
                Matcher m = LABEL.matcher(text);
                if (m.matches() && plausibleName(m.group(1))
                        && counts.getOrDefault(m.group(1).strip().toLowerCase(Locale.ROOT), 0) >= 2) {
                    speaker = clean(m.group(1));
                    text = m.group(2).strip();
                }
            }
            for (String chunk : chunks(text)) out.add(new Segment(r.start(), r.end(), speaker, chunk));
        }
        boolean anySpeaker = out.stream().anyMatch(x -> x.speaker() != null);
        if (!anySpeaker) warnings.add("No speaker names were found; speakers are shown as unknown.");
        return out;
    }

    private static boolean plausibleName(String label) {
        String l = label.strip();
        return !l.isEmpty() && l.split("\\s+").length <= 6 && !l.matches(".*\\d{2,}.*") && !l.toLowerCase(Locale.ROOT).startsWith("http");
    }

    private static List<String> chunks(String text) {
        List<String> out = new ArrayList<>();
        String t = text.strip();
        while (t.length() > MAX_TEXT) {
            int cut = t.lastIndexOf(' ', MAX_TEXT);
            if (cut < MAX_TEXT / 2) cut = MAX_TEXT;
            out.add(t.substring(0, cut).strip());
            t = t.substring(cut).strip();
        }
        if (!t.isEmpty()) out.add(t);
        return out;
    }

    private static String clean(String s) {
        String c = s == null ? "" : s.strip().replaceAll("\\s+", " ");
        if (c.length() > 80) c = c.substring(0, 80);
        return c.isEmpty() ? null : c;
    }

    private static String decode(String s) {
        return s.replace("&nbsp;", " ").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&amp;", "&");
    }

    /** "01:02:03.456", "02:03,456" or "02:03" → milliseconds. */
    static Long ms(String ts) {
        try {
            String[] p = ts.replace(',', '.').split(":");
            long h = 0, m, sec;
            double secs;
            if (p.length == 3) { h = Long.parseLong(p[0]); m = Long.parseLong(p[1]); secs = Double.parseDouble(p[2]); }
            else { m = Long.parseLong(p[0]); secs = Double.parseDouble(p[1]); }
            sec = (long) secs;
            long millis = Math.round((secs - sec) * 1000);
            return ((h * 60 + m) * 60 + sec) * 1000 + millis;
        } catch (RuntimeException e) {
            return null;
        }
    }
}

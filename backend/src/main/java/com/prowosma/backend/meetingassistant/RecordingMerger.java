package com.prowosma.backend.meetingassistant;

import java.util.*;
import java.util.regex.Pattern;

/**
 * Turns the speech-to-text results of many short audio pieces — from the recording person's microphone and from the meeting tab —
 * into one ordered transcript. Pure logic: offsets each piece to the meeting clock, labels speakers by track, drops what is almost
 * certainly silence mis-heard as speech, and removes the microphone's echo of the meeting audio (when the person isn't wearing headphones).
 */
public final class RecordingMerger {

    private RecordingMerger() {}

    public static final String YOU = "You";
    public static final String OTHERS = "Other participants";

    /** One recognised phrase, relative to the start of its own audio piece. */
    public record Seg(long startMs, long endMs, String text, Double noSpeechProb) {}
    /** One audio piece's results; {@code offsetMs} is where the piece begins on the meeting clock. */
    public record Piece(String track, long offsetMs, List<Seg> segments) {}
    public record Line(long startMs, long endMs, String speaker, String text) {}

    private static final Set<String> FILLER = Set.of("thank you", "thanks for watching", "thank you for watching", "you", "bye", "bye bye",
            "please subscribe", "subtitles by the amaraorg community");
    private static final Pattern CONTROL = Pattern.compile("[\\p{Cntrl}&&[^\\n\\t]]");
    private static final Pattern NON_WORD = Pattern.compile("[^\\p{L}\\p{N} ]");
    static final long ECHO_WINDOW_MS = 4000;
    static final double ECHO_SIMILARITY = 0.7;
    static final double NO_SPEECH_CUTOFF = 0.8;

    public static String speakerOf(String track) {
        if (RecordingRules.TRACK_MIC.equals(track)) return YOU;
        if (RecordingRules.TRACK_TAB.equals(track)) return OTHERS;
        return null;                                                  // an uploaded file: speakers are unknown, and shown as unknown
    }

    static String clean(String t) {
        if (t == null) return "";
        return CONTROL.matcher(t).replaceAll(" ").replaceAll("\\s+", " ").strip();
    }

    /** Whisper-style models sometimes "hear" stock phrases in silence. Dropped only when the model itself says it was probably not speech. */
    static boolean looksLikeSilenceHallucination(String text, Double noSpeechProb) {
        if (noSpeechProb == null) return false;
        if (noSpeechProb >= NO_SPEECH_CUTOFF) return true;
        String norm = NON_WORD.matcher(text.toLowerCase(Locale.ROOT)).replaceAll("").strip();
        return noSpeechProb >= 0.5 && FILLER.contains(norm);
    }

    static Set<String> words(String text) {
        Set<String> out = new HashSet<>();
        for (String w : NON_WORD.matcher(text.toLowerCase(Locale.ROOT)).replaceAll("").split(" ")) if (!w.isBlank()) out.add(w);
        return out;
    }

    static double similarity(String a, String b) {
        Set<String> x = words(a), y = words(b);
        if (x.isEmpty() || y.isEmpty()) return 0;
        Set<String> inter = new HashSet<>(x);
        inter.retainAll(y);
        Set<String> union = new HashSet<>(x);
        union.addAll(y);
        return (double) inter.size() / union.size();
    }

    public static List<Line> merge(List<Piece> pieces) {
        List<Line> mic = new ArrayList<>(), others = new ArrayList<>();
        if (pieces != null) {
            for (Piece p : pieces) {
                if (p == null || p.segments() == null) continue;
                String speaker = speakerOf(p.track());
                for (Seg s : p.segments()) {
                    String text = clean(s.text());
                    if (text.isEmpty() || looksLikeSilenceHallucination(text, s.noSpeechProb())) continue;
                    long start = Math.max(0, p.offsetMs() + Math.max(0, s.startMs()));
                    long end = Math.max(start, p.offsetMs() + Math.max(0, s.endMs()));
                    Line line = new Line(start, end, speaker, text);
                    (YOU.equals(speaker) ? mic : others).add(line);
                }
            }
        }
        // Without headphones the microphone also hears the meeting. A "You" line that repeats a nearby line from the meeting audio is that echo.
        List<Line> merged = new ArrayList<>(others);
        for (Line m : mic) {
            boolean echo = false;
            if (words(m.text()).size() >= 3) {
                for (Line o : others) {
                    if (Math.abs(o.startMs() - m.startMs()) <= ECHO_WINDOW_MS && similarity(o.text(), m.text()) >= ECHO_SIMILARITY) { echo = true; break; }
                }
            }
            if (!echo) merged.add(m);
        }
        merged.sort(Comparator.comparingLong(Line::startMs).thenComparing(l -> l.speaker() == null ? "" : l.speaker()));
        return merged;
    }
}

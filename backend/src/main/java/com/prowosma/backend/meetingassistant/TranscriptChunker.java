package com.prowosma.backend.meetingassistant;

import java.util.ArrayList;
import java.util.List;

/**
 * Splits a transcript for the model without ever dropping a line: chunks break only between lines, every line
 * lands in exactly one chunk, and line numbers stay global so evidence from any chunk points at the real transcript.
 */
public final class TranscriptChunker {

    private TranscriptChunker() {}

    public record Line(int seq, Long startMs, String speaker, String text) {}
    public record Chunk(int index, int fromSeq, int toSeq, int lineCount, String text) {}

    /** "[12] Priya Nair: text" — unknown speakers are labelled as such, never guessed. */
    public static String render(Line l) {
        String who = l.speaker() == null || l.speaker().isBlank() ? "Unknown speaker" : l.speaker();
        return "[" + l.seq() + "] " + who + ": " + PromptBuilder.neutralize(l.text());
    }

    public static int totalChars(List<Line> lines) {
        int n = 0;
        for (Line l : lines) n += render(l).length() + 1;
        return n;
    }

    public static List<Chunk> chunk(List<Line> lines, int maxChars) {
        List<Chunk> out = new ArrayList<>();
        StringBuilder sb = new StringBuilder();
        int from = -1, last = -1, count = 0;
        for (Line l : lines) {
            String r = render(l);
            if (count > 0 && sb.length() + r.length() + 1 > maxChars) {
                out.add(new Chunk(out.size(), from, last, count, sb.toString()));
                sb.setLength(0);
                count = 0;
            }
            if (count == 0) from = l.seq();
            sb.append(r).append('\n');
            last = l.seq();
            count++;
        }
        if (count > 0) out.add(new Chunk(out.size(), from, last, count, sb.toString()));
        return out;
    }

    /** Halves a chunk's lines — used when the model's answer for a chunk was cut off. */
    public static List<List<Line>> halve(List<Line> lines) {
        int mid = Math.max(1, lines.size() / 2);
        return List.of(lines.subList(0, mid), lines.subList(mid, lines.size()));
    }
}

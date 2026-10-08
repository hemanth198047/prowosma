package com.prowosma.backend.meetingassistant;

import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.function.Predicate;

/**
 * Decides which Google Meet conference record belongs to a session, and how completely a transcript covers it.
 * Pure logic so the tricky cases (recurring links, late registration, partial transcription) are unit-tested.
 */
public final class ConferenceSelector {

    private ConferenceSelector() {}

    public record Conference(String name, Instant start, Instant end) {}
    public record Span(Instant start, Instant end) {}
    public record Coverage(boolean partial, double ratio, String note) {}

    /**
     * Earliest not-yet-claimed conference that started in the window around the session's anchor time.
     * A recurring link produces one record per occurrence; "claimed" excludes records already imported for
     * another session so the evening session never re-imports the morning meeting.
     */
    public static Optional<Conference> select(List<Conference> records, Instant anchor, boolean registeredAfterStart,
                                              Predicate<String> claimed) {
        Instant from = anchor.minus(registeredAfterStart ? Duration.ofHours(3) : Duration.ofMinutes(60));
        Instant to = anchor.plus(Duration.ofHours(12));
        return records.stream()
                .filter(c -> c.start() != null && !c.start().isBefore(from) && !c.start().isAfter(to))
                .filter(c -> !claimed.test(c.name()))
                .min(Comparator.comparing(Conference::start));
    }

    /** Why a lookup found nothing: how many records Google returned, and what happened to each. For plain-language explanations. */
    public record Diagnosis(int returned, int inWindow, int claimedByOtherMeetings, int outsideWindow, Instant earliestOutsideWindow, Instant latestOutsideWindow) {}

    public static Diagnosis diagnose(List<Conference> records, Instant anchor, boolean registeredAfterStart, Predicate<String> claimed) {
        Instant from = anchor.minus(registeredAfterStart ? Duration.ofHours(3) : Duration.ofMinutes(60));
        Instant to = anchor.plus(Duration.ofHours(12));
        int in = 0, taken = 0, out = 0;
        Instant earliest = null, latest = null;
        for (Conference c : records) {
            boolean inside = c.start() != null && !c.start().isBefore(from) && !c.start().isAfter(to);
            if (inside) {
                in++;
                if (claimed.test(c.name())) taken++;
            } else {
                out++;
                if (c.start() != null) {
                    if (earliest == null || c.start().isBefore(earliest)) earliest = c.start();
                    if (latest == null || c.start().isAfter(latest)) latest = c.start();
                }
            }
        }
        return new Diagnosis(records.size(), in, taken, out, earliest, latest);
    }

    public static Coverage coverage(Conference c, List<Span> transcripts) {
        if (c.start() == null || c.end() == null || !c.end().isAfter(c.start())) {
            return new Coverage(false, 1.0, null);
        }
        List<Span> clipped = new ArrayList<>();
        for (Span t : transcripts) {
            if (t.start() == null) continue;
            Instant s = t.start().isBefore(c.start()) ? c.start() : t.start();
            Instant e = (t.end() == null || t.end().isAfter(c.end())) ? c.end() : t.end();
            if (e.isAfter(s)) clipped.add(new Span(s, e));
        }
        if (clipped.isEmpty()) return new Coverage(true, 0.0, "No transcription was running during this meeting.");
        clipped.sort(Comparator.comparing(Span::start));
        long covered = 0;
        Instant curS = clipped.get(0).start(), curE = clipped.get(0).end();
        for (int i = 1; i < clipped.size(); i++) {
            Span n = clipped.get(i);
            if (n.start().isAfter(curE)) { covered += Duration.between(curS, curE).toMillis(); curS = n.start(); curE = n.end(); }
            else if (n.end().isAfter(curE)) curE = n.end();
        }
        covered += Duration.between(curS, curE).toMillis();
        double ratio = Math.min(1.0, (double) covered / Duration.between(c.start(), c.end()).toMillis());
        boolean partial = ratio < 0.9;
        if (!partial) return new Coverage(false, ratio, null);
        StringBuilder note = new StringBuilder("Transcription covered about ").append(Math.round(ratio * 100)).append("% of the meeting.");
        long lateMin = Duration.between(c.start(), clipped.get(0).start()).toMinutes();
        if (lateMin >= 2) note.append(" It started ").append(lateMin).append(" min after the meeting began.");
        return new Coverage(true, ratio, note.toString());
    }
}

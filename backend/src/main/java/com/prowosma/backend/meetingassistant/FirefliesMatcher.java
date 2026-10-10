package com.prowosma.backend.meetingassistant;

import java.time.Duration;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.function.Predicate;

/**
 * Decides which of a notetaker account's recent transcripts belongs to a meeting: the one whose meeting link has the same key, from around when the
 * meeting was registered, that isn't already imported for another meeting. Pure logic.
 */
public final class FirefliesMatcher {

    private FirefliesMatcher() {}

    public record Summary(String id, String title, String meetingLink, Instant date, boolean live) {}

    public enum Kind { MATCH, LIVE, NONE }

    /** {@code returned} etc. are counts for plain-language explanations when nothing matched. */
    public record Decision(Kind kind, String id, int returned, int linkMatches, int alreadyImported, int outsideWindow) {}

    static final Duration BEFORE = Duration.ofHours(3);
    static final Duration AFTER = Duration.ofHours(24);

    public static Decision pick(List<Summary> list, String key, Instant anchor, Predicate<String> claimed) {
        int returned = list == null ? 0 : list.size();
        int linkMatches = 0, taken = 0, outside = 0;
        Summary best = null;
        boolean anyLive = false;
        String liveId = null;
        if (list != null && key != null) {
            Instant from = anchor.minus(BEFORE), to = anchor.plus(AFTER);
            for (Summary s : list) {
                if (s == null || s.id() == null || !key.equals(ConferenceLink.keyOf(s.meetingLink()))) continue;
                linkMatches++;
                if (s.date() != null && (s.date().isBefore(from) || s.date().isAfter(to))) { outside++; continue; }
                if (claimed.test(s.id())) { taken++; continue; }
                if (s.live()) { anyLive = true; liveId = s.id(); continue; }
                if (best == null || (s.date() != null && (best.date() == null || s.date().isAfter(best.date())))) best = s;
            }
        }
        if (anyLive) return new Decision(Kind.LIVE, liveId, returned, linkMatches, taken, outside);
        if (best != null) return new Decision(Kind.MATCH, best.id(), returned, linkMatches, taken, outside);
        return new Decision(Kind.NONE, null, returned, linkMatches, taken, outside);
    }

    /** Newest first, for a "recent meetings" picker. */
    public static List<Summary> newestFirst(List<Summary> list) {
        return list.stream().sorted(Comparator.comparing((Summary s) -> s.date() == null ? Instant.EPOCH : s.date()).reversed()).toList();
    }
}

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

    /** Fallback window for a transcript whose meeting link Fireflies didn't report: it must have started shortly before the send until a few hours after. */
    static final Duration FALLBACK_BEFORE = Duration.ofMinutes(5);
    static final Duration FALLBACK_AFTER = Duration.ofHours(6);

    public static Decision pick(List<Summary> list, String key, Instant anchor, Predicate<String> claimed) {
        return pick(list, key, anchor, claimed, null);
    }

    /**
     * Same as above, with a safety net: Fireflies does not always report a meeting link for a meeting the notetaker was sent to through the API.
     * If nothing matched by link, a transcript with NO readable link is accepted when it started right around the send and either carries the
     * title we sent, or is the only such transcript. Transcripts that have a link are never matched this way — a different link is a different meeting — except when the link we sent is only a NAME for the meeting (Zoom personal link, Meet lookup/short link, Webex personal room) and theirs is the same platform's real id.
     */
    public static Decision pick(List<Summary> list, String key, Instant anchor, Predicate<String> claimed, String sentTitle) {
        Decision byLink = pickByLink(list, key, anchor, claimed);
        if (byLink.kind() != Kind.NONE || list == null) return byLink;
        Instant from = anchor.minus(FALLBACK_BEFORE), to = anchor.plus(FALLBACK_AFTER);
        String wanted = sentTitle == null ? "" : sentTitle.trim();
        final boolean aliasKey = ConferenceLink.isAliasKey(key);
        final String platform = ConferenceLink.platformOfKey(key);
        List<Summary> candidates = new java.util.ArrayList<>();
        for (Summary s : list) {
            if (s == null || s.id() == null || s.date() == null) continue;
            String theirs = ConferenceLink.keyOf(s.meetingLink());
            // A transcript with a link of its own is a different meeting — unless OUR link is only a name for a meeting (personal room, lookup or short link)
            // and theirs is the same platform's real id for it.
            if (theirs != null && !(aliasKey && theirs.length() > 0 && platform != null && platform.equals(ConferenceLink.platformOfKey(theirs)))) continue;
            if (s.date().isBefore(from) || s.date().isAfter(to)) continue;
            if (claimed.test(s.id())) continue;
            candidates.add(s);
        }
        Summary chosen = null;
        if (!wanted.isEmpty()) {
            for (Summary s : candidates) {
                if (s.title() != null && s.title().trim().equalsIgnoreCase(wanted) && (chosen == null || s.date().isAfter(chosen.date()))) chosen = s;
            }
        }
        if (chosen == null && candidates.size() == 1) chosen = candidates.get(0);
        if (chosen == null) return byLink;
        return new Decision(chosen.live() ? Kind.LIVE : Kind.MATCH, chosen.id(), byLink.returned(), byLink.linkMatches(), byLink.alreadyImported(), byLink.outsideWindow());
    }

    private static Decision pickByLink(List<Summary> list, String key, Instant anchor, Predicate<String> claimed) {
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

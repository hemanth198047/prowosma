package com.prowosma.backend.meetingassistant;

import com.prowosma.backend.meetingassistant.ConferenceLink.Link;
import com.prowosma.backend.meetingassistant.FirefliesMapper.Line;
import com.prowosma.backend.meetingassistant.FirefliesMapper.Sentence;
import com.prowosma.backend.meetingassistant.FirefliesMatcher.Decision;
import com.prowosma.backend.meetingassistant.FirefliesMatcher.Kind;
import com.prowosma.backend.meetingassistant.FirefliesMatcher.Summary;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@DisplayName("Fireflies — links, matching, transcript mapping, messages")
class FirefliesLogicTest {

    private static final Instant ANCHOR = Instant.parse("2026-10-08T12:00:00Z");

    // ── links ────────────────────────────────────────────────────────────────

    @Test @DisplayName("recognises Google Meet, Zoom, Teams and Webex links, and names the platform")
    void recognisesPlatforms() {
        assertThat(ConferenceLink.parse("https://meet.google.com/abc-defg-hij")).extracting(Link::platform, Link::key).containsExactly("GOOGLE_MEET", "meet:abc-defg-hij");
        assertThat(ConferenceLink.parse("https://us02web.zoom.us/j/84511223344?pwd=abc123")).extracting(Link::platform, Link::key).containsExactly("ZOOM", "zoom:84511223344");
        assertThat(ConferenceLink.parse("https://zoom.us/my/priya.s")).extracting(Link::key).isEqualTo("zoom:my:priya.s");
        assertThat(ConferenceLink.parse("https://teams.microsoft.com/meet/123456789012")).extracting(Link::platform, Link::key).containsExactly("MS_TEAMS", "teams:meet:123456789012");
        assertThat(ConferenceLink.parse("https://teams.microsoft.com/l/meetup-join/19%3ameeting_ABCdef123456%40thread.v2/0?context=%7b%7d").key()).startsWith("teams:join:19%3ameeting_abcdef123456");
        assertThat(ConferenceLink.parse("https://acme.webex.com/meet/priya").platform()).isEqualTo("WEBEX");
        assertThat(ConferenceLink.platformName("ZOOM")).isEqualTo("Zoom");
        assertThat(ConferenceLink.platformName("MS_TEAMS")).isEqualTo("Microsoft Teams");
    }

    @Test @DisplayName("the same meeting written differently has the same key — so a transcript can be matched however the link was typed")
    void sameMeetingSameKey() {
        assertThat(ConferenceLink.keyOf("https://meet.google.com/abc-defg-hij?authuser=1")).isEqualTo(ConferenceLink.keyOf("https://meet.google.com/abc-defg-hij/"));
        assertThat(ConferenceLink.keyOf("https://us06web.zoom.us/j/84511223344?pwd=aaa")).isEqualTo(ConferenceLink.keyOf("https://zoom.us/j/84511223344"));
        assertThat(ConferenceLink.keyOf("https://meet.google.com/abc-defg-hij")).isNotEqualTo(ConferenceLink.keyOf("https://meet.google.com/abc-defg-hik"));
    }

    @Test @DisplayName("the passcode stays in the link sent to Fireflies (Zoom needs it); a fragment does not")
    void urlKeepsWhatIsNeeded() {
        Link l = ConferenceLink.parse("https://us02web.zoom.us/j/84511223344?pwd=abc123#success");
        assertThat(l.url()).isEqualTo("https://us02web.zoom.us/j/84511223344?pwd=abc123");
    }

    @ParameterizedTest @ValueSource(strings = {"http://meet.google.com/abc-defg-hij", "https://meet.google.com.evil.com/abc-defg-hij", "https://evilmeet.google.com/abc-defg-hij",
            "https://zoom.us.evil.com/j/84511223344", "https://notzoom.us/j/84511223344", "https://user:pw@meet.google.com/abc-defg-hij", "https://example.com/abc-defg-hij",
            "https://meet.google.com/", "https://meet.google.com/not-a-code", "https://zoom.us/j/12", "https://teams.microsoft.com/", "ftp://meet.google.com/abc-defg-hij",
            "javascript:alert(1)", "https://meet.google.com/abc-defg-hij with space", "not a link", "", "   "})
    @DisplayName("anything else is refused — the link is handed to a third party, so look-alike domains, other schemes and credentials never pass")
    void refusals(String bad) {
        assertThatThrownBy(() -> ConferenceLink.parse(bad)).isInstanceOf(IllegalArgumentException.class);
        assertThat(ConferenceLink.keyOf(bad)).isNull();
    }

    @Test @DisplayName("refusals say what is supported, and null or oversized input is handled")
    void refusalMessages() {
        assertThatThrownBy(() -> ConferenceLink.parse("https://example.com/room")).hasMessageContaining("Google Meet, Zoom, Microsoft Teams and Webex");
        assertThatThrownBy(() -> ConferenceLink.parse(null)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> ConferenceLink.parse("https://meet.google.com/abc-defg-hij?x=" + "a".repeat(2100))).hasMessageContaining("too long");
        assertThat(ConferenceLink.platformName(null)).isEqualTo("Unknown platform");
    }

    // ── matching ─────────────────────────────────────────────────────────────

    private static Summary s(String id, String link, int minutesAfterAnchor, boolean live) {
        return new Summary(id, "t", link, ANCHOR.plus(minutesAfterAnchor, ChronoUnit.MINUTES), live);
    }

    @Test @DisplayName("picks the transcript with the same meeting link from around the meeting's time")
    void matches() {
        String key = ConferenceLink.keyOf("https://meet.google.com/abc-defg-hij");
        Decision d = FirefliesMatcher.pick(List.of(s("other", "https://meet.google.com/zzz-yyyy-xxx", 10, false), s("mine", "https://meet.google.com/abc-defg-hij?authuser=0", 20, false)), key, ANCHOR, id -> false);
        assertThat(d.kind()).isEqualTo(Kind.MATCH);
        assertThat(d.id()).isEqualTo("mine");
        assertThat(d.returned()).isEqualTo(2);
        assertThat(d.linkMatches()).isEqualTo(1);
    }

    @Test @DisplayName("a meeting the notetaker is still in is reported as live, not imported half-finished")
    void live() {
        String key = ConferenceLink.keyOf("https://zoom.us/j/84511223344");
        Decision d = FirefliesMatcher.pick(List.of(s("a", "https://zoom.us/j/84511223344", 5, true)), key, ANCHOR, id -> false);
        assertThat(d.kind()).isEqualTo(Kind.LIVE);
        assertThat(d.id()).isEqualTo("a");
    }

    @Test @DisplayName("when the notetaker joined twice, the latest finished transcript wins")
    void latestWins() {
        String key = ConferenceLink.keyOf("https://meet.google.com/abc-defg-hij");
        Decision d = FirefliesMatcher.pick(List.of(s("early", "https://meet.google.com/abc-defg-hij", 5, false), s("late", "https://meet.google.com/abc-defg-hij", 50, false)), key, ANCHOR, id -> false);
        assertThat(d.id()).isEqualTo("late");
    }

    @Test @DisplayName("nothing matches: wrong link, wrong time, or already imported for another meeting — each is counted for the explanation")
    void noMatch() {
        String key = ConferenceLink.keyOf("https://meet.google.com/abc-defg-hij");
        List<Summary> list = List.of(s("wrongLink", "https://meet.google.com/zzz-yyyy-xxx", 5, false), s("lastWeek", "https://meet.google.com/abc-defg-hij", -60 * 24 * 7, false),
                s("taken", "https://meet.google.com/abc-defg-hij", 10, false));
        Decision d = FirefliesMatcher.pick(list, key, ANCHOR, "taken"::equals);
        assertThat(d.kind()).isEqualTo(Kind.NONE);
        assertThat(d.id()).isNull();
        assertThat(d.linkMatches()).isEqualTo(2);
        assertThat(d.outsideWindow()).isEqualTo(1);
        assertThat(d.alreadyImported()).isEqualTo(1);
        assertThat(FirefliesMatcher.pick(null, key, ANCHOR, id -> false).kind()).isEqualTo(Kind.NONE);
        assertThat(FirefliesMatcher.pick(list, null, ANCHOR, id -> false).kind()).isEqualTo(Kind.NONE);
    }

    @Test @DisplayName("transcripts with unreadable links or no date never crash or match wrongly; newest-first ordering works")
    void messyInput() {
        String key = ConferenceLink.keyOf("https://meet.google.com/abc-defg-hij");
        List<Summary> list = List.of(new Summary("x", "t", null, null, false), new Summary("y", "t", "garbage", ANCHOR, false), new Summary(null, "t", "https://meet.google.com/abc-defg-hij", ANCHOR, false),
                new Summary("nodate", "t", "https://meet.google.com/abc-defg-hij", null, false));
        assertThat(FirefliesMatcher.pick(list, key, ANCHOR, id -> false).id()).isEqualTo("nodate");
        assertThat(FirefliesMatcher.newestFirst(List.of(s("old", "l", -5, false), s("new", "l", 5, false), new Summary("none", "t", "l", null, false))).get(0).id()).isEqualTo("new");
    }

    // ── mapping ──────────────────────────────────────────────────────────────

    @Test @DisplayName("sentences become lines with real speaker names and times in milliseconds")
    void mapsSentences() {
        List<Line> lines = FirefliesMapper.toLines(List.of(new Sentence("Priya Sharma", "Welcome everyone.", 1.5, 3.25), new Sentence("Arjun", "Thanks, let's begin.", 4.0, 6.0)), 30.0);
        assertThat(lines).extracting(Line::speaker).containsExactly("Priya Sharma", "Arjun");
        assertThat(lines.get(0).startMs()).isEqualTo(1500L);
        assertThat(lines.get(0).endMs()).isEqualTo(3250L);
        assertThat(lines.get(1).text()).isEqualTo("Thanks, let's begin.");
    }

    @Test @DisplayName("if the times turn out to be milliseconds, they are not multiplied again")
    void unitGuard() {
        List<Line> ms = FirefliesMapper.toLines(List.of(new Sentence("A", "one", 1500.0, 3250.0), new Sentence("A", "two", 1_790_000.0, 1_799_000.0)), 30.0);   // a 30-minute meeting
        assertThat(ms.get(0).startMs()).isEqualTo(1500L);
        assertThat(ms.get(1).endMs()).isEqualTo(1_799_000L);
        List<Line> sec = FirefliesMapper.toLines(List.of(new Sentence("A", "one", 1500.0, 1790.0)), 30.0);                                                  // seconds, near the end of a 30-minute meeting
        assertThat(sec.get(0).startMs()).isEqualTo(1_500_000L);
        assertThat(FirefliesMapper.toLines(List.of(new Sentence("A", "x", 5.0, 6.0)), null).get(0).startMs()).isEqualTo(5000L);        // no duration known → seconds, as documented
    }

    @Test @DisplayName("blank text, hidden characters, missing times and very long names are handled safely")
    void messySentences() {
        List<Line> lines = FirefliesMapper.toLines(java.util.Arrays.asList(null, new Sentence("A", "   ", 1.0, 2.0), new Sentence(" \u0007 ", "Hello\u0000   world", null, null),
                new Sentence("N".repeat(300), "x", -5.0, -1.0)), 10.0);
        assertThat(lines).hasSize(2);
        assertThat(lines.get(0).speaker()).isNull();
        assertThat(lines.get(0).text()).isEqualTo("Hello world");
        assertThat(lines.get(0).startMs()).isZero();
        assertThat(lines.get(1).speaker()).hasSize(100);
        assertThat(lines.get(1).startMs()).isZero();
        assertThat(FirefliesMapper.toLines(null, 5.0)).isEmpty();
    }

    // ── messages ─────────────────────────────────────────────────────────────

    @Test @DisplayName("the waiting message tells people the most likely cause — the notetaker wasn't admitted — and what was checked")
    void waitingMessages() {
        String none = FirefliesReport.waiting(new Decision(Kind.NONE, null, 25, 0, 0, 0)).message();
        assertThat(none).contains("admitted to the meeting by the host").contains("25 most recent Fireflies meetings").contains("none came from this meeting link");
        assertThat(FirefliesReport.waiting(new Decision(Kind.NONE, null, 25, 1, 1, 0)).message()).contains("already imported for another meeting");
        assertThat(FirefliesReport.waiting(new Decision(Kind.NONE, null, 25, 2, 0, 2)).message()).contains("none from around the time of this meeting");
        assertThat(FirefliesReport.waiting(new Decision(Kind.NONE, null, 1, 0, 0, 0)).message()).contains("1 most recent Fireflies meeting and");
        assertThat(FirefliesReport.waiting(new Decision(Kind.NONE, null, 3, 0, 0, 0)).facts()).containsEntry("recentMeetingsChecked", 3);
    }

    @Test @DisplayName("every status has a plain explanation and a stable code; reports carry only counts and states")
    void reports() {
        assertThat(FirefliesReport.live().code()).isEqualTo("FIREFLIES_LIVE");
        assertThat(FirefliesReport.processing().message()).contains("still processing");
        assertThat(FirefliesReport.imported(42).message()).contains("42 lines");
        assertThat(FirefliesReport.sent("ZOOM").message()).contains("Zoom meeting").contains("admit it");
        for (String kind : new String[]{"AUTH", "PLAN", "RATE_LIMITED", "NOT_FOUND", "TRANSIENT", "???", null}) {
            var r = FirefliesReport.problem(kind);
            assertThat(r.code()).startsWith("FIREFLIES_");
            assertThat(r.message()).isNotBlank();
            assertThat(Set.of("FIREFLIES_KEY_REJECTED", "FIREFLIES_PLAN", "FIREFLIES_RATE_LIMITED", "FIREFLIES_NOT_FOUND", "FIREFLIES_TEMPORARY")).contains(r.code());
        }
        assertThat(FirefliesReport.problem("AUTH").message()).contains("new one");
    }
}

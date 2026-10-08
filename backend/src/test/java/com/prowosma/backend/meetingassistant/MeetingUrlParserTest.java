package com.prowosma.backend.meetingassistant;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.assertThat;

@DisplayName("MeetingUrlParser")
class MeetingUrlParserTest {

    private static MeetingUrlParser.Result p(String s) { return MeetingUrlParser.parse(s); }

    @Test void googleMeetCodeIsAccepted_andQueryDropped() {
        var r = p("https://meet.google.com/abc-defg-hij?authuser=1");
        assertThat(r.valid()).isTrue();
        assertThat(r.platform()).isEqualTo(MeetingUrlParser.Platform.GOOGLE_MEET);
        assertThat(r.meetingKey()).isEqualTo("abc-defg-hij");
        assertThat(r.canonicalUrl()).isEqualTo("https://meet.google.com/abc-defg-hij");
    }

    @Test void recurringLinkHasTheSameKeyEveryTime() {
        assertThat(p("https://meet.google.com/abc-defg-hij").meetingKey())
                .isEqualTo(p("https://meet.google.com/abc-defg-hij?x=2").meetingKey());
    }

    @Test void teamsJoinLinkKeyIsTheDecodedThreadId_andContextDropped() {
        var r = p("https://teams.microsoft.com/l/meetup-join/19%3ameeting_ZDk0ABC-_x%40thread.v2/0?context=%7b%22Tid%22%3a%22x%22%7d");
        assertThat(r.valid()).isTrue();
        assertThat(r.meetingKey()).isEqualTo("19:meeting_ZDk0ABC-_x@thread.v2");
        assertThat(r.canonicalUrl()).doesNotContain("context");
    }

    @Test void teamsMeetLinkPasscodeIsNeverKept() {
        var r = p("https://teams.microsoft.com/meet/123456789012?p=SECRETPASS");
        assertThat(r.valid()).isTrue();
        assertThat(r.canonicalUrl()).doesNotContain("SECRET");
        assertThat(r.meetingKey()).isEqualTo("meet:123456789012");
    }

    @Test void personalTeamsAccountsAreAllowedWithAWarning() {
        var r = p("https://teams.live.com/meet/9876543210?p=abc");
        assertThat(r.valid()).isTrue();
        assertThat(r.warning()).isNotBlank();
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "https://meet.google.com.evil.example/abc-defg-hij",   // suffix look-alike
            "https://meet.google.com./abc-defg-hij",                // trailing dot
            "https://meet.google.com@evil.example/abc-defg-hij",    // userinfo trick
            "https://meet.google.com:8443/abc-defg-hij",            // odd port
            "javascript:alert(1)", "file:///etc/passwd", "ftp://meet.google.com/abc-defg-hij",
            "https://meet.google.com/abc-defg-hij https://x.example", // two links
            "https://teams.microsoft.com/l/meetup-join/notathread/0",
            "https://teams.microsoft.com/l/meetup-join/%ZZ/0",
            "https://meet.google.com/abcdefghij"
    })
    void hostileOrMalformedLinksAreRejected(String url) {
        assertThat(p(url).valid()).isFalse();
    }

    @Test void httpIsRejectedWithAClearCode() {
        assertThat(p("http://meet.google.com/abc-defg-hij").errorCode()).isEqualTo("INSECURE_URL");
    }

    @Test void shortLinksAreNotFollowed() {
        assertThat(p("https://g.co/meet/foo").errorCode()).isEqualTo("UNSUPPORTED_SHORT_LINK");
    }

    @Test void zoomAndOthersAreUnsupportedForNow() {
        assertThat(p("https://us02web.zoom.us/j/123456789").errorCode()).isEqualTo("UNSUPPORTED_PLATFORM");
        assertThat(p("https://example.com/room").errorCode()).isEqualTo("UNSUPPORTED_PLATFORM");
    }

    @Test void emptyAndOversizedInputs() {
        assertThat(p(null).errorCode()).isEqualTo("EMPTY_URL");
        assertThat(p("   ").errorCode()).isEqualTo("EMPTY_URL");
        assertThat(p("https://meet.google.com/" + "a".repeat(3000)).errorCode()).isEqualTo("URL_TOO_LONG");
    }

    // ── Teams: organizer and tenant carried by the invitation link ───────────

    private static final String OID = "8b081ef6-4792-4def-b2c9-c363a1bf41d5", TID = "11111111-2222-3333-4444-555555555555";
    private static final String CTX = "%7b%22Tid%22%3a%22" + TID + "%22%2c%22Oid%22%3a%22" + OID + "%22%7d";
    private static final String TEAMS_JOIN = "https://teams.microsoft.com/l/meetup-join/19%3ameeting_ZDk0ABC-_x%40thread.v2/0";

    @Test void teamsInvitationLinksYieldTheOrganizerAndTenant_andNothingElseFromTheQueryString() {
        var r = p(TEAMS_JOIN + "?context=" + CTX + "&anon=true");
        assertThat(r.organizerId()).isEqualTo(OID);
        assertThat(r.tenantId()).isEqualTo(TID);
        assertThat(r.canonicalUrl()).doesNotContain("context").doesNotContain("anon");
        assertThat(p(TEAMS_JOIN + "?context=" + CTX.replace(OID, OID.toUpperCase())).organizerId()).isEqualTo(OID);   // normalised
    }

    @Test void organizerAndTenantAreOnlyTrustedWhenTheyAreWellFormedGuids() {
        var bad = p(TEAMS_JOIN + "?context=%7b%22Oid%22%3a%22not-a-guid%22%2c%22Tid%22%3a%22%2e%2e%2f%2e%2e%22%7d");
        assertThat(bad.valid()).isTrue();
        assertThat(bad.organizerId()).isNull();
        assertThat(bad.tenantId()).isNull();
        var injected = p(TEAMS_JOIN + "?context=%7b%7d%26evil%3d1%22%3Cscript%3E");
        assertThat(injected.organizerId()).isNull();
        assertThat(p(TEAMS_JOIN).organizerId()).isNull();                                            // no context → valid, just no organizer
        assertThat(p("https://teams.microsoft.com/meet/123456789012?p=SECRET").organizerId()).isNull();
        assertThat(p("https://meet.google.com/abc-defg-hij").organizerId()).isNull();
    }
}

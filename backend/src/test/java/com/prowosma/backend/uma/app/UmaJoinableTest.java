package com.prowosma.backend.uma.app;

import com.prowosma.backend.uma.model.UmaMeeting;
import com.prowosma.backend.uma.model.UmaStatus;
import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

class UmaJoinableTest {
    final Instant start = Instant.parse("2026-11-26T10:00:00Z");

    UmaMeeting meeting() {
        UmaMeeting m = new UmaMeeting();
        m.setStatus(UmaStatus.CREATED); m.setMeetingUrl("https://meet.google.com/abc-defg-hij");
        m.setMeetingAt(start); m.setMeetingEndAt(start.plusSeconds(3600));
        return m;
    }

    @Test
    void thereIsNoTooEarlyRule_notEvenAnHourBefore() {
        assertThat(UmaService.joinable(meeting(), start.minusSeconds(3600))).isTrue();
        assertThat(UmaService.joinable(meeting(), start.minusSeconds(300))).isTrue();
    }

    @Test
    void stillJoinableDuringAndShortlyAfter_thenNot() {
        assertThat(UmaService.joinable(meeting(), start.plusSeconds(1800))).isTrue();
        assertThat(UmaService.joinable(meeting(), start.plusSeconds(3600 + 29 * 60))).isTrue();
        assertThat(UmaService.joinable(meeting(), start.plusSeconds(3600 + 31 * 60))).isFalse();
    }

    @Test
    void noLinkCancelledOrEndedMeansNoJoin() {
        UmaMeeting none = meeting(); none.setMeetingUrl(" ");
        UmaMeeting cancelled = meeting(); cancelled.setStatus(UmaStatus.CANCELLED);
        UmaMeeting ended = meeting(); ended.setLiveState("ENDED");
        assertThat(UmaService.joinable(none, start)).isFalse();
        assertThat(UmaService.joinable(cancelled, start)).isFalse();
        assertThat(UmaService.joinable(ended, start)).isFalse();
    }

    @Test
    void withoutAnEndItIsOpenForFourHoursAfterTheStart() {
        UmaMeeting m = meeting(); m.setMeetingEndAt(null);
        assertThat(UmaService.joinable(m, start.plusSeconds(4 * 3600))).isTrue();
        assertThat(UmaService.joinable(m, start.plusSeconds(5 * 3600))).isFalse();
    }
}

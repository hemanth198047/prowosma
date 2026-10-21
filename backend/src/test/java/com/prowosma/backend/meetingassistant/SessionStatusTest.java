package com.prowosma.backend.meetingassistant;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

@DisplayName("SessionStatus state machine")
class SessionStatusTest {

    @Test void normalTranscriptFlow() {
        assertThat(SessionStatus.SCHEDULED.canTransitionTo(SessionStatus.AWAITING_TRANSCRIPT)).isTrue();
        assertThat(SessionStatus.AWAITING_TRANSCRIPT.canTransitionTo(SessionStatus.PROCESSING)).isTrue();
        assertThat(SessionStatus.PROCESSING.canTransitionTo(SessionStatus.READY_FOR_REVIEW)).isTrue();
        assertThat(SessionStatus.READY_FOR_REVIEW.canTransitionTo(SessionStatus.COMPLETED)).isTrue();
    }

    @Test void terminalStatesDoNotReopen_exceptRetryOfFailed() {
        assertThat(SessionStatus.COMPLETED.isTerminal()).isTrue();
        assertThat(SessionStatus.CANCELLED.isTerminal()).isTrue();
        assertThat(SessionStatus.CANCELLED.canTransitionTo(SessionStatus.SCHEDULED)).isFalse();
        assertThat(SessionStatus.COMPLETED.canTransitionTo(SessionStatus.PROCESSING)).isFalse();
        assertThat(SessionStatus.FAILED.canTransitionTo(SessionStatus.SCHEDULED)).isTrue();
        // A failed meeting can be retried, rescued with a hand-supplied transcript, or regenerated (see SessionStatus):
        assertThat(SessionStatus.FAILED.canTransitionTo(SessionStatus.TRANSCRIPT_RECEIVED)).isTrue();
        assertThat(SessionStatus.FAILED.canTransitionTo(SessionStatus.PROCESSING)).isTrue();
        // ...but it never jumps straight to a finished state
        assertThat(SessionStatus.FAILED.canTransitionTo(SessionStatus.READY_FOR_REVIEW)).isFalse();
        assertThat(SessionStatus.FAILED.canTransitionTo(SessionStatus.COMPLETED)).isFalse();
    }

    @Test void statesCannotBeSkipped() {
        assertThat(SessionStatus.SCHEDULED.canTransitionTo(SessionStatus.READY_FOR_REVIEW)).isFalse();
        assertThat(SessionStatus.AWAITING_TRANSCRIPT.canTransitionTo(SessionStatus.COMPLETED)).isFalse();
    }

    @Test void everyActiveStateCanBeCancelledOrFailed_exceptReview() {
        for (SessionStatus s : SessionStatus.values()) {
            if (s.isTerminal() || s == SessionStatus.READY_FOR_REVIEW) continue;
            assertThat(s.canTransitionTo(SessionStatus.CANCELLED)).as(s + " -> CANCELLED").isTrue();
            assertThat(s.canTransitionTo(SessionStatus.FAILED)).as(s + " -> FAILED").isTrue();
        }
    }
}
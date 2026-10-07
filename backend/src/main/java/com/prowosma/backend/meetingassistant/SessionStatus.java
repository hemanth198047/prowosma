package com.prowosma.backend.meetingassistant;

import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

/**
 * Lifecycle of one meeting occurrence. The live-capture states (CONNECTING …
 * RECONNECTING) exist so the model is stable, but no adapter can enter them
 * until a provider that supports live join is wired in; with the current
 * official-API-only setup sessions use SCHEDULED → AWAITING_TRANSCRIPT → PROCESSING.
 */
public enum SessionStatus {
    SCHEDULED, AWAITING_TRANSCRIPT, CONNECTING, WAITING_FOR_ADMISSION, LISTENING, RECONNECTING,
    PROCESSING, READY_FOR_REVIEW, COMPLETED, FAILED, CANCELLED;

    private static final Map<SessionStatus, Set<SessionStatus>> NEXT = Map.of(
            SCHEDULED,             EnumSet.of(AWAITING_TRANSCRIPT, CONNECTING, FAILED, CANCELLED),
            AWAITING_TRANSCRIPT,   EnumSet.of(PROCESSING, FAILED, CANCELLED),
            CONNECTING,            EnumSet.of(WAITING_FOR_ADMISSION, LISTENING, FAILED, CANCELLED),
            WAITING_FOR_ADMISSION, EnumSet.of(LISTENING, FAILED, CANCELLED),
            LISTENING,             EnumSet.of(RECONNECTING, PROCESSING, FAILED, CANCELLED),
            RECONNECTING,          EnumSet.of(LISTENING, PROCESSING, FAILED, CANCELLED),
            PROCESSING,            EnumSet.of(READY_FOR_REVIEW, COMPLETED, FAILED, CANCELLED),
            READY_FOR_REVIEW,      EnumSet.of(COMPLETED, PROCESSING),
            FAILED,                EnumSet.of(SCHEDULED),   // retry
            COMPLETED,             EnumSet.noneOf(SessionStatus.class)
    );

    /** No further work will happen; the occurrence no longer blocks a new request. */
    public boolean isTerminal() {
        return this == COMPLETED || this == FAILED || this == CANCELLED;
    }

    public boolean canTransitionTo(SessionStatus next) {
        return NEXT.getOrDefault(this, EnumSet.noneOf(SessionStatus.class)).contains(next);
    }
}

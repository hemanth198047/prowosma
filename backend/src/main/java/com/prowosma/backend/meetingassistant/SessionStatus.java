package com.prowosma.backend.meetingassistant;

import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

import static java.util.Map.entry;

/**
 * Lifecycle of one meeting occurrence. The live-capture states (CONNECTING … RECONNECTING) exist so the
 * model is stable, but no adapter can enter them until a provider that supports live join is wired in.
 * With official-API-only access, sessions run SCHEDULED → AWAITING_TRANSCRIPT → TRANSCRIPT_RECEIVED → PROCESSING.
 */
public enum SessionStatus {
    SCHEDULED, AWAITING_TRANSCRIPT, TRANSCRIPT_RECEIVED, CONNECTING, WAITING_FOR_ADMISSION, LISTENING, RECONNECTING,
    PROCESSING, READY_FOR_REVIEW, COMPLETED, FAILED, CANCELLED;

    private static final Map<SessionStatus, Set<SessionStatus>> NEXT = Map.ofEntries(
            entry(SCHEDULED,             EnumSet.of(AWAITING_TRANSCRIPT, TRANSCRIPT_RECEIVED, CONNECTING, FAILED, CANCELLED)),
            entry(AWAITING_TRANSCRIPT,   EnumSet.of(TRANSCRIPT_RECEIVED, PROCESSING, FAILED, CANCELLED)),
            entry(TRANSCRIPT_RECEIVED,   EnumSet.of(AWAITING_TRANSCRIPT, PROCESSING, FAILED, CANCELLED)),
            entry(CONNECTING,            EnumSet.of(WAITING_FOR_ADMISSION, LISTENING, FAILED, CANCELLED)),
            entry(WAITING_FOR_ADMISSION, EnumSet.of(LISTENING, FAILED, CANCELLED)),
            entry(LISTENING,             EnumSet.of(RECONNECTING, PROCESSING, FAILED, CANCELLED)),
            entry(RECONNECTING,          EnumSet.of(LISTENING, PROCESSING, FAILED, CANCELLED)),
            entry(PROCESSING,            EnumSet.of(READY_FOR_REVIEW, COMPLETED, FAILED, CANCELLED)),
            entry(READY_FOR_REVIEW,      EnumSet.of(COMPLETED, PROCESSING, TRANSCRIPT_RECEIVED)),   // regenerate, or a new transcript arrived
            // A failed meeting can be retried, rescued by supplying a transcript by hand, or (if it has a transcript) regenerated.
            entry(FAILED,                EnumSet.of(SCHEDULED, TRANSCRIPT_RECEIVED, PROCESSING)),
            entry(COMPLETED,             EnumSet.noneOf(SessionStatus.class))
    );

    /** No further work will happen; the occurrence no longer blocks a new request. */
    public boolean isTerminal() {
        return this == COMPLETED || this == FAILED || this == CANCELLED;
    }

    public boolean canTransitionTo(SessionStatus next) {
        return NEXT.getOrDefault(this, EnumSet.noneOf(SessionStatus.class)).contains(next);
    }
}

package com.prowosma.backend.auth;

import java.time.Duration;
import java.time.Instant;

/**
 * Attempt limiting for second-factor codes. A six-digit code has only a million values, so
 * without a limit it can be guessed online; after {@link #MAX_FAILURES} wrong codes the account's
 * second-factor step is locked for {@link #LOCK_DURATION}.
 */
public final class LockoutPolicy {

    public static final int MAX_FAILURES = 5;
    public static final Duration LOCK_DURATION = Duration.ofMinutes(15);

    /** {@code lockedUntil} is null when not locked. */
    public record State(int failures, Instant lockedUntil) {
        public static final State CLEAN = new State(0, null);
    }

    private LockoutPolicy() {}

    public static boolean isLocked(State state, Instant now) {
        return state != null && state.lockedUntil() != null && now.isBefore(state.lockedUntil());
    }

    public static Duration remaining(State state, Instant now) {
        return isLocked(state, now) ? Duration.between(now, state.lockedUntil()) : Duration.ZERO;
    }

    /** Call while not locked. A lock that has run out starts counting again from zero. */
    public static State afterFailure(State state, Instant now) {
        int failures = (state == null ? 0 : state.failures()) + 1;
        if (failures >= MAX_FAILURES) return new State(0, now.plus(LOCK_DURATION));
        return new State(failures, null);
    }

    public static State afterSuccess() {
        return State.CLEAN;
    }
}

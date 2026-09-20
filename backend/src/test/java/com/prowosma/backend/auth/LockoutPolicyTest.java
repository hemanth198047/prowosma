package com.prowosma.backend.auth;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

@DisplayName("LockoutPolicy — limiting guesses at a six-digit code")
class LockoutPolicyTest {

    private static final Instant T0 = Instant.parse("2026-01-01T12:00:00Z");

    private static LockoutPolicy.State failTimes(int n, Instant at) {
        LockoutPolicy.State s = LockoutPolicy.State.CLEAN;
        for (int i = 0; i < n; i++) s = LockoutPolicy.afterFailure(s, at);
        return s;
    }

    @Test
    @DisplayName("four wrong codes are tolerated; the fifth locks the step for 15 minutes")
    void locksOnFifthFailure() {
        LockoutPolicy.State four = failTimes(LockoutPolicy.MAX_FAILURES - 1, T0);
        assertEquals(4, four.failures());
        assertFalse(LockoutPolicy.isLocked(four, T0));

        LockoutPolicy.State locked = LockoutPolicy.afterFailure(four, T0);
        assertTrue(LockoutPolicy.isLocked(locked, T0));
        assertEquals(T0.plus(Duration.ofMinutes(15)), locked.lockedUntil());
        assertEquals(0, locked.failures());
    }

    @Test
    @DisplayName("the lock lasts exactly its duration, and reports how long is left")
    void lockExpires() {
        LockoutPolicy.State locked = failTimes(LockoutPolicy.MAX_FAILURES, T0);
        assertTrue(LockoutPolicy.isLocked(locked, T0.plusSeconds(1)));
        assertTrue(LockoutPolicy.isLocked(locked, T0.plus(Duration.ofMinutes(15)).minusSeconds(1)));
        assertFalse(LockoutPolicy.isLocked(locked, T0.plus(Duration.ofMinutes(15))));
        assertEquals(Duration.ofMinutes(10), LockoutPolicy.remaining(locked, T0.plus(Duration.ofMinutes(5))));
        assertEquals(Duration.ZERO, LockoutPolicy.remaining(locked, T0.plus(Duration.ofMinutes(20))));
    }

    @Test
    @DisplayName("after a lock runs out the count starts again from zero, so it takes five more failures to lock again")
    void freshStartAfterLock() {
        LockoutPolicy.State locked = failTimes(LockoutPolicy.MAX_FAILURES, T0);
        Instant later = T0.plus(Duration.ofMinutes(16));
        LockoutPolicy.State s = locked;
        for (int i = 0; i < LockoutPolicy.MAX_FAILURES - 1; i++) {
            s = LockoutPolicy.afterFailure(s, later);
            assertFalse(LockoutPolicy.isLocked(s, later));
        }
        assertTrue(LockoutPolicy.isLocked(LockoutPolicy.afterFailure(s, later), later));
    }

    @Test
    @DisplayName("a correct code clears the count")
    void successResets() {
        LockoutPolicy.State s = failTimes(3, T0);
        assertEquals(LockoutPolicy.State.CLEAN, LockoutPolicy.afterSuccess());
        assertEquals(0, LockoutPolicy.afterSuccess().failures());
        assertNull(LockoutPolicy.afterSuccess().lockedUntil());
        assertEquals(3, s.failures());
    }

    @Test
    @DisplayName("a missing state (a user who has never failed) is simply not locked")
    void nullState() {
        assertFalse(LockoutPolicy.isLocked(null, T0));
        assertEquals(1, LockoutPolicy.afterFailure(null, T0).failures());
        assertEquals(Duration.ZERO, LockoutPolicy.remaining(null, T0));
    }
}

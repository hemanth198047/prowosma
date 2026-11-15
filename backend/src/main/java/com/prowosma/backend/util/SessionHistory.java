package com.prowosma.backend.util;

import com.prowosma.backend.model.User;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * Keeps a person's list of sign-in sessions tidy without ever dropping one that is still in use.
 *
 * Before: the list was cut to the last 10 on every sign-in. The 11th sign-in within a token's lifetime
 * (another browser, a phone, an automated demo tool signing in repeatedly) deleted a session that was still
 * being used; JwtFilter then rejected its next request with 401 and the person was thrown back to the login
 * page mid-task. Expired sessions were never removed, so they used up those 10 places too.
 */
public final class SessionHistory {
    /** Generous on purpose: this bound exists only to keep the stored list small, not to sign anyone out. */
    public static final int LIMIT = 50;

    private SessionHistory() {}

    /** Removes sessions created longer ago than a token lives: no token for them can still be valid. */
    public static void pruneExpired(List<User.LoginSession> sessions, LocalDateTime now, long tokenLifetimeMs) {
        if (sessions == null || tokenLifetimeMs <= 0) return;
        LocalDateTime oldestUsable = now.minusNanos(tokenLifetimeMs * 1_000_000L);
        sessions.removeIf(s -> s.getCreatedAt() != null && s.getCreatedAt().isBefore(oldestUsable));
    }

    /** The newest {@code limit} sessions (all of them if there are fewer), as a new mutable list. */
    public static List<User.LoginSession> keepNewest(List<User.LoginSession> sessions, int limit) {
        if (sessions == null) return new ArrayList<>();
        if (sessions.size() <= limit) return sessions;
        return new ArrayList<>(sessions.subList(sessions.size() - limit, sessions.size()));
    }
}

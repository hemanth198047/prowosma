package com.prowosma.backend.util;

import com.prowosma.backend.model.User;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class SessionHistoryTest {
    private static final long DAY_MS = 86_400_000L;
    private static final LocalDateTime NOW = LocalDateTime.of(2026, 11, 15, 12, 0);

    private static User.LoginSession sessionCreated(LocalDateTime at) {
        User.LoginSession s = new User.LoginSession();
        s.setCreatedAt(at);
        return s;
    }

    @Test
    void eleventhSignInNoLongerSignsOutALiveSession() {
        // 11 sign-ins within the last hour - all tokens still valid
        List<User.LoginSession> list = new ArrayList<>();
        for (int i = 0; i < 11; i++) list.add(sessionCreated(NOW.minusMinutes(60 - i)));
        User.LoginSession first = list.get(0);
        SessionHistory.pruneExpired(list, NOW, DAY_MS);
        List<User.LoginSession> kept = SessionHistory.keepNewest(list, SessionHistory.LIMIT);
        assertEquals(11, kept.size());
        assertTrue(kept.contains(first), "the oldest live session must survive");
    }

    @Test
    void expiredSessionsAreForgotten() {
        List<User.LoginSession> list = new ArrayList<>(List.of(
            sessionCreated(NOW.minusDays(3)),          // token long expired
            sessionCreated(NOW.minusHours(25)),        // just past a 24h token
            sessionCreated(NOW.minusHours(23)),        // still valid
            sessionCreated(NOW.minusMinutes(5))));     // still valid
        SessionHistory.pruneExpired(list, NOW, DAY_MS);
        assertEquals(2, list.size());
        assertTrue(list.stream().allMatch(s -> s.getCreatedAt().isAfter(NOW.minusDays(1))));
    }

    @Test
    void historyStaysBoundedKeepingTheNewest() {
        List<User.LoginSession> list = new ArrayList<>();
        for (int i = 0; i < SessionHistory.LIMIT + 5; i++) list.add(sessionCreated(NOW.minusSeconds(1000 - i)));
        User.LoginSession newest = list.get(list.size() - 1);
        List<User.LoginSession> kept = SessionHistory.keepNewest(list, SessionHistory.LIMIT);
        assertEquals(SessionHistory.LIMIT, kept.size());
        assertSame(newest, kept.get(kept.size() - 1));
        kept.add(sessionCreated(NOW));   // result is mutable (Mongo-loaded lists are too)
    }

    @Test
    void toleratesMissingDataAndDisabledLifetime() {
        SessionHistory.pruneExpired(null, NOW, DAY_MS);
        List<User.LoginSession> list = new ArrayList<>(List.of(sessionCreated(null), sessionCreated(NOW.minusDays(9))));
        SessionHistory.pruneExpired(list, NOW, 0);           // lifetime unknown: remove nothing
        assertEquals(2, list.size());
        SessionHistory.pruneExpired(list, NOW, DAY_MS);      // no creation time: keep it
        assertEquals(1, list.size());
        assertTrue(SessionHistory.keepNewest(null, 5).isEmpty());
    }
}

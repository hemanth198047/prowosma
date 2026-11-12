package com.prowosma.backend.controller;

import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class MeetingControllerParseUtcTest {

    @Test
    void utcSuffixKeepsWallClock() {
        assertEquals(LocalDateTime.of(2026, 11, 12, 4, 30),
            MeetingController.parseUtc("2026-11-12T04:30:00.000Z"));
    }

    @Test
    void offsetIsConvertedToUtc() {
        assertEquals(LocalDateTime.of(2026, 11, 12, 4, 30),
            MeetingController.parseUtc("2026-11-12T10:00:00+05:30"));
    }

    @Test
    void plainLocalDateTimeIsTakenAsUtc() {
        assertEquals(LocalDateTime.of(2026, 11, 12, 4, 30),
            MeetingController.parseUtc("2026-11-12T04:30"));
    }

    @Test
    void garbageIsNull() {
        assertNull(MeetingController.parseUtc("not a date"));
        assertNull(MeetingController.parseUtc(""));
        assertNull(MeetingController.parseUtc(null));
    }
}

package com.prowosma.backend.attendance;

import com.prowosma.backend.attendance.app.AttendanceRules;
import com.prowosma.backend.attendance.model.AttendanceLog;
import com.prowosma.backend.attendance.model.AttendanceSettings;
import com.prowosma.backend.attendance.model.AttendanceShift;
import com.prowosma.backend.model.Workspace;
import org.junit.jupiter.api.Test;

import java.time.*;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class AttendanceRulesTest {
    static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    static AttendanceShift shift(String start, String end, int grace, String... days) {
        AttendanceShift s = new AttendanceShift();
        s.setName("Day"); s.setStart(start); s.setEnd(end); s.setGraceMinutes(grace);
        if (days.length > 0) s.setDays(List.of(days));
        return s;
    }

    static Instant at(LocalDate d, String hhmm) { return d.atTime(LocalTime.parse(hhmm)).atZone(IST).toInstant(); }

    static AttendanceLog day(LocalDate d, AttendanceShift sh, Workspace ws) {
        AttendanceLog l = new AttendanceLog();
        AttendanceRules.plan(l, d, IST, sh, ws);
        return l;
    }

    static void session(AttendanceLog l, Instant in, Instant out) {
        AttendanceLog.Session s = new AttendanceLog.Session();
        s.setIn(in); s.setOut(out);
        l.getSessions().add(s);
    }

    final LocalDate wed = LocalDate.of(2026, 11, 18);   // a Wednesday
    final LocalDate sun = LocalDate.of(2026, 11, 22);

    @Test
    void withinGraceIsOnTime_afterGraceIsLateByMinutesFromShiftStart() {
        AttendanceShift sh = shift("10:00", "19:00", 15);
        AttendanceLog onTime = day(wed, sh, null);
        session(onTime, at(wed, "10:15"), at(wed, "19:00"));
        AttendanceRules.recompute(onTime, new AttendanceSettings(), Instant.now());
        assertThat(onTime.isLate()).isFalse();

        AttendanceLog late = day(wed, sh, null);
        session(late, at(wed, "10:16"), at(wed, "19:00"));
        AttendanceRules.recompute(late, new AttendanceSettings(), Instant.now());
        assertThat(late.isLate()).isTrue();
        assertThat(late.getLateMinutes()).isEqualTo(16);
        assertThat(late.getDayType()).isEqualTo("WORKDAY");
    }

    @Test
    void breaksAreNotWork_andOvertimeStartsAfterNineWorkedHours() {
        AttendanceLog l = day(wed, shift("10:00", "19:00", 15), null);
        session(l, at(wed, "09:00"), at(wed, "20:00"));             // 11 h on the clock
        AttendanceLog.Break lunch = new AttendanceLog.Break();
        lunch.setType("LUNCH"); lunch.setStart(at(wed, "13:00")); lunch.setEnd(at(wed, "14:00"));
        l.getBreaks().add(lunch);
        AttendanceRules.recompute(l, new AttendanceSettings(), Instant.now());
        assertThat(l.getBreakMinutes()).isEqualTo(60);
        assertThat(l.getWorkedMinutes()).isEqualTo(600);
        assertThat(l.getOvertimeMinutes()).isEqualTo(60);
    }

    @Test
    void sundayWorkIsAllOvertime_andEarnsCompOff_neverLate() {
        AttendanceLog l = day(sun, shift("10:00", "19:00", 15), null);      // default days MON-SAT
        session(l, at(sun, "12:00"), at(sun, "18:30"));
        AttendanceSettings s = new AttendanceSettings();
        AttendanceRules.recompute(l, s, Instant.now());
        assertThat(l.getDayType()).isEqualTo("WEEKEND");
        assertThat(l.isLate()).isFalse();
        assertThat(l.getOvertimeMinutes()).isEqualTo(390);
        assertThat(AttendanceRules.compOffFor(l, s)).isEqualTo(1.0);
        s.setCompOffEnabled(false);
        assertThat(AttendanceRules.compOffFor(l, s)).isZero();
    }

    @Test
    void holidaysMatchEveryYearOrOnce() {
        Workspace ws = new Workspace();
        Workspace.HolidayEntry diwali = new Workspace.HolidayEntry();
        diwali.setName("Diwali"); diwali.setDate("2026-11-08");
        Workspace.HolidayEntry xmas = new Workspace.HolidayEntry();
        xmas.setName("Christmas"); xmas.setDate("12-25");
        ws.setHolidays(List.of(diwali, xmas));
        assertThat(AttendanceRules.holiday(ws, LocalDate.of(2026, 11, 8))).isEqualTo("Diwali");
        assertThat(AttendanceRules.holiday(ws, LocalDate.of(2027, 11, 8))).isNull();
        assertThat(AttendanceRules.holiday(ws, LocalDate.of(2031, 12, 25))).isEqualTo("Christmas");
        assertThat(day(LocalDate.of(2026, 12, 25), shift("10:00", "19:00", 15), ws).getDayType()).isEqualTo("HOLIDAY");
    }

    @Test
    void nightShiftEndsTheNextMorning() {
        AttendanceLog l = day(wed, shift("22:00", "06:00", 10), null);
        assertThat(l.getExpectedStart()).isEqualTo(at(wed, "22:00"));
        assertThat(l.getExpectedEnd()).isEqualTo(at(wed.plusDays(1), "06:00"));
    }

    @Test
    void openSessionCountsUpToNow() {
        AttendanceLog l = day(wed, shift("10:00", "19:00", 15), null);
        session(l, at(wed, "10:00"), null);
        AttendanceRules.recompute(l, new AttendanceSettings(), at(wed, "12:30"));
        assertThat(l.getWorkedMinutes()).isEqualTo(150);
    }
}

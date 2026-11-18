package com.prowosma.backend.attendance.app;

import com.prowosma.backend.attendance.model.AttendanceException;
import com.prowosma.backend.attendance.model.AttendanceLog;
import com.prowosma.backend.attendance.model.AttendanceSettings;
import com.prowosma.backend.attendance.model.AttendanceShift;
import com.prowosma.backend.model.Workspace;

import java.time.*;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Locale;

/** The arithmetic of a day: worked time, breaks, lateness, overtime, holidays. No database, so it is easy to test. */
public final class AttendanceRules {
    private AttendanceRules() {}

    public static final List<String> WORK_MODES = List.of("IN_OFFICE", "REMOTE", "ON_LOCATION");
    public static final List<String> BREAK_TYPES = List.of("LUNCH", "TEA", "OTHER");
    public static final List<String> LEAVE_TYPES = List.of("CASUAL", "SICK", "EARNED", "COMP_OFF", "UNPAID");

    static long minutes(Instant a, Instant b) {
        if (a == null || b == null || !b.isAfter(a)) return 0;
        return Duration.between(a, b).toMinutes();
    }

    /** Recalculates the totals of a day as of {@code now} (open sessions and breaks count up to now). */
    public static void recompute(AttendanceLog log, AttendanceSettings s, Instant now) {
        long gross = 0;
        for (AttendanceLog.Session x : log.getSessions()) gross += minutes(x.getIn(), x.getOut() == null ? now : x.getOut());
        long breaks = 0;
        for (AttendanceLog.Break b : log.getBreaks()) breaks += minutes(b.getStart(), b.getEnd() == null ? now : b.getEnd());
        log.setBreakMinutes(breaks);
        long worked = Math.max(0, gross - breaks);
        log.setWorkedMinutes(worked);

        Instant first = log.firstIn();
        boolean expectedToday = log.getExpectedStart() != null && ("WORKDAY".equals(log.getDayType()) || log.getCallTimeId() != null);
        if (first != null && expectedToday && first.isAfter(log.getExpectedStart().plus(Duration.ofMinutes(log.getGraceMinutes())))) {
            log.setLate(true);
            log.setLateMinutes((int) minutes(log.getExpectedStart(), first));
        } else {
            log.setLate(false);
            log.setLateMinutes(0);
        }

        boolean offDay = "WEEKEND".equals(log.getDayType()) || "HOLIDAY".equals(log.getDayType());
        long overtime = offDay && s.isWeekendHolidayOvertime() ? worked : Math.max(0, worked - s.getOvertimeAfterMinutes());
        log.setOvertimeMinutes(overtime);
        if (overtime == 0 && "PENDING".equals(log.getOvertimeStatus())) log.setOvertimeStatus("NONE");
        log.setUpdatedAt(now);
    }

    /** Comp-off earned by approved off-day work: a full day for 6 hours or more, half a day for 3 hours or more. */
    public static double compOffFor(AttendanceLog log, AttendanceSettings s) {
        boolean offDay = "WEEKEND".equals(log.getDayType()) || "HOLIDAY".equals(log.getDayType());
        if (!offDay || !s.isCompOffEnabled()) return 0;
        if (log.getWorkedMinutes() >= 360) return 1;
        if (log.getWorkedMinutes() >= 180) return 0.5;
        return 0;
    }

    /** The holiday on this date, if any. Dates are MM-DD (every year) or YYYY-MM-DD (once). */
    public static String holiday(Workspace ws, LocalDate d) {
        if (ws == null || ws.getHolidays() == null) return null;
        String full = d.toString(), md = full.substring(5);
        for (Workspace.HolidayEntry h : ws.getHolidays()) {
            if (h.getDate() == null) continue;
            if (h.getDate().equals(full) || (h.getDate().length() == 5 && h.getDate().equals(md)))
                return h.getName() == null || h.getName().isBlank() ? "Holiday" : h.getName();
        }
        return null;
    }

    public static String day(LocalDate d) { return d.getDayOfWeek().name().substring(0, 3); }

    /** Fills in what was expected for this day: workday, weekend or holiday, and the shift's start and end. */
    public static void plan(AttendanceLog log, LocalDate d, ZoneId zone, AttendanceShift shift, Workspace ws) {
        String holiday = holiday(ws, d);
        log.setHolidayName(holiday);
        if (holiday != null) log.setDayType("HOLIDAY");
        else log.setDayType(shift.getDays().contains(day(d)) ? "WORKDAY" : "WEEKEND");
        log.setShiftName(shift.getName());
        log.setGraceMinutes(Math.max(0, shift.getGraceMinutes()));
        LocalTime start = time(shift.getStart()), end = time(shift.getEnd());
        Instant s = d.atTime(start).atZone(zone).toInstant();
        Instant e = (end.isAfter(start) ? d : d.plusDays(1)).atTime(end).atZone(zone).toInstant();
        log.setExpectedStart(s);
        log.setExpectedEnd(e);
    }

    public static LocalTime time(String hhmm) {
        try { return LocalTime.parse(hhmm == null ? "" : hhmm.trim()); }
        catch (DateTimeParseException e) { throw AttendanceException.bad("BAD_TIME", "Times must look like 09:30 (24-hour clock)."); }
    }

    public static LocalDate date(String yyyyMmDd) {
        try { return LocalDate.parse(yyyyMmDd == null ? "" : yyyyMmDd.trim()); }
        catch (DateTimeParseException e) { throw AttendanceException.bad("BAD_DATE", "Dates must look like 2026-11-18."); }
    }

    public static ZoneId zone(String tz) {
        try { return tz == null || tz.isBlank() ? ZoneOffset.UTC : ZoneId.of(tz.trim()); }
        catch (DateTimeException e) { return ZoneOffset.UTC; }
    }

    public static String upper(String s) { return s == null ? null : s.trim().toUpperCase(Locale.ROOT); }
}

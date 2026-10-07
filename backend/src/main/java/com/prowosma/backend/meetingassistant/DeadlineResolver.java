package com.prowosma.backend.meetingassistant;

import java.time.DateTimeException;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.temporal.TemporalAdjusters;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Turns a deadline AS SPOKEN into a calendar date relative to the meeting's date — or says honestly that it can't.
 * status: EXACT (full date stated) | RESOLVED (relative phrase with one sensible reading) | APPROXIMATE (a reading was chosen but
 * conventions differ, e.g. "end of week") | AMBIGUOUS (several readings; a person must choose) | UNRESOLVED (no date).
 * Only EXACT and RESOLVED are reliable enough for automatic use. Dates are calendar dates in the meeting's own timezone.
 */
public final class DeadlineResolver {

    private DeadlineResolver() {}

    public record Result(LocalDate date, String status, String note) {
        public boolean reliable() { return "EXACT".equals(status) || "RESOLVED".equals(status); }
    }

    private static final Map<String, Integer> MONTHS = new HashMap<>();
    private static final Map<String, DayOfWeek> DAYS = new HashMap<>();
    private static final Map<String, Integer> WORDS = Map.ofEntries(Map.entry("a", 1), Map.entry("an", 1), Map.entry("one", 1), Map.entry("two", 2),
            Map.entry("three", 3), Map.entry("four", 4), Map.entry("five", 5), Map.entry("six", 6), Map.entry("seven", 7), Map.entry("eight", 8),
            Map.entry("nine", 9), Map.entry("ten", 10), Map.entry("eleven", 11), Map.entry("twelve", 12));
    static {
        String[] full = {"january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"};
        for (int i = 0; i < 12; i++) { MONTHS.put(full[i], i + 1); MONTHS.put(full[i].substring(0, 3), i + 1); }
        MONTHS.put("sept", 9);
        String[] d = {"monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"};
        for (int i = 0; i < 7; i++) { DAYS.put(d[i], DayOfWeek.of(i + 1)); DAYS.put(d[i].substring(0, 3), DayOfWeek.of(i + 1)); }
        DAYS.put("tues", DayOfWeek.TUESDAY); DAYS.put("thur", DayOfWeek.THURSDAY); DAYS.put("thurs", DayOfWeek.THURSDAY);
    }

    private static final Pattern PREFIX = Pattern.compile("^(?:by|before|on|until|till|due|no later than|latest|on or before|around|approximately|approx|about)\\s+");
    private static final Pattern DAY_MONTH = Pattern.compile("^(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?([a-z]+)(?:,?\\s+(\\d{4}))?$");
    private static final Pattern MONTH_DAY = Pattern.compile("^([a-z]+)\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?$");
    private static final Pattern NUMERIC = Pattern.compile("^(\\d{1,2})[/.-](\\d{1,2})(?:[/.-](\\d{2,4}))?$");
    private static final Pattern IN_N = Pattern.compile("^in\\s+(\\d{1,3}|[a-z]+)\\s+(day|days|week|weeks|month|months)$");
    private static final Pattern WEEKDAY = Pattern.compile("^(next\\s+|this\\s+|coming\\s+|upcoming\\s+)?([a-z]+)(?:\\s+(?:morning|afternoon|evening|night))?$");

    public static Result resolve(String raw, LocalDate meeting) {
        if (raw == null || raw.isBlank()) return new Result(null, "UNRESOLVED", "No deadline was mentioned.");
        String t = raw.toLowerCase(Locale.ROOT).replaceAll("[\\p{Cntrl}]", " ").replaceAll("[,;.!]+$", "").replaceAll("\\s+", " ").trim();
        for (int i = 0; i < 2; i++) t = PREFIX.matcher(t).replaceFirst("").trim();
        if (t.isEmpty()) return new Result(null, "UNRESOLVED", "No deadline was mentioned.");

        if (t.matches("asap|as soon as possible|soon|later|eventually|sometime|some time|tbd|tba|whenever|when possible|when we can|at some point|in due course|no rush|no deadline|n/a|none"))
            return new Result(null, "UNRESOLVED", "No specific date was given (\"" + raw.trim() + "\").");
        if (t.matches("today|tonight|eod|end of day|end of the day|end of today|cob|close of business"))
            return new Result(meeting, "RESOLVED", "Taken as the day of the meeting.");
        if (t.matches("tomorrow|tmrw|tomorrow (morning|afternoon|evening)")) return new Result(meeting.plusDays(1), "RESOLVED", "Day after the meeting.");
        if (t.matches("(the )?day after tomorrow")) return new Result(meeting.plusDays(2), "RESOLVED", "Two days after the meeting.");

        if (t.matches("\\d{4}-\\d{2}-\\d{2}")) {
            try {
                return new Result(LocalDate.parse(t), "EXACT", null);
            } catch (DateTimeException e) {
                return new Result(null, "UNRESOLVED", "That isn't a real calendar date.");
            }
        }

        Matcher m = IN_N.matcher(t);
        if (m.matches()) {
            Integer n = m.group(1).matches("\\d+") ? Integer.valueOf(m.group(1)) : WORDS.get(m.group(1));
            if (n == null) return new Result(null, "UNRESOLVED", "Couldn't read the amount in \"" + raw.trim() + "\".");
            String u = m.group(2);
            LocalDate d = u.startsWith("day") ? meeting.plusDays(n) : u.startsWith("week") ? meeting.plusWeeks(n) : meeting.plusMonths(n);
            return new Result(d, "RESOLVED", "Counted from the meeting date.");
        }

        m = DAY_MONTH.matcher(t);
        if (m.matches() && MONTHS.containsKey(m.group(2))) return dated(Integer.parseInt(m.group(1)), MONTHS.get(m.group(2)), m.group(3), meeting);
        m = MONTH_DAY.matcher(t);
        if (m.matches() && MONTHS.containsKey(m.group(1))) return dated(Integer.parseInt(m.group(2)), MONTHS.get(m.group(1)), m.group(3), meeting);

        m = NUMERIC.matcher(t);
        if (m.matches()) return numeric(Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)), m.group(3), meeting, raw.trim());

        if (t.matches("(the )?(end of (the |this )?week|eow)|this week"))
            return new Result(meeting.with(TemporalAdjusters.nextOrSame(DayOfWeek.FRIDAY)), "APPROXIMATE", "\"End of the week\" was taken as Friday. Please confirm.");
        if (t.matches("(the )?end of next week"))
            return new Result(meeting.with(TemporalAdjusters.next(DayOfWeek.MONDAY)).with(TemporalAdjusters.nextOrSame(DayOfWeek.FRIDAY)), "APPROXIMATE", "\"End of next week\" was taken as that Friday. Please confirm.");
        if (t.matches("(the )?(end of (the |this )?month|eom)")) return new Result(meeting.with(TemporalAdjusters.lastDayOfMonth()), "RESOLVED", "Last day of the meeting's month.");
        if (t.matches("(the )?end of next month")) return new Result(meeting.plusMonths(1).with(TemporalAdjusters.lastDayOfMonth()), "RESOLVED", "Last day of the following month.");
        if (t.matches("next week|next month|this month|next quarter|this quarter|q[1-4]|end of (the )?(quarter|year)|next year"))
            return new Result(null, "AMBIGUOUS", "\"" + raw.trim() + "\" is a period, not a day. Please choose a date.");

        m = WEEKDAY.matcher(t);
        if (m.matches() && DAYS.containsKey(m.group(2))) {
            DayOfWeek dow = DAYS.get(m.group(2));
            String q = m.group(1) == null ? "" : m.group(1).trim();
            if (q.equals("next")) {
                LocalDate following = meeting.with(TemporalAdjusters.next(DayOfWeek.MONDAY)).with(TemporalAdjusters.nextOrSame(dow));
                return new Result(following, "AMBIGUOUS", "\"Next " + cap(dow) + "\" can mean the coming one or the one in the following week; the following week's was suggested.");
            }
            if (meeting.getDayOfWeek() == dow)
                return new Result(meeting.plusWeeks(1), "AMBIGUOUS", "The meeting was on a " + cap(dow) + " too: this could mean today or next week.");
            return new Result(meeting.with(TemporalAdjusters.next(dow)), "RESOLVED", "The next " + cap(dow) + " after the meeting.");
        }
        return new Result(null, "UNRESOLVED", "Couldn't read \"" + raw.trim() + "\" as a date.");
    }

    private static Result dated(int day, int month, String year, LocalDate meeting) {
        try {
            if (year != null) return new Result(LocalDate.of(Integer.parseInt(year), month, day), "EXACT", null);
            LocalDate d = LocalDate.of(meeting.getYear(), month, day);
            if (d.isBefore(meeting)) {
                if (meeting.toEpochDay() - d.toEpochDay() <= 31)
                    return new Result(d, "AMBIGUOUS", "That date has already passed (it is before the meeting). Please confirm the date.");
                return new Result(d.plusYears(1), "RESOLVED", "No year was given; the next occurrence was used.");
            }
            return new Result(d, "RESOLVED", "No year was given; this year was used.");
        } catch (DateTimeException e) {
            return new Result(null, "UNRESOLVED", "That isn't a real calendar date.");
        }
    }

    private static Result numeric(int a, int b, String year, LocalDate meeting, String raw) {
        int y = year == null ? meeting.getYear() : (year.length() == 2 ? 2000 + Integer.parseInt(year) : Integer.parseInt(year));
        try {
            boolean dayFirst;
            if (a > 12 && b <= 12) dayFirst = true;
            else if (b > 12 && a <= 12) dayFirst = false;
            else if (a == b) dayFirst = true;
            else return new Result(null, "AMBIGUOUS", "\"" + raw + "\" could be day/month or month/day. Please choose a date.");
            LocalDate d = dayFirst ? LocalDate.of(y, b, a) : LocalDate.of(y, a, b);
            if (year == null && d.isBefore(meeting)) return new Result(d, "AMBIGUOUS", "That date has already passed (it is before the meeting). Please confirm the date.");
            return new Result(d, year == null ? "RESOLVED" : "EXACT", year == null ? "No year was given; this year was used." : null);
        } catch (DateTimeException e) {
            return new Result(null, "UNRESOLVED", "That isn't a real calendar date.");
        }
    }

    private static String cap(DayOfWeek d) {
        String n = d.name().toLowerCase(Locale.ROOT);
        return Character.toUpperCase(n.charAt(0)) + n.substring(1);
    }
}

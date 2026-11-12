package com.prowosma.backend.service;

import com.prowosma.backend.model.Meeting;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class AvailabilityServiceTest {

    private static final LocalDateTime DAY = LocalDateTime.of(2026, 11, 12, 0, 0);

    private Meeting m(String id, int hour, int min, Integer mins, String organizer, String... attendees) {
        Meeting x = new Meeting();
        x.setId(id);
        x.setMeetingDate(DAY.withHour(hour).withMinute(min));
        x.setDurationMins(mins);
        x.setCreatedBy(organizer);
        x.setAttendees(List.of(attendees));
        x.setStatus("SCHEDULED");
        return x;
    }

    private Map<String, List<AvailabilityService.Busy>> run(List<Meeting> ms, String exclude, String... emails) {
        return AvailabilityService.busyByEmail(ms, List.of(emails), DAY, DAY.plusDays(1), exclude);
    }

    @Test
    void attendeesAndOrganizersAreBusy() {
        var r = run(List.of(m("a", 4, 30, 60, "owner@x.com", "Priya@X.com")), null, "priya@x.com", "owner@x.com", "sam@x.com");
        assertEquals(List.of(new AvailabilityService.Busy(DAY.withHour(4).withMinute(30), DAY.withHour(5).withMinute(30))), r.get("priya@x.com"));
        assertEquals(1, r.get("owner@x.com").size());
        assertNull(r.get("sam@x.com"));
    }

    @Test
    void overlappingAndTouchingMeetingsMerge() {
        var r = run(List.of(m("a", 9, 0, 60, null, "p@x.com"), m("b", 9, 30, 60, null, "p@x.com"), m("c", 10, 30, 30, null, "p@x.com"),
                m("d", 13, 0, null, null, "p@x.com")), null, "p@x.com");
        assertEquals(List.of(
                new AvailabilityService.Busy(DAY.withHour(9), DAY.withHour(11)),
                new AvailabilityService.Busy(DAY.withHour(13), DAY.withHour(13).withMinute(30))), r.get("p@x.com"));
    }

    @Test
    void cancelledAndExcludedMeetingsDontCount() {
        Meeting c = m("c", 9, 0, 60, null, "p@x.com");
        c.setStatus("CANCELLED");
        var r = run(List.of(c, m("edit", 11, 0, 60, null, "p@x.com")), "edit", "p@x.com");
        assertNull(r.get("p@x.com"));
    }

    @Test
    void meetingsAreClippedToTheRange() {
        Meeting late = new Meeting();
        late.setId("late");
        late.setMeetingDate(DAY.minusHours(1));
        late.setDurationMins(120);
        late.setAttendees(List.of("p@x.com"));
        var r = run(List.of(late, m("end", 23, 30, 120, null, "p@x.com")), null, "p@x.com");
        assertEquals(List.of(
                new AvailabilityService.Busy(DAY, DAY.withHour(1)),
                new AvailabilityService.Busy(DAY.withHour(23).withMinute(30), DAY.plusDays(1))), r.get("p@x.com"));
    }
}

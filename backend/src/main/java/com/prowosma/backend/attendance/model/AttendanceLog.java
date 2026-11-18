package com.prowosma.backend.attendance.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * One person's attendance for one work date (the date of their first clock-in, in the workspace's time zone).
 * A day can have several clock-in/clock-out sessions and several breaks. The totals are recalculated whenever it changes.
 */
@Data
@Document(collection = "attendance_logs")
@CompoundIndex(name = "org_email_date", def = "{'organizationId': 1, 'email': 1, 'date': 1}", unique = true)
@CompoundIndex(name = "org_date", def = "{'organizationId': 1, 'date': 1}")
public class AttendanceLog {
    @Id private String id;
    private String organizationId;
    private String email;
    private String name;
    /** yyyy-MM-dd in the workspace time zone. */
    private String date;

    /** WORKING | ON_BREAK | OFF */
    private String state = "OFF";
    /** IN_OFFICE | REMOTE | ON_LOCATION */
    private String workMode;
    private String projectId;
    private String projectName;
    private String sprintId;
    private String sprintName;
    private String note;

    /** What was expected that day: from the person's shift, or a project call time. */
    private String dayType;          // WORKDAY | WEEKEND | HOLIDAY
    private String holidayName;
    private String shiftName;
    private Instant expectedStart;
    private Instant expectedEnd;
    private int graceMinutes;
    private String callTimeId;       // set when a call time decided the expected start

    private List<Session> sessions = new ArrayList<>();
    private List<Break> breaks = new ArrayList<>();

    private boolean late;
    private int lateMinutes;
    private long workedMinutes;
    private long breakMinutes;
    private long overtimeMinutes;
    /** NONE | PENDING | APPROVED | REJECTED - overtime only counts for payroll/comp-off once approved. */
    private String overtimeStatus = "NONE";
    private String overtimeNote;
    private String overtimeReviewedBy;
    private Instant overtimeReviewedAt;
    /** Comp-off days earned by approved weekend/holiday work (0, 0.5 or 1). */
    private double compOffEarned;

    /** True when the system closed a session nobody clocked out of. */
    private boolean autoClosed;
    private Instant updatedAt = Instant.now();

    @Data
    public static class Session {
        private Instant in;
        private Instant out;
        private String inIp;
        private String outIp;
        private Geo inGeo;
        private Geo outGeo;
        /** WEB | REGULARIZED | AUTO_CLOSED */
        private String source = "WEB";
    }

    @Data
    public static class Break {
        /** LUNCH | TEA | IDLE | OTHER */
        private String type;
        private Instant start;
        private Instant end;
        /** True when idle detection paused the clock (not the person). */
        private boolean auto;
    }

    @Data
    public static class Geo {
        private double lat;
        private double lng;
        private Double accuracy;
    }

    public Session openSession() {
        return sessions.stream().filter(s -> s.getOut() == null).reduce((a, b) -> b).orElse(null);
    }

    public Break openBreak() {
        return breaks.stream().filter(b -> b.getEnd() == null).reduce((a, b) -> b).orElse(null);
    }

    public Instant firstIn() {
        return sessions.stream().map(Session::getIn).filter(java.util.Objects::nonNull).min(Instant::compareTo).orElse(null);
    }

    public Instant lastOut() {
        if (openSession() != null) return null;
        return sessions.stream().map(Session::getOut).filter(java.util.Objects::nonNull).max(Instant::compareTo).orElse(null);
    }
}

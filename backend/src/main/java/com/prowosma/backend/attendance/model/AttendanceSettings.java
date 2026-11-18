package com.prowosma.backend.attendance.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Workspace attendance rules. One per workspace; defaults apply until an admin saves. */
@Data
@Document(collection = "attendance_settings")
public class AttendanceSettings {
    @Id private String id;
    @Indexed(unique = true) private String organizationId;

    /** IANA zone for shifts and dates. Empty = the workspace's time zone. */
    private String timezone;
    /** Ask which work mode at clock-in. */
    private boolean askWorkMode = true;
    /** OFF | OPTIONAL | REQUIRED_ON_LOCATION - location is read only at the moment of a punch, never tracked. */
    private String locationMode = "OPTIONAL";
    /** Minutes without mouse or keyboard activity in Prowosma before idle detection reacts. 0 = off. */
    private int idleMinutes = 15;
    /** REMIND (ask "still working?") | PAUSE (start an automatic break from when activity stopped). */
    private String idleAction = "REMIND";
    /** Remind people still clocked in this many minutes after their shift ends. */
    private int endOfDayReminderMinutes = 15;
    /** Close a session nobody clocked out of after this many hours (it is flagged for a correction). */
    private int autoClockOutHours = 16;
    /** Overtime starts after this many worked minutes in a day (breaks excluded). */
    private int overtimeAfterMinutes = 540;
    /** All work on a weekend or holiday is overtime and can earn comp-off. */
    private boolean weekendHolidayOvertime = true;
    private boolean compOffEnabled = true;
    /** Days a year per leave type. */
    private Map<String, Double> leaveQuota = new LinkedHashMap<>(Map.of("CASUAL", 12.0, "SICK", 12.0, "EARNED", 15.0));
    /** People with HR rights (approve anything, see everyone, change rules, export) besides workspace admins. */
    private List<String> hrEmails = new ArrayList<>();
}

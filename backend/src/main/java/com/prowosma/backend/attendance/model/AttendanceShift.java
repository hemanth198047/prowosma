package com.prowosma.backend.attendance.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.util.ArrayList;
import java.util.List;

/** A fixed shift, e.g. 10:00-19:00 Monday to Saturday with 15 minutes' grace. People not named on any shift use the default one. */
@Data
@Document(collection = "attendance_shifts")
public class AttendanceShift {
    @Id private String id;
    @Indexed private String organizationId;
    private String name;
    /** HH:mm in the workspace time zone. */
    private String start = "10:00";
    private String end = "19:00";
    private List<String> days = new ArrayList<>(List.of("MON", "TUE", "WED", "THU", "FRI", "SAT"));
    private int graceMinutes = 15;
    private boolean defaultShift;
    /** People on this shift (emails, lower case). */
    private List<String> members = new ArrayList<>();
}

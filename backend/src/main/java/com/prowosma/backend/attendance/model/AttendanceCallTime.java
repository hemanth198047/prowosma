package com.prowosma.backend.attendance.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * An on-set / shoot call time for a project on a date. For the crew named here it replaces the shift start that day:
 * clocking in after call time + buffer is late.
 */
@Data
@Document(collection = "attendance_call_times")
@CompoundIndex(name = "org_date", def = "{'organizationId': 1, 'date': 1}")
public class AttendanceCallTime {
    @Id private String id;
    private String organizationId;
    private String projectId;
    private String projectName;
    /** yyyy-MM-dd */
    private String date;
    /** HH:mm in the workspace time zone. */
    private String callTime;
    private Instant callAt;
    private int bufferMinutes = 15;
    private String location;
    private String note;
    /** Crew emails (lower case). */
    private List<String> crew = new ArrayList<>();
    private String createdBy;
    private Instant createdAt = Instant.now();
}

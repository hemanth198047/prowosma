package com.prowosma.backend.model;

import lombok.Data;
import java.time.LocalDateTime;
import java.util.UUID;

@Data
public class TimeLog {
    private String id           = UUID.randomUUID().toString();
    private String description;
    private int    minutes;
    private boolean billable    = true;
    private double  hourlyRate  = 0.0;  // 0 = use project/workspace default
    private String  loggedBy;           // email of who logged the time
    private String  taskId;             // denormalised for reporting
    private String  projectId;          // denormalised for reporting
    private LocalDateTime loggedAt = LocalDateTime.now();
}

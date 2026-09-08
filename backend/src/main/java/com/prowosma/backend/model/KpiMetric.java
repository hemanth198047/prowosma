package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Data
@Document(collection = "kpi_metrics")
public class KpiMetric {
    @Id
    private String id;
    private String organizationId;
    private String name;          // e.g. "Monthly Revenue"
    private String description;
    private String unit;          // "$", "%", "users", etc.
    private String category;      // REVENUE | GROWTH | QUALITY | PRODUCTIVITY | CUSTOM
    private String linkedGoalId;  // optional — link to a Goal

    // Values
    private double currentValue  = 0;
    private double targetValue   = 100;
    private double baselineValue = 0;

    // Threshold alerts
    private double alertThreshold;           // alert when below this
    private String alertDirection = "BELOW"; // BELOW | ABOVE
    private boolean alertEnabled  = true;
    private boolean alertTriggered = false;

    // History snapshots
    private List<ValueSnapshot> history = new ArrayList<>();

    private String   owner;
    private String   status   = "ON_TRACK"; // ON_TRACK | AT_RISK | BEHIND | ACHIEVED
    private String   period   = "MONTHLY";  // DAILY | WEEKLY | MONTHLY | QUARTERLY
    private String   createdBy;
    private LocalDateTime createdAt = LocalDateTime.now();
    private LocalDateTime updatedAt = LocalDateTime.now();

    @Data
    public static class ValueSnapshot {
        private String id;
        private double value;
        private String note;
        private LocalDateTime recordedAt = LocalDateTime.now();
    }
}

package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Data
@Document(collection = "goals")
public class Goal {
    @Id
    private String id;
    private String organizationId;
    @jakarta.validation.constraints.NotBlank(message = "Goal title is required")
    private String title;
    private String description;
    private int progress = 0;
    private String createdBy;
    private String status = "ACTIVE"; // ACTIVE, ACHIEVED, PAUSED

    // B-1: Cascading goals
    private String parentGoalId;       // null = root goal
    private String level = "COMPANY";  // COMPANY | TEAM | INDIVIDUAL
    private String owner = "";         // person/team responsible

    // B-2: Confidence scoring
    private int confidence = 50;                          // 0-100 current confidence
    private List<ConfidenceEntry> confidenceHistory = new ArrayList<>(); // trend over time

    // B-3: Weekly check-ins
    private List<CheckIn> checkIns = new ArrayList<>();

    // B-4: Key Results (OKR-style)
    private List<KeyResult> keyResults = new ArrayList<>();

    private String quarter = "";  // e.g. "Q1 2026"
    private List<String> prerequisiteGoalIds = new ArrayList<>(); // goal dependency mapping
    private LocalDateTime targetDate;
    private LocalDateTime createdAt = LocalDateTime.now();
    private LocalDateTime updatedAt = LocalDateTime.now();
    private List<SubGoal> subGoals = new ArrayList<>();
    private java.util.Map<String, String> customFieldValues = new java.util.HashMap<>();

    // ── Inner classes ────────────────────────────────────────────

    @Data
    public static class ConfidenceEntry {
        private int value;           // 0-100
        private String note;
        private String recordedBy;
        private LocalDateTime recordedAt = LocalDateTime.now();
    }

    @Data
    public static class CheckIn {
        private String id;
        private String update;       // what happened this week
        private String blockers;     // any blockers
        private int progressSnapshot; // progress at time of check-in
        private int confidenceSnapshot;
        private String author;
        private LocalDateTime createdAt = LocalDateTime.now();
    }

    @Data
    public static class KeyResult {
        private String id;
        @jakarta.validation.constraints.NotBlank(message = "Goal title is required")
    private String title;
        private String metric;       // e.g. "Revenue", "NPS Score"
        private double startValue  = 0;
        private double targetValue = 100;
        private double currentValue = 0;
        private String unit = "";    // e.g. "%", "$", "users"
        private String status = "ON_TRACK"; // ON_TRACK | AT_RISK | BEHIND | ACHIEVED
        private LocalDateTime updatedAt = LocalDateTime.now();

        public int getProgress() {
            if (targetValue == startValue) return currentValue >= targetValue ? 100 : 0;
            double pct = (currentValue - startValue) / (targetValue - startValue) * 100;
            return (int) Math.min(100, Math.max(0, pct));
        }
    }
}

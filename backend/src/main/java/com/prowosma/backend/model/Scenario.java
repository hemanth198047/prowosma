package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Scenario Planning Model
 * Stores what-if simulation parameters and computed results.
 */
@Data
@Document(collection = "scenarios")
public class Scenario {
    @Id private String id;
    private String organizationId;
    private String name;
    private String description;
    private String type;           // TEAM_CHANGE | DEADLINE_SHIFT | PRIORITY_CHANGE | BUDGET_CUT | SCOPE_CHANGE | COMBINED
    private String status = "DRAFT"; // DRAFT | SIMULATED | ARCHIVED

    // ── What-if input parameters ──────────────────────────────
    private ScenarioInputs inputs = new ScenarioInputs();

    // ── Computed simulation results ───────────────────────────
    private ScenarioResults results;

    // ── AI narrative ──────────────────────────────────────────
    private String aiNarrative;

    private String createdBy;
    private LocalDateTime createdAt  = LocalDateTime.now();
    private LocalDateTime simulatedAt;

    // ── Nested input parameter object ─────────────────────────
    @Data
    public static class ScenarioInputs {
        // TEAM_CHANGE
        private int     teamSizeDelta      = 0;   // +2 = add 2, -1 = lose 1
        private List<String> removedMemberEmails  = new ArrayList<>();
        private List<String> addedMemberSkills    = new ArrayList<>();

        // DEADLINE_SHIFT
        private String  linkedProjectId;
        private int     deadlineShiftDays  = 0;   // positive = extend, negative = shorten
        private String  linkedSprintId;
        private int     sprintVelocityChange = 0; // % change e.g. -20 = 20% slower

        // PRIORITY_CHANGE
        private List<String> deprioritisedProjectIds = new ArrayList<>();
        private List<String> prioritisedProjectIds   = new ArrayList<>();

        // BUDGET_CUT
        private double  budgetCutPercent   = 0;   // 0-100

        // SCOPE_CHANGE
        private int     scopeAddedPoints   = 0;   // story points added
        private int     scopeRemovedPoints = 0;   // story points removed

        // Baseline reference date for simulation
        private LocalDateTime baselineDate = LocalDateTime.now();
    }

    // ── Nested results object ─────────────────────────────────
    @Data
    public static class ScenarioResults {
        // Delivery impact
        private int     deliveryRiskScore;        // 0-100 (100 = highest risk)
        private String  deliveryRiskLevel;        // LOW | MEDIUM | HIGH | CRITICAL
        private int     estimatedDelayDays;       // projected delay vs baseline
        private double  deliveryConfidence;       // % confidence of on-time delivery

        // Goal impact
        private double  goalConfidenceImpact;     // delta on avg goal confidence
        private int     goalsAtRisk;              // goals likely to miss target
        private List<Map<String, Object>> affectedGoals = new ArrayList<>();

        // Team impact
        private double  teamLoadChange;           // % change in average team load
        private boolean burnoutRisk;
        private List<Map<String, Object>> memberImpacts = new ArrayList<>();

        // Budget impact
        private double  budgetVariance;           // projected over/under budget
        private double  projectedBurnRate;        // monthly burn rate

        // Timeline projection
        private LocalDateTime projectedCompletionDate;
        private LocalDateTime baselineCompletionDate;

        // Sprint impact
        private int     sprintVelocityProjected;  // pts/sprint after change
        private int     sprintsToCompletion;      // sprints needed to finish backlog

        // Key signals
        private List<String> warnings  = new ArrayList<>();
        private List<String> recommendations = new ArrayList<>();
        private Map<String, Object> metrics = new LinkedHashMap<>();

        public void addMetric(String key, Object value) {
            if (this.metrics == null) this.metrics = new LinkedHashMap<>();
            this.metrics.put(key, value);
        }
    }
}

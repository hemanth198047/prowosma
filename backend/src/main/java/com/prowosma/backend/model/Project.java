package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.LocalDateTime;

@Data
@Document(collection = "projects")
public class Project {
    @Id
    private String id;
    private String organizationId;
    @jakarta.validation.constraints.NotBlank(message = "Project name is required")
    private String name;
    private String description;
    private String color;
    private String category = "General";
    private String categoryId;
    private String linkedGoalId;
    private String parentProjectId;
    private String status = "ACTIVE"; // ACTIVE, IN PROGRESS, PAUSED, DONE
    private LocalDateTime dueDate;
    // Budget tracking
    private Double budget;              // total project budget
    private Double spent;               // current spend
    private String currency = "USD";
    private java.util.List<BudgetEntry> expenses = new java.util.ArrayList<>();

    // ── ROI Engine fields ─────────────────────────────────────
    private Double expectedRevenue;       // projected revenue / benefit
    private Double actualRevenue;         // tracked actual revenue
    private Double laborCost;             // calculated from team hours
    private Double totalInvestment;       // budget + overhead
    private String roiCategory;           // COST_REDUCTION | REVENUE_GROWTH | EFFICIENCY | COMPLIANCE | STRATEGIC
    private java.util.List<RevenueEntry> revenueLog = new java.util.ArrayList<>();

    @lombok.Data
    public static class RevenueEntry {
        private String id = java.util.UUID.randomUUID().toString();
        private String description;
        private double amount;
        private String type;     // DIRECT | INDIRECT | COST_SAVING
        private java.time.LocalDateTime date = java.time.LocalDateTime.now();
    }

    // ── Project templates & cloning ───────────────────────────
    private boolean isTemplate    = false;   // this project is a template
    private String  templateId;              // spawned from this template id
    private String  templateCategory;        // ENGINEERING | PRODUCT | MARKETING | CUSTOM

    // ── Custom project type ────────────────────────────────────
    private String  projectType   = "DEFAULT"; // DEFAULT | SCRUM | KANBAN | WATERFALL | CUSTOM
    private String  customType;                // user-defined type name

    // ── Archived ──────────────────────────────────────────────
    private boolean archived      = false;
    private java.time.LocalDateTime archivedAt;
    private String  archivedBy;

    // ── Capacity planning ─────────────────────────────────────
    private Integer teamCapacityPoints;          // planned story points per sprint
    private Integer currentVelocity;             // actual pts delivered per sprint (computed)
    private Double  completionRiskScore;         // 0-100 risk score
    private String  riskAdjustedDeadline;        // ISO date accounting for velocity + risk
    private java.util.List<String> riskFactors = new java.util.ArrayList<>(); // identified risk factors

    @lombok.Data
    public static class BudgetEntry {
        private String id = java.util.UUID.randomUUID().toString();
        private String description;
        private double amount;
        private String category;        // PEOPLE | TOOLS | INFRASTRUCTURE | OTHER
        private java.time.LocalDateTime date = java.time.LocalDateTime.now();
        private String addedBy;
    }

    private String createdBy;   // email of user who created this project
    private LocalDateTime createdAt = LocalDateTime.now();
    private LocalDateTime updatedAt = LocalDateTime.now();
    private java.util.Map<String, String> customFieldValues = new java.util.HashMap<>();
    // Created from a meeting (Meeting Assistant)
    private String sourceMeetingId;
    private String sourceMeetingTitle;
    private String sourceProposalKey;   // stable id of the proposed project — makes creation duplicate-proof

    // ── Department / project access (see access/AccessScope) ──────────────────
    /** WORKSPACE | DEPARTMENTS | MEMBERS_ONLY. Null on projects created before access control: treated as WORKSPACE. */
    private String visibility;
    /** Ids of the DEPARTMENT groups that own this project. */
    private java.util.List<String> departmentIds = new java.util.ArrayList<>();
    /** Extra people (emails) who work on the project regardless of department. */
    private java.util.List<String> memberEmails = new java.util.ArrayList<>();
    /** Project role slots defined by the workspace (e.g. CREATIVE_LEAD): slot key -> person's email. */
    private java.util.Map<String, String> roleAssignments = new java.util.HashMap<>();
    /** People who approve work on this project (emails). */
    private java.util.List<String> approverEmails = new java.util.ArrayList<>();

    // ── Project team ───────────────────────────────────────────────────────────
    /**
     * Role and allocation of each person in memberEmails. memberEmails stays the single list of who is on
     * the project (it also drives access); this only adds detail, and is pruned to memberEmails on every change.
     */
    private java.util.List<TeamEntry> teamDetails = new java.util.ArrayList<>();

    @lombok.Data
    public static class TeamEntry {
        private String email;
        private String projectRole;          // free text, e.g. "Project manager", "Designer"
        private Integer allocationPercent;   // 0-100, share of the person's time on this project
        private java.time.LocalDateTime addedAt = java.time.LocalDateTime.now();
        private String addedBy;
    }
}
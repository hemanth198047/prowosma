package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import java.util.List;

@Data
@Document(collection = "custom_fields")
public class CustomField {
    @Id
    private String id;
    private String organizationId;
    private String name;
    private String type; // TEXT, NUMBER, DATE, DROPDOWN, CHECKBOX
    private String entityType; // TASK, PROJECT, GOAL
    private List<String> options; // for DROPDOWN type
    private boolean required = false;
    private String defaultValue;

    // ── Conditional logic ─────────────────────────────────────
    private java.util.List<FieldCondition> conditions = new java.util.ArrayList<>();
    private String conditionalAction = "SHOW"; // SHOW | HIDE | REQUIRE

    @lombok.Data
    public static class FieldCondition {
        private String id        = java.util.UUID.randomUUID().toString();
        private String fieldId;
        private String operator; // EQUALS | NOT_EQUALS | CONTAINS | IS_EMPTY
        private String value;
    }
}
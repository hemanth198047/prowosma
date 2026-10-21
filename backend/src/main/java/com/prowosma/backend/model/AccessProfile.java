package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * A named permission tier, defined per workspace (e.g. "Department Admin", "Assigned Work Only").
 * It decides what a member may SEE ({@link #scope}) and a few things they may DO ({@link #capabilities}).
 * Workspace role (ADMIN / MEMBER / VIEWER) is separate and keeps controlling workspace settings.
 */
@Data
@Document(collection = "access_profiles")
public class AccessProfile {
    @Id
    private String id;
    private String organizationId;
    private String name;
    private String description;
    /** ALL | MY_DEPARTMENTS | ASSIGNED_ONLY */
    private String scope = "MY_DEPARTMENTS";
    /** With scope MY_DEPARTMENTS: may manage (change visibility of, delete) projects owned by their departments. */
    private boolean departmentAdmin = false;
    /** See AccessConstants.ALL_CAPABILITIES. */
    private List<String> capabilities = new ArrayList<>();
    private String createdBy;
    private LocalDateTime createdAt = LocalDateTime.now();
    private LocalDateTime updatedAt = LocalDateTime.now();
}

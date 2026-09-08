package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import java.time.LocalDateTime;

@Data
@Document(collection = "team_members")
public class TeamMember {
    @Id
    private String id;
    private String organizationId;
    private String name;
    private String email;
    private String role = "MEMBER"; // ADMIN, MEMBER, VIEWER
    private String avatar;
    private String color;
    private LocalDateTime createdAt = LocalDateTime.now();

    // ── Expertise & Talent Intelligence ─────────────────────
    private java.util.List<String> skills = new java.util.ArrayList<>();       // e.g. ["React","Python","ML"]
    private java.util.List<String> domains = new java.util.ArrayList<>();      // e.g. ["Frontend","Data","DevOps"]
    private String bio;                                                         // short professional bio
    private String title;                                                       // job title / position
    private String department;                                                  // team/department
    private String location;                                                    // city or timezone region
    private java.util.List<String> mentorFor = new java.util.ArrayList<>();    // skills this person can mentor
    private java.util.List<String> lookingToLearn = new java.util.ArrayList<>();// skills they want to develop
    private String availability = "FULL";                                       // FULL | PARTIAL | UNAVAILABLE
    private int capacityPercent = 100;                                          // 0-100 current capacity
    private java.util.Map<String, Integer> inferredExpertise = new java.util.LinkedHashMap<>(); // skill -> score from activity
    private LocalDateTime profileUpdatedAt;
}
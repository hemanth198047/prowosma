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
    private String role = "MEMBER"; // ADMIN, MEMBER, VIEWER (what the person may DO to workspace settings; unrelated to what they may SEE)
    /** Which AccessProfile decides what this person may see. Null = the workspace default profile, or (if none) unrestricted. */
    private String accessProfileId;
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
    // ── Org chart / contact card ──────────────────────────────────────────
    private String managerId;                                                   // TeamMember id of this person's manager (null = top of the org)
    private String phone;                                                       // work phone, shown on the contact card
    private String timeZone;                                                    // IANA zone, e.g. "Asia/Kolkata" — shows the person's local time
    private java.util.List<String> mentorFor = new java.util.ArrayList<>();    // skills this person can mentor
    private java.util.List<String> lookingToLearn = new java.util.ArrayList<>();// skills they want to develop
    private String availability = "FULL";                                       // FULL | PARTIAL | UNAVAILABLE
    private int capacityPercent = 100;                                          // 0-100 current capacity
    private java.util.Map<String, Integer> inferredExpertise = new java.util.LinkedHashMap<>(); // skill -> score from activity
    private LocalDateTime profileUpdatedAt;
}
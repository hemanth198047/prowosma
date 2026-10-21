package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import java.time.LocalDateTime;

@Data
@Document(collection = "invitations")
public class Invitation {
    @Id private String id;
    private String workspaceId;
    private String email;
    private String role = "MEMBER";
    private String token;
    private String status = "PENDING"; // PENDING | ACCEPTED | EXPIRED | REVOKED

    /* ── Fields used by InvitationController ── */
    private String invitedBy;       // email of sender
    private String acceptedBy;
    private LocalDateTime expiresAt;
    private LocalDateTime acceptedAt;
    private LocalDateTime createdAt = LocalDateTime.now();

    /* ── Extended fields required by InvitationService ── */
    private String workspaceName;   // denormalised workspace name for email templates
    private String invitedByEmail;  // explicit email field used by service (vs invitedBy)

    /* ── Optional pre-assignment, applied when the invitation is accepted (department access model) ── */
    private String accessProfileId;                                  // AccessProfile to give the new member
    private String designation;                                      // job title to record
    private java.util.List<String> departmentIds = new java.util.ArrayList<>(); // DEPARTMENT groups to join
}

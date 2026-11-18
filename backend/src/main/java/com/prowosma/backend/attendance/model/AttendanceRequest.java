package com.prowosma.backend.attendance.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;

/**
 * Something a person asks a manager or HR to approve: a missed-punch correction (REGULARIZATION) or time off (LEAVE).
 */
@Data
@Document(collection = "attendance_requests")
@CompoundIndex(name = "org_status", def = "{'organizationId': 1, 'status': 1}")
@CompoundIndex(name = "org_email", def = "{'organizationId': 1, 'email': 1}")
public class AttendanceRequest {
    @Id private String id;
    private String organizationId;
    /** REGULARIZATION | LEAVE */
    private String kind;
    private String email;
    private String name;
    /** PENDING | APPROVED | REJECTED | CANCELLED */
    private String status = "PENDING";
    private String reason;

    // Regularization: the date and the times that should have been punched (HH:mm, workspace time zone).
    private String date;
    private String clockIn;
    private String clockOut;

    // Leave: dates inclusive (yyyy-MM-dd), type and whether it's half a day.
    private String fromDate;
    private String toDate;
    /** CASUAL | SICK | EARNED | COMP_OFF | UNPAID */
    private String leaveType;
    private boolean halfDay;
    private double days;

    /** Who is expected to approve: the person's manager when one is set (else any admin or HR). */
    private String approverEmail;
    private String reviewedBy;
    private Instant reviewedAt;
    private String reviewNote;
    private Instant createdAt = Instant.now();
}

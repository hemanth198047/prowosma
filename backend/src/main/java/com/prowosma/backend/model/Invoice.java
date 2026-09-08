package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.LocalDateTime;
import java.util.List;

@Data
@Document(collection = "invoices")
public class Invoice {
    @Id
    private String id;
    private String organizationId;
    private String invoiceNumber;       // e.g. INV-001
    private String projectId;
    private String projectName;
    private String clientName;
    private String clientEmail;
    private String status = "DRAFT";    // DRAFT, SENT, PAID, OVERDUE
    private List<InvoiceLineItem> lineItems;
    private double subtotal;
    private double taxRate   = 0.0;     // percentage e.g. 18 = 18%
    private double taxAmount;
    private double total;
    private String currency  = "USD";
    private String notes;
    private LocalDateTime issuedAt  = LocalDateTime.now();
    private LocalDateTime dueAt;
    private LocalDateTime paidAt;
    private String createdBy;

    @Data
    public static class InvoiceLineItem {
        private String description;
        private int    minutes;
        private double hours;
        private double hourlyRate;
        private double amount;
        private String taskTitle;
        private String loggedBy;
    }
}

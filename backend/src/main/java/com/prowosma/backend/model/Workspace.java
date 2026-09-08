package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

@Data
@Document(collection = "workspaces")
public class Workspace {
    @Id
    private String id;
    private String organizationId;
    private String name;
    private String logoUrl;
    private String ownerEmail;
    private String timezone = "UTC";
    // F02 new fields
    private String dateFormat = "DD/MM/YYYY";
    private Map<String, Boolean> notifPrefs;

    // ── Quiet hours / notification scheduling ──────────────────
    private String  quietHoursStart = "";   // e.g. "22:00" — empty = no quiet hours
    private String  quietHoursEnd   = "";   // e.g. "08:00"
    private String  quietHoursTimezone = "UTC";
    private java.util.List<String> quietDays = new java.util.ArrayList<>(); // e.g. ["SAT","SUN"]

    /**
     * Data residency — the region this workspace's data is committed to
     * live in. Set once at creation (see AdminController's honesty check
     * below); changing it afterward does NOT physically move any data,
     * since this deployment currently runs a single MongoDB connection for
     * every workspace regardless of this field's value.
     *
     * This is a genuine, honest limitation, not an oversight glossed over:
     * real per-workspace physical data residency requires either separate
     * full-stack deployments per region or a sharded/multi-cluster database
     * with region-aware routing — an infrastructure decision, not something
     * safely retrofitted through application code alone. What this field
     * DOES provide: a recorded, exportable statement of residency
     * commitment, and — see AdminController.getDataResidencyStatus() — an
     * explicit, visible flag when that commitment doesn't match where this
     * deployment instance is actually running, rather than silently
     * implying compliance that isn't real.
     */
    private String dataRegion = "UNSET"; // "US" | "EU" | "UK" | "APAC" | "UNSET"

    // ── White-label / Custom branding ─────────────────────────
    private String brandPrimaryColor;    // hex e.g. "#6366f1"
    private String brandLogoUrl;
    private String brandFaviconUrl;
    private String brandName;            // replaces "Prowosma" in UI
    private String customDomain;         // e.g. "projects.acme.com"
    private String supportEmail;
    private String brandFooterText;
    private boolean hidePoweredBy = false;
    private String cssOverrides;         // raw CSS injected in <head> // e.g. {taskOverdue: true, goalAchieved: true}
    private LocalDateTime createdAt = LocalDateTime.now();
    private LocalDateTime updatedAt = LocalDateTime.now();

    // ── Org hierarchy & multi-tenancy ──────────────────────────
    private String  parentOrganizationId;          // parent-child org support
    private String  tenantType = "SHARED";          // SHARED | DEDICATED | SINGLE_TENANT
    private String  templateId;                     // spawned from a workspace template
    private boolean isTemplate = false;             // this workspace IS a template
    private String  templateCategory;               // ENGINEERING | PRODUCT | MARKETING | CUSTOM

    // ── Language / Locale ──────────────────────────────────────
    private String  language   = "en";              // BCP47 e.g. "en", "fr", "de", "ja"
    private String  locale     = "en-GB";           // full locale
    private String  currency   = "USD";

    // ── Business calendar ──────────────────────────────────────
    private java.util.List<String> workingDays = java.util.List.of("MON","TUE","WED","THU","FRI");
    private java.util.List<HolidayEntry> holidays = new java.util.ArrayList<>();
    private String  fiscalYearStart = "01-01";      // MM-DD when fiscal year starts

    // ── Cross-workspace access ─────────────────────────────────
    private java.util.List<String> allowedCrossWorkspaceIds = new java.util.ArrayList<>();

    @lombok.Data
    public static class HolidayEntry {
        private String id   = java.util.UUID.randomUUID().toString();
        private String name;          // e.g. "Christmas Day"
        private String date;          // MM-DD (recurring) or YYYY-MM-DD (one-off)
        private boolean recurring = true;
        private String region;        // e.g. "GB", "US", "ALL"
    }

    // Extended white-label fields
    private String brandSidebarColor;
    private String brandTopbarColor;
    private boolean removeProwosmaBranding;
    private String brandEmailSender;
    private String brandEmailDomain;
    private String brandLoginBg;
    private String brandLoginTitle;
    private String brandLoginSubtitle;
    private String brandSupportEmail;
    private String brandHelpUrl;
    private String brandPrivacyUrl;
    private String brandTermsUrl;
    private String brandCustomCss;
    private String brandCustomJs;
    private String brandPdfLogoUrl;
    private String brandPdfColor;
    private String brandPdfFooter;
}
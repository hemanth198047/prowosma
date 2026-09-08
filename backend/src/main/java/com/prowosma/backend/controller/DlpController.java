package com.prowosma.backend.controller;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.DlpViolation;
import com.prowosma.backend.model.WorkspaceConfig;
import com.prowosma.backend.repository.DlpViolationRepository;
import com.prowosma.backend.repository.WorkspaceConfigRepository;
import com.prowosma.backend.service.AIService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import java.util.*;
import java.util.regex.*;

/**
 * DLP — Data Loss Prevention
 * Scans content for sensitive data patterns (PII, credentials, financial data).
 * Provides classification, redaction, and policy management.
 *
 * Policy configuration and the violation audit log are admin-only and live
 * in AdminController (/api/admin/dlp-policy, /api/admin/dlp-violations) —
 * this controller reads that same persisted policy (previously getPolicy()
 * below returned a hardcoded Map no matter what workspace asked, and
 * nothing was ever recorded when a scan found something).
 */
@RestController @RequestMapping("/api/dlp") @RequiredArgsConstructor
public class DlpController {

    private final AIService                 aiService;
    private final WorkspaceContext          ws;
    private final WorkspaceConfigRepository configRepository;
    private final DlpViolationRepository    violationRepository;

    // Regex patterns for common sensitive data
    private static final Map<String, Pattern> PATTERNS = new LinkedHashMap<>();
    static {
        PATTERNS.put("EMAIL",          Pattern.compile("[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}"));
        PATTERNS.put("PHONE",          Pattern.compile("\\b(?:\\+?1[-.\\s]?)?\\(?[2-9]\\d{2}\\)?[-.\\s]?\\d{3}[-.\\s]?\\d{4}\\b"));
        PATTERNS.put("CREDIT_CARD",    Pattern.compile("\\b(?:4[0-9]{12}(?:[0-9]{3})?|[25][1-7][0-9]{14}|6(?:011|5[0-9][0-9])[0-9]{12}|3[47][0-9]{13}|3(?:0[0-5]|[68][0-9])[0-9]{11})\\b"));
        PATTERNS.put("SSN",            Pattern.compile("\\b\\d{3}-\\d{2}-\\d{4}\\b"));
        PATTERNS.put("API_KEY",        Pattern.compile("(?i)(?:api[_-]?key|token|secret|password)\\s*[=:\"']\\s*[a-zA-Z0-9_\\-]{16,}"));
        PATTERNS.put("AWS_KEY",        Pattern.compile("\\bAKIA[0-9A-Z]{16}\\b"));
        PATTERNS.put("IBAN",           Pattern.compile("\\b[A-Z]{2}[0-9]{2}[A-Z0-9]{4}[0-9]{7}(?:[A-Z0-9]?){0,16}\\b"));
        PATTERNS.put("IP_ADDRESS",     Pattern.compile("\\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\b"));
    }

    @PostMapping("/scan")
    public Map<String, Object> scan(@RequestBody Map<String, Object> body, Authentication auth) {
        WorkspaceConfig policy = configRepository.findByWorkspaceId(ws.getWorkspaceId())
                .orElseGet(WorkspaceConfig::new);

        String content    = (String) body.getOrDefault("content", "");
        // Explicit request value wins if provided; otherwise fall back to
        // the workspace's configured default instead of always "false".
        boolean redact    = body.containsKey("redact")
                ? Boolean.TRUE.equals(body.get("redact"))
                : policy.isDlpAutoRedact();
        String entityType = (String) body.getOrDefault("entityType", "UNKNOWN");
        String entityId   = (String) body.getOrDefault("entityId", "");

        List<Map<String, Object>> findings = new ArrayList<>();
        String redacted = content;

        for (Map.Entry<String, Pattern> entry : PATTERNS.entrySet()) {
            Matcher m = entry.getValue().matcher(content);
            while (m.find()) {
                findings.add(Map.of(
                    "type",     entry.getKey(),
                    "value",    maskValue(m.group()),
                    "start",    m.start(),
                    "end",      m.end(),
                    "severity", getSeverity(entry.getKey())
                ));
                if (redact) {
                    redacted = redacted.replace(m.group(), "[" + entry.getKey() + "_REDACTED]");
                }
            }
        }

        String riskLevel = findings.isEmpty() ? "CLEAN"
            : findings.stream().anyMatch(f -> "HIGH".equals(f.get("severity"))) ? "HIGH"
            : findings.stream().anyMatch(f -> "MEDIUM".equals(f.get("severity"))) ? "MEDIUM" : "LOW";

        // Persist an audit record whenever something was actually found —
        // types/counts only, never the matched values themselves (see
        // DlpViolation's own doc comment for why). A clean scan isn't
        // logged; there's nothing worth auditing about content that had no
        // findings, and it would just be audit-log noise.
        if (!findings.isEmpty()) {
            DlpViolation v = new DlpViolation();
            v.setOrganizationId(ws.getWorkspaceId());
            v.setEntityType(entityType);
            v.setEntityId(entityId);
            v.setRiskLevel(riskLevel);
            v.setFindingsCount(findings.size());
            v.setFindingTypes(findings.stream().map(f -> (String) f.get("type")).distinct().toList());
            v.setRedacted(redact);
            v.setScannedBy(auth != null ? auth.getName() : "unknown");
            violationRepository.save(v);
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("riskLevel",    riskLevel);
        result.put("findingsCount", findings.size());
        result.put("findings",     findings);
        result.put("redactedContent", redact ? redacted : null);
        // Signals intent only — this endpoint scans content, it doesn't
        // know what the caller is about to do with it. The caller (e.g. a
        // "save" action in the frontend) is responsible for actually
        // stopping the save when blocked=true; enforcing that inside every
        // content-creation flow (Docs, Comments, Tasks, ...) is a larger,
        // separate change, not something a scan endpoint can do by itself.
        result.put("blocked",      policy.isDlpBlockHighRisk() && "HIGH".equals(riskLevel));
        result.put("entityType",   entityType);
        result.put("entityId",     entityId);
        result.put("scannedAt",    java.time.LocalDateTime.now().toString());
        return result;
    }

    @PostMapping("/classify")
    public Map<String, Object> classify(@RequestBody Map<String, Object> body) {
        String content = (String) body.getOrDefault("content", "");
        // Quick heuristic classification
        boolean hasFinancial = content.matches("(?i).*(?:revenue|profit|salary|invoice|payment|bank|account).*");
        boolean hasPii       = PATTERNS.get("EMAIL").matcher(content).find()
                            || PATTERNS.get("SSN").matcher(content).find()
                            || PATTERNS.get("PHONE").matcher(content).find();
        boolean hasCredentials = PATTERNS.get("API_KEY").matcher(content).find()
                               || PATTERNS.get("AWS_KEY").matcher(content).find();

        String classification = hasCredentials ? "CONFIDENTIAL"
            : hasPii ? "RESTRICTED"
            : hasFinancial ? "INTERNAL"
            : "PUBLIC";

        return Map.of(
            "classification", classification,
            "hasPii",         hasPii,
            "hasFinancial",   hasFinancial,
            "hasCredentials", hasCredentials,
            "labels",         getLabels(classification)
        );
    }

    @GetMapping("/policy")
    public Map<String, Object> getPolicy() {
        WorkspaceConfig cfg = configRepository.findByWorkspaceId(ws.getWorkspaceId())
                .orElseGet(WorkspaceConfig::new);
        return Map.of(
            "scanOnSave",         cfg.isDlpScanOnSave(),
            "blockHighRisk",      cfg.isDlpBlockHighRisk(),
            "autoRedact",         cfg.isDlpAutoRedact(),
            "notifyOnViolation",  cfg.isDlpNotifyOnViolation(),
            "classifyContent",    true,
            "retentionByClass",   Map.of("PUBLIC", 365, "INTERNAL", 1095, "RESTRICTED", 2557, "CONFIDENTIAL", 2557),
            "allowedCountries",   List.of("US","GB","EU","AU","IN"),
            "note", "Editable settings (scanOnSave/blockHighRisk/autoRedact/notifyOnViolation) are workspace-level and admin-configurable at /api/admin/dlp-policy. Retention/country fields below are still fixed defaults."
        );
    }

    private String maskValue(String val) {
        if (val.length() <= 4) return "****";
        return val.substring(0, 2) + "*".repeat(Math.max(0, val.length() - 4)) + val.substring(val.length() - 2);
    }

    private String getSeverity(String type) {
        return switch (type) {
            case "CREDIT_CARD", "SSN", "API_KEY", "AWS_KEY" -> "HIGH";
            case "PHONE", "IBAN", "EMAIL"                   -> "MEDIUM";
            default                                          -> "LOW";
        };
    }

    private List<String> getLabels(String classification) {
        return switch (classification) {
            case "CONFIDENTIAL" -> List.of("🔴 Confidential", "No external sharing", "Encryption required");
            case "RESTRICTED"   -> List.of("🟠 Restricted", "Internal only", "PII present");
            case "INTERNAL"     -> List.of("🟡 Internal", "Not for public sharing");
            default             -> List.of("🟢 Public", "No restrictions");
        };
    }
}

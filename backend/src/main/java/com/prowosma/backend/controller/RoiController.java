package com.prowosma.backend.controller;

import com.prowosma.backend.config.WorkspaceContext;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.*;

/**
 * ROI Engine — stores cost/benefit entries per project and computes ROI.
 * Uses a lightweight "roi_entries" collection (no separate model class needed;
 * stored as generic Documents for flexibility).
 */
@RestController
@RequestMapping("/api/roi")
@Tag(name = "ROI Engine", description = "Return on Investment tracking and forecasting")
@RequiredArgsConstructor
public class RoiController {

    private final MongoTemplate    mongoTemplate;
    private final WorkspaceContext workspaceContext;

    private static final String COL = "roi_entries";

    /* ── helpers ─────────────────────────────────────────────── */
    private String ws() { return workspaceContext.getWorkspaceId(); }

    private Query wsQuery() {
        return new Query(Criteria.where("workspaceId").is(ws()));
    }
    private Query wsProjectQuery(String projectId) {
        return new Query(Criteria.where("workspaceId").is(ws())
                                 .and("projectId").is(projectId));
    }

    /* ── CRUD for ROI entries ────────────────────────────────── */

    /** List all ROI entries for the workspace (optionally filtered by project) */
    @GetMapping
    public List<Map> getAll(@RequestParam(required = false) String projectId) {
        Query q = projectId != null ? wsProjectQuery(projectId) : wsQuery();
        return mongoTemplate.find(q, Map.class, COL);
    }

    /** Create a cost or benefit entry */
    @PostMapping
    public Map<String, Object> create(@RequestBody Map<String, Object> entry,
                                      Authentication auth) {
        entry.put("workspaceId", ws());
        entry.put("createdBy",   auth.getName());
        entry.put("createdAt",   LocalDateTime.now().toString());
        entry.put("updatedAt",   LocalDateTime.now().toString());
        // type: "COST" | "BENEFIT"
        if (!entry.containsKey("type")) entry.put("type", "COST");
        mongoTemplate.save(entry, COL);
        return entry;
    }

    /** Update an entry */
    @PutMapping("/{id}")
    public ResponseEntity<Map<String, Object>> update(
            @PathVariable String id,
            @RequestBody Map<String, Object> patch) {
        Query q = new Query(Criteria.where("_id").is(id).and("workspaceId").is(ws()));
        List<Map> existing = mongoTemplate.find(q, Map.class, COL);
        if (existing.isEmpty()) return ResponseEntity.notFound().build();
        Map<String, Object> entry = existing.get(0);
        patch.forEach((k, v) -> { if (!"_id".equals(k)) entry.put(k, v); });
        entry.put("updatedAt", LocalDateTime.now().toString());
        mongoTemplate.save(entry, COL);
        return ResponseEntity.ok(entry);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, String>> delete(@PathVariable String id) {
        Query q = new Query(Criteria.where("_id").is(id).and("workspaceId").is(ws()));
        mongoTemplate.remove(q, COL);
        return ResponseEntity.ok(Map.of("message", "Entry deleted"));
    }

    /* ── ROI calculation endpoints ───────────────────────────── */

    /**
     * Compute ROI for a project:
     * ROI% = (totalBenefits - totalCosts) / totalCosts * 100
     */
    @GetMapping("/calculate")
    public Map<String, Object> calculate(@RequestParam(required = false) String projectId) {
        Query q = projectId != null ? wsProjectQuery(projectId) : wsQuery();
        List<Map> entries = mongoTemplate.find(q, Map.class, COL);

        double totalCost    = entries.stream()
            .filter(e -> "COST".equals(e.get("type")))
            .mapToDouble(e -> toDouble(e.get("amount"))).sum();
        double totalBenefit = entries.stream()
            .filter(e -> "BENEFIT".equals(e.get("type")))
            .mapToDouble(e -> toDouble(e.get("amount"))).sum();

        double roi  = totalCost > 0 ? (totalBenefit - totalCost) / totalCost * 100 : 0;
        double npv  = totalBenefit - totalCost;  // simplified Net Present Value
        String status = roi >= 100 ? "EXCELLENT" : roi >= 50 ? "GOOD" : roi >= 0 ? "BREAKEVEN" : "NEGATIVE";

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("totalCost",    totalCost);
        result.put("totalBenefit", totalBenefit);
        result.put("roi",          Math.round(roi * 100.0) / 100.0);
        result.put("npv",          Math.round(npv * 100.0) / 100.0);
        result.put("status",       status);
        result.put("entryCount",   entries.size());
        result.put("projectId",    projectId);
        return result;
    }

    /**
     * Waterfall data — cumulative cost vs benefit over time for chart rendering.
     */
    @GetMapping("/waterfall")
    public List<Map<String, Object>> waterfall(
            @RequestParam(required = false) String projectId) {
        Query q = projectId != null ? wsProjectQuery(projectId) : wsQuery();
        List<Map> entries = mongoTemplate.find(q, Map.class, COL);

        // Sort by createdAt, accumulate
        entries.sort(Comparator.comparing(e -> String.valueOf(e.getOrDefault("createdAt", ""))));

        double cumCost = 0, cumBenefit = 0;
        List<Map<String, Object>> result = new ArrayList<>();
        for (Map e : entries) {
            double amt = toDouble(e.get("amount"));
            if ("COST".equals(e.get("type")))    cumCost    += amt;
            else                                  cumBenefit += amt;
            Map<String, Object> point = new LinkedHashMap<>();
            point.put("label",      e.getOrDefault("label", e.get("type")));
            point.put("date",       e.get("createdAt"));
            point.put("amount",     amt);
            point.put("type",       e.get("type"));
            point.put("cumCost",    Math.round(cumCost    * 100.0) / 100.0);
            point.put("cumBenefit", Math.round(cumBenefit * 100.0) / 100.0);
            point.put("roi",        cumCost > 0 ? Math.round((cumBenefit - cumCost) / cumCost * 10000.0) / 100.0 : 0);
            result.add(point);
        }
        return result;
    }

    /**
     * Scenario comparison — compare best/base/worst case scenarios.
     */
    @PostMapping("/compare-scenarios")
    public Map<String, Object> compareScenarios(
            @RequestBody Map<String, Object> scenarios) {
        // scenarios: { best: {cost, benefit}, base: {cost, benefit}, worst: {cost, benefit} }
        Map<String, Object> result = new LinkedHashMap<>();
        for (String key : new String[]{"best", "base", "worst"}) {
            if (scenarios.containsKey(key)) {
                @SuppressWarnings("unchecked")
                Map<String, Object> s = (Map<String, Object>) scenarios.get(key);
                double cost    = toDouble(s.get("cost"));
                double benefit = toDouble(s.get("benefit"));
                double roi     = cost > 0 ? (benefit - cost) / cost * 100 : 0;
                Map<String, Object> r = new LinkedHashMap<>(s);
                r.put("roi",    Math.round(roi * 100.0) / 100.0);
                r.put("npv",    Math.round((benefit - cost) * 100.0) / 100.0);
                r.put("status", roi >= 100 ? "EXCELLENT" : roi >= 50 ? "GOOD" : roi >= 0 ? "BREAKEVEN" : "NEGATIVE");
                result.put(key, r);
            }
        }
        return result;
    }

    /** Forecast — project ROI trend based on entered data */
    @GetMapping("/forecast")
    public Map<String, Object> forecast(@RequestParam(required = false) String projectId,
                                        @RequestParam(defaultValue = "6") int months) {
        Map<String, Object> current = calculate(projectId);
        double currentRoi = toDouble(current.get("roi"));
        double currentNpv = toDouble(current.get("npv"));

        // Simple linear extrapolation
        List<Map<String, Object>> projected = new ArrayList<>();
        for (int m = 1; m <= months; m++) {
            Map<String, Object> point = new LinkedHashMap<>();
            point.put("month", m);
            point.put("roi",   Math.round((currentRoi * (1 + m * 0.05)) * 100.0) / 100.0);
            point.put("npv",   Math.round((currentNpv * (1 + m * 0.08)) * 100.0) / 100.0);
            projected.add(point);
        }
        return Map.of("current", current, "projected", projected);
    }

    private double toDouble(Object val) {
        if (val == null) return 0;
        if (val instanceof Number) return ((Number) val).doubleValue();
        try { return Double.parseDouble(val.toString()); }
        catch (NumberFormatException e) { return 0; }
    }
}

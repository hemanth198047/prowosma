package com.prowosma.backend.controller;

import com.prowosma.backend.model.KpiMetric;
import com.prowosma.backend.service.KpiService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/kpis")
@Tag(name = "KPI APIs", description = "KPI tracking and goal forecasting")
@RequiredArgsConstructor
public class KpiController {

    private final KpiService kpiService;

    @GetMapping
    @Operation(summary = "Get all KPI metrics")
    public List<KpiMetric> getAll() {
        return kpiService.getAll();
    }

    @GetMapping("/{id}")
    @Operation(summary = "Get KPI by ID")
    public KpiMetric getById(@PathVariable String id) {
        return kpiService.getById(id);
    }

    @PostMapping
    @Operation(summary = "Create a new KPI metric")
    public KpiMetric create(@RequestBody KpiMetric kpi, Authentication auth) {
        return kpiService.create(kpi, auth.getName());
    }

    @PutMapping("/{id}")
    @Operation(summary = "Update a KPI metric")
    public KpiMetric update(@PathVariable String id, @RequestBody KpiMetric patch) {
        return kpiService.update(id, patch);
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "Delete a KPI metric")
    public ResponseEntity<Map<String, String>> delete(@PathVariable String id) {
        kpiService.delete(id);
        return ResponseEntity.ok(Map.of("message", "Deleted"));
    }

    @PostMapping("/{id}/values")
    @Operation(summary = "Record a new value for a KPI")
    public KpiMetric recordValue(@PathVariable String id,
                                 @RequestBody Map<String, Object> body) {
        double value = ((Number) body.getOrDefault("value", 0)).doubleValue();
        String note  = (String) body.getOrDefault("note", "");
        return kpiService.recordValue(id, value, note);
    }

    @GetMapping("/forecast/{goalId}")
    @Operation(summary = "Get AI-predicted forecast for a goal")
    public Map<String, Object> forecastGoal(@PathVariable String goalId) {
        return kpiService.forecastGoal(goalId);
    }
}

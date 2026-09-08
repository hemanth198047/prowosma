package com.prowosma.backend.controller;

import com.prowosma.backend.config.WorkspaceContext;
import lombok.RequiredArgsConstructor;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.*;

/**
 * Deployment Analytics — tracks deployments from CI/CD webhooks
 * and provides frequency, DORA metrics, and failure rate analytics.
 */
@RestController
@RequestMapping("/api/deployments")
@RequiredArgsConstructor
public class DeploymentController {

    private final WorkspaceContext ws;

    // In-memory store (upgrade to MongoDB collection in production)
    private static final List<Map<String, Object>> DEPLOYMENTS = new ArrayList<>();

    @PostMapping("/webhook")
    public ResponseEntity<Map<String, Object>> receiveWebhook(@RequestBody Map<String, Object> payload) {
        Map<String, Object> dep = new LinkedHashMap<>();
        dep.put("id",          UUID.randomUUID().toString());
        dep.put("orgId",       ws.getWorkspaceId());
        dep.put("environment", payload.getOrDefault("environment", "production"));
        dep.put("status",      payload.getOrDefault("status", "SUCCESS"));      // SUCCESS | FAILED | ROLLBACK
        dep.put("service",     payload.getOrDefault("service", "app"));
        dep.put("version",     payload.getOrDefault("version", ""));
        dep.put("commitSha",   payload.getOrDefault("commitSha", ""));
        dep.put("pipeline",    payload.getOrDefault("pipeline", ""));            // github-actions | gitlab-ci | jenkins
        dep.put("durationSec", payload.getOrDefault("durationSec", 0));
        dep.put("deployedBy",  payload.getOrDefault("deployedBy", "ci-bot"));
        dep.put("timestamp",   LocalDateTime.now().toString());
        DEPLOYMENTS.add(dep);
        return ResponseEntity.ok(Map.of("received", true, "id", dep.get("id")));
    }

    @GetMapping
    public List<Map<String, Object>> getAll(
            @RequestParam(defaultValue = "30") int days,
            @RequestParam(required = false) String environment,
            @RequestParam(required = false) String service) {
        String orgId = ws.getWorkspaceId();
        LocalDateTime cutoff = LocalDateTime.now().minusDays(days);
        return DEPLOYMENTS.stream()
            .filter(d -> orgId.equals(d.get("orgId")))
            .filter(d -> LocalDateTime.parse((String)d.get("timestamp")).isAfter(cutoff))
            .filter(d -> environment == null || environment.equals(d.get("environment")))
            .filter(d -> service == null || service.equals(d.get("service")))
            .sorted(Comparator.comparing((Map<String, Object> d) -> (String) d.get("timestamp")).reversed())
            .toList();
    }

    @GetMapping("/metrics")
    public Map<String, Object> getMetrics(@RequestParam(defaultValue = "30") int days) {
        String orgId = ws.getWorkspaceId();
        LocalDateTime cutoff = LocalDateTime.now().minusDays(days);

        List<Map<String, Object>> recent = DEPLOYMENTS.stream()
            .filter(d -> orgId.equals(d.get("orgId")))
            .filter(d -> LocalDateTime.parse((String)d.get("timestamp")).isAfter(cutoff))
            .toList();

        long total    = recent.size();
        long success  = recent.stream().filter(d -> "SUCCESS".equals(d.get("status"))).count();
        long failed   = recent.stream().filter(d -> "FAILED".equals(d.get("status"))).count();
        long rollback = recent.stream().filter(d -> "ROLLBACK".equals(d.get("status"))).count();

        // DORA: Deployment Frequency (deploys per day)
        double deployFreq = days > 0 ? Math.round((double) total / days * 10.0) / 10.0 : 0;

        // DORA: Change Failure Rate
        double failureRate = total > 0 ? Math.round(((double)(failed + rollback) / total) * 1000.0) / 10.0 : 0;

        // Average duration
        double avgDurationSec = recent.stream()
            .mapToInt(d -> ((Number) d.getOrDefault("durationSec", 0)).intValue()).average().orElse(0);

        // DORA performance tier
        String tier = deployFreq >= 1 ? "ELITE"
            : deployFreq >= 1.0/7 ? "HIGH"
            : deployFreq >= 1.0/30 ? "MEDIUM" : "LOW";

        // By environment breakdown
        Map<String, Long> byEnv = new LinkedHashMap<>();
        recent.forEach(d -> byEnv.merge((String)d.getOrDefault("environment","unknown"), 1L, Long::sum));

        // By service breakdown
        Map<String, Long> byService = new LinkedHashMap<>();
        recent.forEach(d -> byService.merge((String)d.getOrDefault("service","app"), 1L, Long::sum));

        // Daily trend (last 7 days)
        List<Map<String, Object>> dailyTrend = new ArrayList<>();
        for (int i = Math.min(days, 7) - 1; i >= 0; i--) {
            LocalDateTime dayStart = LocalDateTime.now().minusDays(i).toLocalDate().atStartOfDay();
            LocalDateTime dayEnd   = dayStart.plusDays(1);
            long count = recent.stream()
                .filter(d -> { LocalDateTime ts = LocalDateTime.parse((String)d.get("timestamp"));
                    return ts.isAfter(dayStart) && ts.isBefore(dayEnd); })
                .count();
            Map<String, Object> day = new LinkedHashMap<>();
            day.put("date",  dayStart.toLocalDate().toString());
            day.put("count", count);
            dailyTrend.add(day);
        }

        Map<String, Object> metrics = new LinkedHashMap<>();
        metrics.put("totalDeployments",  total);
        metrics.put("successCount",      success);
        metrics.put("failedCount",       failed);
        metrics.put("rollbackCount",     rollback);
        metrics.put("deployFrequency",   deployFreq);
        metrics.put("changeFailureRate", failureRate);
        metrics.put("avgDurationSec",    Math.round(avgDurationSec));
        metrics.put("doraPerformance",   tier);
        metrics.put("byEnvironment",     byEnv);
        metrics.put("byService",         byService);
        metrics.put("dailyTrend",        dailyTrend);
        metrics.put("periodDays",        days);
        return metrics;
    }
}

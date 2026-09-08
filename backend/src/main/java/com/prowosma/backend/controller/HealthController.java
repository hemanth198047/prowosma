package com.prowosma.backend.controller;

import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.lang.management.ManagementFactory;
import java.lang.management.MemoryMXBean;
import java.lang.management.RuntimeMXBean;
import java.time.LocalDateTime;
import java.util.*;

@RestController
@RequestMapping("/api/health")
@Tag(name = "Health & Observability", description = "System health, metrics, and readiness checks")
@RequiredArgsConstructor
public class HealthController {

    private final MongoTemplate mongoTemplate;
    private static final long START_TIME = System.currentTimeMillis();

    /** Basic liveness probe — always returns 200 if the app is running */
    @GetMapping("/live")
    public Map<String, String> live() {
        return Map.of("status", "UP", "timestamp", LocalDateTime.now().toString());
    }

    /** Readiness probe — checks MongoDB connectivity */
    @GetMapping("/ready")
    public ResponseEntity<Map<String, Object>> ready() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("timestamp", LocalDateTime.now().toString());
        boolean dbOk = false;
        try {
            mongoTemplate.getDb().runCommand(new org.bson.Document("ping", 1));
            dbOk = true;
        } catch (Exception e) {
            result.put("db_error", e.getMessage());
        }
        result.put("db",     dbOk ? "UP" : "DOWN");
        result.put("status", dbOk ? "UP"  : "DEGRADED");

        return dbOk
            ? ResponseEntity.ok(result)
            : ResponseEntity.status(503).body(result);
    }

    /** Full metrics — for internal dashboards and acquirer due diligence */
    @GetMapping("/metrics")
    public Map<String, Object> metrics() {
        MemoryMXBean mem  = ManagementFactory.getMemoryMXBean();
        RuntimeMXBean rt  = ManagementFactory.getRuntimeMXBean();

        long heapUsed  = mem.getHeapMemoryUsage().getUsed()  / 1024 / 1024;
        long heapMax   = mem.getHeapMemoryUsage().getMax()   / 1024 / 1024;
        long uptimeSec = (System.currentTimeMillis() - START_TIME) / 1000;

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("timestamp",     LocalDateTime.now().toString());
        result.put("uptimeSeconds", uptimeSec);
        result.put("uptimeHuman",   formatUptime(uptimeSec));

        Map<String, Object> memory = new LinkedHashMap<>();
        memory.put("heapUsedMB",   heapUsed);
        memory.put("heapMaxMB",    heapMax);
        memory.put("heapUsagePct", heapMax > 0 ? Math.round(heapUsed * 100.0 / heapMax) + "%" : "N/A");
        result.put("memory", memory);

        Map<String, Object> runtime = new LinkedHashMap<>();
        runtime.put("javaVersion", System.getProperty("java.version"));
        runtime.put("processors",  Runtime.getRuntime().availableProcessors());
        runtime.put("pid",         ProcessHandle.current().pid());
        result.put("runtime", runtime);

        result.put("status", "UP");
        return result;
    }

    @Value("${app.deployment.region:US}")
    private String deploymentRegion;

    /** Version info — shown in admin panel and due diligence docs */
    @GetMapping("/info")
    public Map<String, Object> info() {
        return Map.of(
            "app",       "Prowosma",
            "version",   "1.0.0",
            "build",     LocalDateTime.now().toLocalDate().toString(),
            "stack",     Map.of("backend","Spring Boot 3 / Java 21","db","MongoDB Atlas","ai","Claude Anthropic"),
            "deploymentRegion", deploymentRegion,
            "status",    "production-ready"
        );
    }

    private String formatUptime(long seconds) {
        long days  = seconds / 86400;
        long hours = (seconds % 86400) / 3600;
        long mins  = (seconds % 3600) / 60;
        if (days > 0)  return days  + "d " + hours + "h";
        if (hours > 0) return hours + "h " + mins  + "m";
        return mins + "m";
    }
}

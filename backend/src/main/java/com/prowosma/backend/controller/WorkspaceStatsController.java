package com.prowosma.backend.controller;

import com.prowosma.backend.model.Task;
import com.prowosma.backend.repository.*;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/workspaces")
@RequiredArgsConstructor
public class WorkspaceStatsController {

    private final ProjectRepository      projectRepository;
    private final TaskRepository         taskRepository;
    private final GoalRepository         goalRepository;
    private final TeamMemberRepository   teamMemberRepository;
    private final ActivityLogRepository  activityLogRepository;

    /**
     * GET /api/workspaces/{id}/stats
     * Returns usage stats for the workspace.
     */
    @GetMapping("/{id}/stats")
    public ResponseEntity<Map<String, Object>> getStats(
            @PathVariable String id) {

        // ── Counts ──────────────────────────────────────────
        long projects = projectRepository.countByOrganizationId(id);
        long tasks    = taskRepository.countByOrganizationId(id);
        long goals    = goalRepository.countByOrganizationId(id);
        long members  = teamMemberRepository.countByOrganizationId(id);

        // ── Task breakdown ───────────────────────────────────
        var allTasks = taskRepository.findByOrganizationId(id,
            org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();
        long tasksDone       = allTasks.stream()
                .filter(t -> "DONE".equals(t.getStatus())).count();
        long tasksInProgress = allTasks.stream()
                .filter(t -> "IN_PROGRESS".equals(t.getStatus())).count();
        long tasksTodo       = allTasks.stream()
                .filter(t -> "TODO".equals(t.getStatus())).count();

        // ── File storage ──────────────────────────────────────
        long totalBytes = allTasks.stream()
                .flatMap(t -> t.getAttachments() != null
                        ? t.getAttachments().stream() : java.util.stream.Stream.empty())
                .mapToLong(a -> a.getFileSize())
                .sum();
        double storageMB = Math.round(totalBytes / 1024.0 / 1024.0 * 100.0) / 100.0;

        // ── Activity trend — last 30 days ────────────────────
        var logs = activityLogRepository.findByOrganizationIdOrderByCreatedAtDesc(id,
            org.springframework.data.domain.PageRequest.of(0, 5000));
        LocalDateTime thirtyDaysAgo = LocalDateTime.now().minusDays(30);
        DateTimeFormatter fmt = DateTimeFormatter.ofPattern("MMM dd");

        Map<String, Long> dailyActivity = logs.stream()
                .filter(l -> l.getCreatedAt() != null
                        && l.getCreatedAt().isAfter(thirtyDaysAgo))
                .collect(Collectors.groupingBy(
                        l -> l.getCreatedAt().format(fmt),
                        Collectors.counting()
                ));

        // Build ordered list for last 30 days
        List<Map<String, Object>> trend = new ArrayList<>();
        for (int i = 29; i >= 0; i--) {
            String day = LocalDateTime.now().minusDays(i).format(fmt);
            trend.add(Map.of(
                    "date",     day,
                    "activity", dailyActivity.getOrDefault(day, 0L)
            ));
        }

        // ── Assemble response ─────────────────────────────────
        Map<String, Object> stats = new LinkedHashMap<>();
        stats.put("projects",        projects);
        stats.put("tasks",           tasks);
        stats.put("tasksDone",       tasksDone);
        stats.put("tasksInProgress", tasksInProgress);
        stats.put("tasksTodo",       tasksTodo);
        stats.put("goals",           goals);
        stats.put("members",         members);
        stats.put("storageMB",       storageMB);
        stats.put("activityTrend",   trend);

        return ResponseEntity.ok(stats);
    }
}

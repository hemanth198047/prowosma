package com.prowosma.backend.controller;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.repository.*;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;
import java.util.concurrent.CompletableFuture;

/**
 * Optimised dashboard endpoint — parallel queries, minimal payload.
 * Replaces the old single /dashboard/summary mega-call.
 */
@RestController
@RequestMapping("/api/dashboard")
@Tag(name = "Dashboard", description = "Optimised dashboard data with phased loading")
@RequiredArgsConstructor
public class DashboardController {

    private final TaskRepository    taskRepository;
    private final ProjectRepository projectRepository;
    private final GoalRepository    goalRepository;
    private final SprintRepository  sprintRepository;
    private final MeetingRepository meetingRepository;
    private final com.prowosma.backend.service.MeetingContinuityService meetingContinuityService;
    private final com.prowosma.backend.service.MeetingActionItemService meetingActionItemService;
    private final WorkspaceContext  workspaceContext;

    /**
     * Phase 1 — critical KPIs only.
     * Target: <200ms. Returns hero numbers only (no lists, no charts).
     */
    @GetMapping("/summary")
    public ResponseEntity<Map<String, Object>> summary() {
        String orgId = workspaceContext.getWorkspaceId();

        // Run all 3 counts in parallel using CompletableFuture
        CompletableFuture<List<?>> tasksFuture    = CompletableFuture.supplyAsync(
            () -> taskRepository.findByOrganizationId(orgId));
        CompletableFuture<List<?>> projectsFuture = CompletableFuture.supplyAsync(
            () -> projectRepository.findByOrganizationId(orgId));
        CompletableFuture<List<?>> goalsFuture    = CompletableFuture.supplyAsync(
            () -> goalRepository.findByOrganizationId(orgId));

        CompletableFuture.allOf(tasksFuture, projectsFuture, goalsFuture).join();

        var tasks    = taskRepository.findByOrganizationId(orgId);
        var projects = projectRepository.findByOrganizationId(orgId);
        var goals    = goalRepository.findByOrganizationId(orgId);

        LocalDateTime now = LocalDateTime.now();

        long total       = tasks.size();
        long todo        = tasks.stream().filter(t -> "TODO".equals(t.getStatus())).count();
        long inProgress  = tasks.stream().filter(t -> "IN_PROGRESS".equals(t.getStatus())).count();
        long done        = tasks.stream().filter(t -> "DONE".equals(t.getStatus())).count();
        long overdue     = tasks.stream().filter(t ->
            t.getDueDate() != null && t.getDueDate().isBefore(now)
            && !"DONE".equals(t.getStatus())).count();

        long activeProj  = projects.stream().filter(p -> "ACTIVE".equals(p.getStatus())).count();
        long activeGoals = goals.stream().filter(g -> "ACTIVE".equals(g.getStatus())).count();

        // Overdue task list (lightweight — id + title + dueDate only)
        var overdueList = tasks.stream()
            .filter(t -> t.getDueDate() != null && t.getDueDate().isBefore(now)
                      && !"DONE".equals(t.getStatus()))
            .limit(10)
            .map(t -> Map.of("id", t.getId(), "title", t.getTitle(),
                             "dueDate", t.getDueDate().toString()))
            .collect(Collectors.toList());

        // Lightweight project list (id + name + status only)
        var activeProjectList = projects.stream()
            .filter(p -> "ACTIVE".equals(p.getStatus()))
            .limit(8)
            .map(p -> Map.of("id", p.getId(), "name", p.getName(),
                             "status", p.getStatus() != null ? p.getStatus() : ""))
            .collect(Collectors.toList());

        // Lightweight goal list
        var activeGoalList = goals.stream()
            .filter(g -> "ACTIVE".equals(g.getStatus()))
            .limit(6)
            .map(g -> Map.of("id", g.getId(), "title", g.getTitle(),
                             "progress", g.getProgress()))
            .collect(Collectors.toList());

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("totalTasks",       total);
        result.put("todoTasks",        todo);
        result.put("inProgressTasks",  inProgress);
        result.put("doneTasks",        done);
        result.put("overdueTasks",     overdueList);
        result.put("overdueCount",     overdue);
        result.put("activeProjects",   activeProj);
        result.put("totalProjects",    projects.size());
        result.put("activeGoals",      activeGoals);
        result.put("totalGoals",       goals.size());
        result.put("activeProjectList",   activeProjectList);
        // projectsWithProgress = same as activeProjectList with progress field
        // The frontend reads either key, so provide both for compatibility
        var projectsWithProgress = projects.stream()
            .filter(p -> "ACTIVE".equalsIgnoreCase(p.getStatus()))
            .map(p -> {
                var tasks_for_proj = taskRepository.findByProjectId(p.getId());
                long total_t = tasks_for_proj.size();
                long done_t  = tasks_for_proj.stream()
                    .filter(t -> "DONE".equals(t.getStatus())).count();
                int progress = total_t > 0 ? (int)((done_t * 100) / total_t) : 0;
                Map<String,Object> pm = new LinkedHashMap<>();
                pm.put("id",             p.getId());
                pm.put("name",           p.getName() != null ? p.getName() : "");
                pm.put("status",         p.getStatus() != null ? p.getStatus() : "ACTIVE");
                pm.put("progress",       progress);
                pm.put("parentProjectId",p.getParentProjectId()); // for hierarchy
                return pm;
            })
            .collect(Collectors.toList());
        result.put("projectsWithProgress", projectsWithProgress);
        result.put("activeGoalList",   activeGoalList);
        result.put("generatedAt",      now.toString());

        return ResponseEntity.ok(result);
    }

    /** Phase 2 — sprint overview (non-blocking) */
    @GetMapping("/sprints")
    public Map<String, Object> sprintSummary() {
        String orgId = workspaceContext.getWorkspaceId();
        var activeSprints = sprintRepository.findByOrganizationId(orgId).stream()
            .filter(s -> "ACTIVE".equals(s.getStatus()))
            .limit(3)
            .map(s -> Map.of("id", s.getId(), "name", s.getName() != null ? s.getName() : "Sprint"))
            .collect(Collectors.toList());
        return Map.of("activeSprints", activeSprints, "count", activeSprints.size());
    }

    /**
     * Daily Meeting Pulse — today's meetings, open/overdue actions,
     * blockers, at-risk projects, and recently completed items. Reuses
     * MeetingContinuityService's carry-forward aggregation rather than
     * duplicating that logic here.
     */
    @GetMapping("/meeting-pulse")
    public Map<String, Object> meetingPulse() {
        String orgId = workspaceContext.getWorkspaceId();
        LocalDateTime startOfDay = LocalDateTime.now().toLocalDate().atStartOfDay();
        LocalDateTime endOfDay   = startOfDay.plusDays(1);

        var todaysMeetings = meetingRepository.findByWorkspaceIdOrderByMeetingDateDesc(orgId).stream()
            .filter(m -> m.getMeetingDate() != null
                    && !m.getMeetingDate().isBefore(startOfDay) && m.getMeetingDate().isBefore(endOfDay))
            .map(m -> {
                Map<String, Object> mm = new LinkedHashMap<>();
                mm.put("id", m.getId());
                mm.put("title", m.getTitle() != null ? m.getTitle() : "Untitled Meeting");
                mm.put("meetingType", m.getMeetingType() != null ? m.getMeetingType() : "OTHER");
                mm.put("status", m.getStatus() != null ? m.getStatus() : "SCHEDULED");
                mm.put("meetingDate", m.getMeetingDate().toString());
                return mm;
            })
            .collect(Collectors.toList());

        Map<String, Object> carryForward = meetingContinuityService.getCarryForward(orgId, null);

        var recentlyCompleted = meetingActionItemService.getAll(orgId).stream()
            .filter(a -> "COMPLETED".equals(a.getStatus()) && a.getCompletedAt() != null
                    && a.getCompletedAt().isAfter(LocalDateTime.now().minusHours(48)))
            .limit(10)
            .map(a -> {
                Map<String, Object> am = new LinkedHashMap<>();
                am.put("id", a.getId());
                am.put("title", a.getTitle() != null ? a.getTitle() : "Untitled action item");
                am.put("completedAt", a.getCompletedAt().toString());
                return am;
            })
            .collect(Collectors.toList());

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("todaysMeetings", todaysMeetings);
        result.put("carryForwardCounts", carryForward.get("counts"));
        result.put("openActionItems", carryForward.get("actionItems"));
        result.put("blockers", carryForward.get("blockers"));
        result.put("risks", carryForward.get("risks"));
        result.put("atRiskProjects", carryForward.get("atRiskProjects"));
        result.put("recentlyCompleted", recentlyCompleted);
        return result;
    }
}

package com.prowosma.backend.service;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.Sprint;
import com.prowosma.backend.model.Task;
import com.prowosma.backend.repository.SprintRepository;
import com.prowosma.backend.repository.TaskRepository;
import com.prowosma.backend.service.ActivityLogService;
import lombok.RequiredArgsConstructor;
import com.prowosma.backend.util.PagedResponse;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.*;

@Service
@RequiredArgsConstructor
public class SprintService {

    private final SprintRepository sprintRepository;
    private final TaskRepository   taskRepository;
    private final WorkspaceContext workspaceContext;
    private final ActivityLogService activityLogService;
    private final VisibilityService visibility;

    private static final java.util.function.Function<Sprint, List<String>> PEOPLE = s -> VisibilityService.people(s.getCreatedBy());
    private static final java.util.function.Function<Sprint, List<String>> PROJECTS = s -> VisibilityService.projectsOf(s.getProjectId());

    public List<Sprint> getAll() {
        return visibility.filterLinked(sprintRepository.findByOrganizationId(workspaceContext.getWorkspaceId()), PEOPLE, PROJECTS);
    }

    public Sprint getById(String id) {
        Sprint s = sprintRepository.findById(id)
            .orElseThrow(() -> new RuntimeException("Sprint not found: " + id));
        return visibility.requireLinked(s, PEOPLE, PROJECTS);
    }

    public Sprint create(Sprint sprint, String author) {
        visibility.requireMayCreateLinked(sprint.getProjectId());
        sprint.setOrganizationId(workspaceContext.getWorkspaceId());
        sprint.setCreatedBy(author);
        sprint.setCreatedAt(LocalDateTime.now());
        sprint.setUpdatedAt(LocalDateTime.now());
        Sprint saved = sprintRepository.save(sprint);
        activityLogService.log("SPRINT", saved.getId(), saved.getName(),
                "CREATED", null, saved.getName(), author);
        return saved;
    }

    public Sprint update(String id, Sprint patch) {
        Sprint existing = getById(id);
        visibility.requireCapability(com.prowosma.backend.access.AccessConstants.CAP_MANAGE_PLANNING);
        if (patch.getProjectId() != null) visibility.requireProjectIdVisible(patch.getProjectId());
        if (patch.getName()      != null) existing.setName(patch.getName());
        if (patch.getGoal()      != null) existing.setGoal(patch.getGoal());
        if (patch.getStatus()    != null) existing.setStatus(patch.getStatus());
        if (patch.getStartDate() != null) existing.setStartDate(patch.getStartDate());
        if (patch.getEndDate()   != null) existing.setEndDate(patch.getEndDate());
        if (patch.getProjectId() != null) existing.setProjectId(patch.getProjectId());
        existing.setUpdatedAt(LocalDateTime.now());
        return sprintRepository.save(existing);
    }

    public void delete(String id) {
        Sprint s = getById(id);
        visibility.requireCapability(com.prowosma.backend.access.AccessConstants.CAP_MANAGE_PLANNING);
        activityLogService.log("SPRINT", id, s.getName(), "DELETED", s.getName(), null, null);
        sprintRepository.deleteById(id);
    }

    // ── Task management ──────────────────────────────────────────

    public Sprint addTask(String sprintId, String taskId) {
        Sprint sprint = getById(sprintId);
        visibility.requireCapability(com.prowosma.backend.access.AccessConstants.CAP_MANAGE_PLANNING);
        taskRepository.findById(taskId).filter(visibility::canSeeTask)
                .orElseThrow(() -> new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.NOT_FOUND, "Task not found"));
        if (!sprint.getTaskIds().contains(taskId))
            sprint.getTaskIds().add(taskId);
        sprint.setUpdatedAt(LocalDateTime.now());
        Sprint saved = sprintRepository.save(sprint);
        activityLogService.log("SPRINT", saved.getId(), saved.getName(),
                "TASK_ADDED", null, saved.getName(), null);
        return saved;
    }

    public Sprint removeTask(String sprintId, String taskId) {
        Sprint sprint = getById(sprintId);
        visibility.requireCapability(com.prowosma.backend.access.AccessConstants.CAP_MANAGE_PLANNING);
        sprint.getTaskIds().remove(taskId);
        sprint.setUpdatedAt(LocalDateTime.now());
        Sprint saved = sprintRepository.save(sprint);
        activityLogService.log("SPRINT", saved.getId(), saved.getName(),
                "TASK_REMOVED", null, saved.getName(), null);
        return saved;
    }

    /** Returns tasks in the sprint with full Task objects */
    public List<Task> getSprintTasks(String sprintId) {
        Sprint sprint = getById(sprintId);
        if (sprint.getTaskIds() == null || sprint.getTaskIds().isEmpty())
            return Collections.emptyList();
        return visibility.filterTasks(taskRepository.findAllById(sprint.getTaskIds()));
    }

    // ── C-2: Burndown data ────────────────────────────────────────

    /**
     * Returns day-by-day burndown data for a sprint.
     * Uses task completion dates from updatedAt when status changed to DONE.
     */
    public List<Map<String, Object>> getBurndown(String sprintId) {
        Sprint sprint = getById(sprintId);
        List<Task> tasks = getSprintTasks(sprintId);

        if (sprint.getStartDate() == null || sprint.getEndDate() == null)
            return Collections.emptyList();

        int totalPoints = tasks.stream()
            .mapToInt(t -> t.getStoryPoints() != null ? t.getStoryPoints() : 1)
            .sum();

        List<Map<String, Object>> burndown = new ArrayList<>();
        LocalDateTime cursor = sprint.getStartDate().toLocalDate().atStartOfDay();
        LocalDateTime end    = sprint.getEndDate().toLocalDate().atStartOfDay();

        int remaining = totalPoints;
        int ideal     = totalPoints;
        int days      = (int) java.time.temporal.ChronoUnit.DAYS.between(
                            sprint.getStartDate().toLocalDate(), sprint.getEndDate().toLocalDate()) + 1;
        double dailyBurn = days > 1 ? (double) totalPoints / (days - 1) : totalPoints;
        double idealRemaining = totalPoints;

        while (!cursor.isAfter(end)) {
            // Capture cursor in a final variable so it can be used inside the lambda
            final LocalDateTime dayStart = cursor;
            final LocalDateTime dayEnd   = cursor.plusDays(1);
            int burnedToday = tasks.stream()
                .filter(t -> "DONE".equals(t.getStatus())
                    && t.getUpdatedAt() != null
                    && !t.getUpdatedAt().isBefore(dayStart)
                    && t.getUpdatedAt().isBefore(dayEnd))
                .mapToInt(t -> t.getStoryPoints() != null ? t.getStoryPoints() : 1)
                .sum();
            remaining -= burnedToday;

            Map<String, Object> point = new LinkedHashMap<>();
            point.put("day",       dayStart.toLocalDate().toString());
            point.put("remaining", Math.max(0, remaining));
            point.put("ideal",     Math.max(0, (int) Math.round(idealRemaining)));
            burndown.add(point);

            cursor = dayEnd;
            idealRemaining -= dailyBurn;
        }
        return burndown;
    }

    // ── C-3: Retrospective ───────────────────────────────────────

    public Sprint saveRetrospective(String sprintId, Sprint.Retrospective retro, String author) {
        Sprint sprint = getById(sprintId);
        visibility.requireCapability(com.prowosma.backend.access.AccessConstants.CAP_MANAGE_PLANNING);
        retro.setCompletedBy(author);
        retro.setCompletedAt(LocalDateTime.now());
        sprint.setRetrospective(retro);
        sprint.setUpdatedAt(LocalDateTime.now());
        Sprint saved = sprintRepository.save(sprint);
        activityLogService.log("SPRINT", saved.getId(), saved.getName(),
                "CREATED", null, saved.getName(), author);
        return saved;
    }
    public PagedResponse<Sprint> getAllPaged(PageRequest pr) {
        if (visibility.isRestricted()) {
            var mine = getAll().stream()
                    .sorted(java.util.Comparator.comparing(Sprint::getCreatedAt, java.util.Comparator.nullsLast(java.util.Comparator.reverseOrder())))
                    .collect(java.util.stream.Collectors.toList());
            return PagedResponse.of(visibility.pageOf(mine, pr));
        }
        return PagedResponse.of(
                sprintRepository.findByOrganizationId(workspaceContext.getWorkspaceId(), pr));
    }
}
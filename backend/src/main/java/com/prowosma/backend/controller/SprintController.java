package com.prowosma.backend.controller;

import com.prowosma.backend.model.Sprint;
import com.prowosma.backend.model.Task;
import com.prowosma.backend.service.SprintService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import com.prowosma.backend.util.PagedResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/sprints")
@Tag(name = "Sprint APIs", description = "Agile sprint management")
@RequiredArgsConstructor
public class SprintController {

    private final SprintService sprintService;

    @GetMapping
    @Operation(summary = "Get all sprints for the workspace — paginated")
    public PagedResponse<Sprint> getAll(
            @RequestParam(defaultValue = "0")  int page,
            @RequestParam(defaultValue = "50") int size) {
        return sprintService.getAllPaged(PageRequest.of(page, Math.min(size, 200),
                Sort.by("createdAt").descending()));
    }

    @GetMapping("/{id}")
    @Operation(summary = "Get sprint by ID")
    public Sprint getById(@PathVariable String id) {
        return sprintService.getById(id);
    }

    @PostMapping
    @Operation(summary = "Create a new sprint")
    public Sprint create(@Valid @RequestBody Sprint sprint, Authentication auth) {
        return sprintService.create(sprint, auth != null ? auth.getName() : "anonymous");
    }

    @PutMapping("/{id}")
    @Operation(summary = "Update sprint (name, goal, status, dates)")
    public Sprint update(@PathVariable String id, @RequestBody Sprint patch) {
        return sprintService.update(id, patch);
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "Delete a sprint")
    public ResponseEntity<Map<String, String>> delete(@PathVariable String id) {
        sprintService.delete(id);
        return ResponseEntity.ok(Map.of("message", "Sprint deleted"));
    }

    // ── Task management ──────────────────────────────────────────

    @GetMapping("/{id}/tasks")
    @Operation(summary = "Get all tasks in a sprint")
    public List<Task> getTasks(@PathVariable String id) {
        return sprintService.getSprintTasks(id);
    }

    @PostMapping("/{id}/tasks/{taskId}")
    @Operation(summary = "Add a task to a sprint")
    public Sprint addTask(@PathVariable String id, @PathVariable String taskId) {
        return sprintService.addTask(id, taskId);
    }

    @DeleteMapping("/{id}/tasks/{taskId}")
    @Operation(summary = "Remove a task from a sprint")
    public Sprint removeTask(@PathVariable String id, @PathVariable String taskId) {
        return sprintService.removeTask(id, taskId);
    }

    // ── C-2: Burndown ─────────────────────────────────────────────

    @GetMapping("/{id}/burndown")
    @Operation(summary = "Get burndown chart data for a sprint")
    public List<Map<String, Object>> getBurndown(@PathVariable String id) {
        return sprintService.getBurndown(id);
    }

    // ── C-3: Retrospective ────────────────────────────────────────

    @PostMapping("/{id}/retrospective")
    @Operation(summary = "Save or update a sprint retrospective")
    public Sprint saveRetrospective(
            @PathVariable String id,
            @RequestBody Sprint.Retrospective retro,
            Authentication auth) {
        return sprintService.saveRetrospective(id, retro, auth != null ? auth.getName() : "anonymous");
    }
}

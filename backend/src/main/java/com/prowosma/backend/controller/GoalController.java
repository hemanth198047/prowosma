package com.prowosma.backend.controller;

import com.prowosma.backend.model.Goal;
import com.prowosma.backend.model.Step;
import com.prowosma.backend.model.SubGoal;
import com.prowosma.backend.model.Comment;
import com.prowosma.backend.model.Attachment;
import com.prowosma.backend.service.GoalService;
import com.prowosma.backend.util.PagedResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import com.prowosma.backend.service.OwnershipService;
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
@RequestMapping("/api/goals")
@Tag(name = "Goals APIs", description = "Operations related to Goals")
@RequiredArgsConstructor
public class GoalController {
    private final GoalService goalService;
    private final OwnershipService ownershipService;

    @GetMapping
    @Operation(summary = "Get All Goals — paginated")
    public PagedResponse<Goal> getAll(
            @RequestParam(defaultValue = "0")  int page,
            @RequestParam(defaultValue = "50") int size,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) Integer limit) {
        PageRequest pr = PageRequest.of(page, Math.min(size, 200),
                Sort.by("createdAt").descending());
        List<Goal> items = goalService.getAll();
        if (status != null && !status.isBlank()) {
            items = items.stream()
                .filter(i -> status.equalsIgnoreCase(i.getStatus()))
                .collect(java.util.stream.Collectors.toList());
        }
        return PagedResponse.ofList(items, page, Math.min(size, 200));
    }

    @GetMapping("/{id}")
    @Operation(
            summary = "Get Goal by ID",
            description = "Fetch Goal information using Goal ID"
    )
    @ApiResponses(value = {
            @ApiResponse(responseCode = "200", description = "Goals found"),
            @ApiResponse(responseCode = "404", description = "Goals not found"),
            @ApiResponse(responseCode = "500", description = "Internal server error")
    })
    public Goal getById(@PathVariable String id) {
        return goalService.getById(id);
    }

    @PostMapping
    @Operation(
            summary = "Create a Goal",
            description = "Create Goal using project information in request body"
    )
    @ApiResponses(value = {
            @ApiResponse(responseCode = "200", description = "Goal Created"),
            @ApiResponse(responseCode = "404", description = "Goal not found"),
            @ApiResponse(responseCode = "500", description = "Internal server error")
    })
    public Goal create(@Valid @RequestBody Goal goal, Authentication auth) {
        if (auth != null) goal.setCreatedBy(auth.getName());
        return goalService.create(goal);
    }

    @PutMapping("/{id}")
    @Operation(
            summary = "Update Goal by ID",
            description = "Update Goal information using project ID and updated Goal information in request body"
    )
    @ApiResponses(value = {
            @ApiResponse(responseCode = "200", description = "Goal Updated"),
            @ApiResponse(responseCode = "404", description = "Goal not found"),
            @ApiResponse(responseCode = "500", description = "Internal server error")
    })
    public Goal update(@PathVariable String id, @RequestBody Goal goal) {
        return goalService.update(id, goal);
    }

    @PatchMapping("/{id}/progress")
    @Operation(
            summary = "Patch Goal progress by ID",
            description = "Patch Goal information using Goal ID and updated Goal information in request body"
    )
    @ApiResponses(value = {
            @ApiResponse(responseCode = "200", description = "Goal Patched"),
            @ApiResponse(responseCode = "404", description = "Goal not found"),
            @ApiResponse(responseCode = "500", description = "Internal server error")
    })
    public Goal updateProgress(@PathVariable String id, @RequestBody Map<String, Integer> body) {
        return goalService.updateProgress(id, body.get("progress"));
    }

    @DeleteMapping("/{id}")
    @Operation(
            summary = "Delete Goal by ID",
            description = "Delete Goal information using Goal ID"
    )
    @ApiResponses(value = {
            @ApiResponse(responseCode = "200", description = "Goal Deleted"),
            @ApiResponse(responseCode = "404", description = "Goal not found"),
            @ApiResponse(responseCode = "500", description = "Internal server error")
    })
    public ResponseEntity<?> delete(@PathVariable String id, Authentication auth) {
        Goal existing = goalService.getById(id);
        String email = auth != null ? auth.getName() : "";
        if (!ownershipService.canModify(email, existing.getCreatedBy())) {
            return ResponseEntity.status(403).body(
                    Map.of("message", "Only the goal creator or an Admin can delete this goal"));
        }
        goalService.delete(id);
        return ResponseEntity.ok(Map.of("message", "Goal deleted successfully"));
    }

    // Sub-goal endpoints
    @PostMapping("/{id}/subgoals")
    public Goal addSubGoal(@PathVariable String id, @RequestBody SubGoal subGoal) {
        return goalService.addSubGoal(id, subGoal);
    }

    @PutMapping("/{id}/subgoals/{subGoalId}")
    public Goal updateSubGoal(@PathVariable String id, @PathVariable String subGoalId,
                              @RequestBody SubGoal updated) {
        return goalService.updateSubGoal(id, subGoalId, updated);
    }

    @DeleteMapping("/{id}/subgoals/{subGoalId}")
    public Goal deleteSubGoal(@PathVariable String id, @PathVariable String subGoalId) {
        return goalService.deleteSubGoal(id, subGoalId);
    }

    // Step endpoints
    @PostMapping("/{id}/subgoals/{subGoalId}/steps")
    public Goal addStep(@PathVariable String id, @PathVariable String subGoalId,
                        @RequestBody Step step) {
        return goalService.addStep(id, subGoalId, step);
    }

    @PatchMapping("/{id}/subgoals/{subGoalId}/steps/{stepId}/toggle")
    public Goal toggleStep(@PathVariable String id, @PathVariable String subGoalId,
                           @PathVariable String stepId) {
        return goalService.toggleStep(id, subGoalId, stepId);
    }

    @DeleteMapping("/{id}/subgoals/{subGoalId}/steps/{stepId}")
    public Goal deleteStep(@PathVariable String id, @PathVariable String subGoalId,
                           @PathVariable String stepId) {
        return goalService.deleteStep(id, subGoalId, stepId);
    }

    // ── Step Comments ─────────────────────────────────────────
    @PostMapping("/{id}/subgoals/{subGoalId}/steps/{stepId}/comments")
    public Goal addStepComment(@PathVariable String id, @PathVariable String subGoalId,
                               @PathVariable String stepId,
                               @RequestBody Comment comment, Authentication auth) {
        comment.setAuthor(auth.getName());
        comment.setCreatedAt(java.time.LocalDateTime.now());
        if (comment.getId() == null) comment.setId(java.util.UUID.randomUUID().toString());
        return goalService.addStepComment(id, subGoalId, stepId, comment);
    }

    @DeleteMapping("/{id}/subgoals/{subGoalId}/steps/{stepId}/comments/{commentId}")
    public Goal deleteStepComment(@PathVariable String id, @PathVariable String subGoalId,
                                  @PathVariable String stepId, @PathVariable String commentId) {
        return goalService.deleteStepComment(id, subGoalId, stepId, commentId);
    }

    // ── Step Attachments ──────────────────────────────────────
    @PostMapping("/{id}/subgoals/{subGoalId}/steps/{stepId}/attachments")
    public Goal addStepAttachment(@PathVariable String id, @PathVariable String subGoalId,
                                  @PathVariable String stepId,
                                  @RequestParam("file") org.springframework.web.multipart.MultipartFile file,
                                  Authentication auth) throws java.io.IOException {
        return goalService.addStepAttachment(id, subGoalId, stepId, file,
                auth != null ? auth.getName() : "User");
    }

    @DeleteMapping("/{id}/subgoals/{subGoalId}/steps/{stepId}/attachments/{attachmentId}")
    public Goal deleteStepAttachment(@PathVariable String id, @PathVariable String subGoalId,
                                     @PathVariable String stepId,
                                     @PathVariable String attachmentId) {
        return goalService.deleteStepAttachment(id, subGoalId, stepId, attachmentId);
    }

    // ── Step Dependencies ─────────────────────────────────────
    @PostMapping("/{id}/subgoals/{subGoalId}/steps/{stepId}/dependencies")
    public Goal addStepDependency(@PathVariable String id, @PathVariable String subGoalId,
                                  @PathVariable String stepId,
                                  @RequestBody Map<String, String> body) {
        return goalService.addStepDependency(id, subGoalId, stepId, body.get("blockedByStepId"));
    }

    @DeleteMapping("/{id}/subgoals/{subGoalId}/steps/{stepId}/dependencies/{blockedByStepId}")
    public Goal removeStepDependency(@PathVariable String id, @PathVariable String subGoalId,
                                     @PathVariable String stepId,
                                     @PathVariable String blockedByStepId) {
        return goalService.removeStepDependency(id, subGoalId, stepId, blockedByStepId);
    }

    // ═══════════════════════════════════════════════════════════
    // B-1: Cascading goals
    // ═══════════════════════════════════════════════════════════

    @GetMapping("/tree")
    @Operation(summary = "Get full goal tree with parent-child relationships")
    public java.util.Map<String, Object> getTree() {
        return goalService.getGoalTree();
    }

    @GetMapping("/roots")
    @Operation(summary = "Get only root-level goals (no parent)")
    public List<Goal> getRoots() {
        return goalService.getRootGoals();
    }

    @GetMapping("/{id}/children")
    @Operation(summary = "Get child goals of a given goal")
    public List<Goal> getChildren(@PathVariable String id) {
        return goalService.getChildGoals(id);
    }

    // ═══════════════════════════════════════════════════════════
    // B-2: Confidence scoring
    // ═══════════════════════════════════════════════════════════

    @PatchMapping("/{id}/confidence")
    @Operation(summary = "Update confidence score for a goal")
    public ResponseEntity<Goal> updateConfidence(
            @PathVariable String id,
            @RequestBody Map<String, Object> body,
            Authentication auth) {
        int confidence = body.containsKey("confidence")
            ? ((Number) body.get("confidence")).intValue() : 50;
        String note = (String) body.getOrDefault("note", "");
        String author = auth != null ? auth.getName() : "anonymous";
        return ResponseEntity.ok(goalService.updateConfidence(id, confidence, note, author));
    }

    // ═══════════════════════════════════════════════════════════
    // B-3: Weekly check-ins
    // ═══════════════════════════════════════════════════════════

    @PostMapping("/{id}/checkins")
    @Operation(summary = "Add a weekly check-in to a goal")
    public ResponseEntity<Goal> addCheckIn(
            @PathVariable String id,
            @RequestBody Goal.CheckIn checkIn,
            Authentication auth) {
        String author = auth != null ? auth.getName() : "anonymous";
        return ResponseEntity.ok(goalService.addCheckIn(id, checkIn, author));
    }

    @DeleteMapping("/{id}/checkins/{checkInId}")
    @Operation(summary = "Delete a check-in")
    public ResponseEntity<Goal> deleteCheckIn(
            @PathVariable String id,
            @PathVariable String checkInId) {
        return ResponseEntity.ok(goalService.deleteCheckIn(id, checkInId));
    }

    // ═══════════════════════════════════════════════════════════
    // B-4: Key Results
    // ═══════════════════════════════════════════════════════════

    @PostMapping("/{id}/keyresults")
    @Operation(summary = "Add a Key Result to a goal")
    public ResponseEntity<Goal> addKeyResult(
            @PathVariable String id,
            @RequestBody Goal.KeyResult kr) {
        return ResponseEntity.ok(goalService.addKeyResult(id, kr));
    }

    @PatchMapping("/{id}/keyresults/{krId}")
    @Operation(summary = "Update a Key Result (current value, status, etc.)")
    public ResponseEntity<Goal> updateKeyResult(
            @PathVariable String id,
            @PathVariable String krId,
            @RequestBody Goal.KeyResult patch) {
        return ResponseEntity.ok(goalService.updateKeyResult(id, krId, patch));
    }

    @DeleteMapping("/{id}/keyresults/{krId}")
    @Operation(summary = "Delete a Key Result")
    public ResponseEntity<Goal> deleteKeyResult(
            @PathVariable String id,
            @PathVariable String krId) {
        return ResponseEntity.ok(goalService.deleteKeyResult(id, krId));
    }


    @PatchMapping("/{id}/dependencies")
    public Goal updateDependencies(@PathVariable String id,
                                   @RequestBody java.util.Map<String, Object> body) {
        Goal goal = goalService.getById(id);
        @SuppressWarnings("unchecked")
        java.util.List<String> prereqs = (java.util.List<String>) body.get("prerequisiteGoalIds");
        if (prereqs != null) goal.setPrerequisiteGoalIds(prereqs);
        goal.setUpdatedAt(java.time.LocalDateTime.now());
        return goalService.save(goal);
    }

}

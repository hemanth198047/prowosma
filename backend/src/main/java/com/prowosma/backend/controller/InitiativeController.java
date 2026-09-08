package com.prowosma.backend.controller;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.Initiative;
import com.prowosma.backend.repository.InitiativeRepository;
import com.prowosma.backend.util.PagedResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * Strategic initiatives — the Initiative model and InitiativeRepository
 * already existed (with a "for SCIM/admin queries"-style comment nowhere
 * near them, just sitting there fully built), but nothing ever exposed
 * them over the API. The frontend's Portfolio+ "Initiatives" tab has been
 * calling GET/POST/PUT/DELETE /api/initiatives this whole time, 404ing on
 * every load. Not a data-shape bug like the unwrapList() issues found
 * elsewhere — the endpoint genuinely didn't exist.
 */
@RestController
@RequestMapping("/api/initiatives")
@RequiredArgsConstructor
public class InitiativeController {

    private final InitiativeRepository repo;
    private final WorkspaceContext     ws;

    @GetMapping
    public PagedResponse<Initiative> getAll(
            @RequestParam(defaultValue = "0")  int page,
            @RequestParam(defaultValue = "50") int size) {
        var all = repo.findByOrganizationId(ws.getWorkspaceId());
        return PagedResponse.ofList(all, page, Math.min(size, 200));
    }

    @PostMapping
    public Initiative create(@RequestBody Initiative i, Authentication auth) {
        i.setOrganizationId(ws.getWorkspaceId());
        i.setCreatedBy(auth.getName());
        i.setCreatedAt(LocalDateTime.now());
        i.setUpdatedAt(LocalDateTime.now());
        return repo.save(i);
    }

    @PutMapping("/{id}")
    public Initiative update(@PathVariable String id, @RequestBody Initiative patch) {
        return repo.findById(id).map(i -> {
            if (patch.getName()               != null) i.setName(patch.getName());
            if (patch.getDescription()        != null) i.setDescription(patch.getDescription());
            if (patch.getStrategicRationale() != null) i.setStrategicRationale(patch.getStrategicRationale());
            if (patch.getStatus()             != null) i.setStatus(patch.getStatus());
            if (patch.getOwner()              != null) i.setOwner(patch.getOwner());
            if (patch.getPriority()           != null) i.setPriority(patch.getPriority());
            if (patch.getProjectIds()         != null) i.setProjectIds(patch.getProjectIds());
            if (patch.getGoalIds()            != null) i.setGoalIds(patch.getGoalIds());
            if (patch.getStartDate()          != null) i.setStartDate(patch.getStartDate());
            if (patch.getTargetDate()         != null) i.setTargetDate(patch.getTargetDate());
            // progress is an int (no null state) — 0 is a valid value the
            // frontend's range slider can genuinely send, so always apply it
            // rather than skipping on falsy, unlike the null-checked fields above.
            i.setProgress(patch.getProgress());
            i.setUpdatedAt(LocalDateTime.now());
            return repo.save(i);
        }).orElseThrow();
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, String>> delete(@PathVariable String id) {
        repo.deleteById(id);
        return ResponseEntity.ok(Map.of("message", "Deleted"));
    }
}

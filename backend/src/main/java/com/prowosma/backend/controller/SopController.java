package com.prowosma.backend.controller;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.Sop;
import com.prowosma.backend.repository.SopRepository;
import io.swagger.v3.oas.annotations.tags.Tag;
import com.prowosma.backend.util.PagedResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

import java.time.LocalDateTime;
import java.util.*;

@RestController
@RequestMapping("/api/sops")
@Tag(name = "SOPs", description = "Standard Operating Procedures")
@RequiredArgsConstructor
public class SopController {

    private final SopRepository    sopRepository;
    private final WorkspaceContext workspaceContext;
    private final com.prowosma.backend.service.VisibilityService visibility;

    private static final java.util.function.Function<Sop, List<String>> PEOPLE = x -> com.prowosma.backend.service.VisibilityService.people(x.getCreatedBy(), x.getOwner(), x.getUserEmail());
    private static final java.util.function.Function<Sop, List<String>> NO_PROJECTS = x -> new java.util.ArrayList<String>();

    /** The SOP, or 404 when the caller may not see it. */
    private Sop visibleSop(Sop s) { return visibility.requireLinked(s, PEOPLE, NO_PROJECTS); }

    /** The SOP for changing: visible, and the caller may change planning records. */
    private Sop writableSop(Sop s) { return visibility.requireLinkedWrite(s, PEOPLE, NO_PROJECTS); }

    @GetMapping
    public PagedResponse<Sop> getAll(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String category,
            @RequestParam(required = false) String q,
            @RequestParam(defaultValue = "0")  int page,
            @RequestParam(defaultValue = "50") int size) {
        String wsId = workspaceContext.getWorkspaceId();
        java.util.List<Sop> all;
        if (q        != null) all = sopRepository.findByWorkspaceIdAndTitleContainingIgnoreCaseOrderByUpdatedAtDesc(wsId, q);
        else if (category != null) all = sopRepository.findByWorkspaceIdAndCategoryOrderByUpdatedAtDesc(wsId, category);
        else if (status   != null) all = sopRepository.findByWorkspaceIdAndStatusOrderByUpdatedAtDesc(wsId, status);
        else                       all = sopRepository.findByWorkspaceIdOrderByUpdatedAtDesc(wsId);
        return PagedResponse.ofList(visibility.filterLinked(all, PEOPLE, NO_PROJECTS), page, Math.min(size, 200));
    }

    @GetMapping("/{id}")
    public Sop getById(@PathVariable String id) {
        return visibleSop(sopRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "SOP not found: " + id)));
    }

    @GetMapping("/categories")
    public List<Sop> getCategories() {
        return visibility.filterLinked(sopRepository.findDistinctCategoryByWorkspaceId(workspaceContext.getWorkspaceId()), PEOPLE, NO_PROJECTS);
    }

    @PostMapping
    public Sop create(@RequestBody Sop sop, Authentication auth) {
        visibility.requireMayCreateLinked((String) null);
        sop.setWorkspaceId(workspaceContext.getWorkspaceId());
        sop.setCreatedBy(auth.getName());
        sop.setStatus("DRAFT");
        sop.setVersion(1);
        sop.setCreatedAt(LocalDateTime.now());
        sop.setUpdatedAt(LocalDateTime.now());
        if (sop.getSteps() == null) sop.setSteps(new ArrayList<>());
        return sopRepository.save(sop);
    }

    @PutMapping("/{id}")
    public Sop update(@PathVariable String id, @RequestBody Map<String, Object> patch) {
        return sopRepository.findById(id).map(s -> {
            writableSop(s);
            if (patch.containsKey("title"))          s.setTitle((String) patch.get("title"));
            if (patch.containsKey("description"))    s.setDescription((String) patch.get("description"));
            if (patch.containsKey("category"))       s.setCategory((String) patch.get("category"));
            if (patch.containsKey("status"))         s.setStatus((String) patch.get("status"));
            if (patch.containsKey("owner"))          s.setOwner((String) patch.get("owner"));
            if (patch.containsKey("reviewFrequency"))s.setReviewFrequency((String) patch.get("reviewFrequency"));
            if (patch.containsKey("lastReviewedAt") && patch.get("lastReviewedAt") != null)
                s.setLastReviewedAt(LocalDateTime.parse((String) patch.get("lastReviewedAt")));
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> steps = (List<Map<String, Object>>) patch.get("steps");
            if (steps != null) s.setSteps(steps);
            s.setUpdatedAt(LocalDateTime.now());
            return sopRepository.save(s);
        }).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "SOP not found: " + id));
    }

    @PostMapping("/{id}/publish")
    public Sop publish(@PathVariable String id) {
        return sopRepository.findById(id).map(s -> {
            writableSop(s);
            s.setStatus("ACTIVE");
            // version is int (primitive), safe to use directly
            s.setVersion(s.getVersion() + 1);
            s.setUpdatedAt(LocalDateTime.now());
            return sopRepository.save(s);
        }).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "SOP not found: " + id));
    }

    @PostMapping("/{id}/mark-reviewed")
    public Sop markReviewed(@PathVariable String id, Authentication auth) {
        return sopRepository.findById(id).map(s -> {
            writableSop(s);
            s.setLastReviewedAt(LocalDateTime.now());
            s.setLastReviewedBy(auth.getName());
            s.setUpdatedAt(LocalDateTime.now());
            return sopRepository.save(s);
        }).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "SOP not found: " + id));
    }

    @PostMapping("/{id}/duplicate")
    public Sop duplicate(@PathVariable String id, Authentication auth) {
        return sopRepository.findById(id).map(s -> {
            visibleSop(s); visibility.requireMayCreateLinked((String) null);
            Sop copy = new Sop();
            copy.setWorkspaceId(s.getWorkspaceId());
            copy.setTitle(s.getTitle() + " (Copy)");
            copy.setDescription(s.getDescription());
            copy.setCategory(s.getCategory());
            copy.setSteps(s.getSteps() != null ? new ArrayList<>(s.getSteps()) : new ArrayList<>());
            copy.setOwner(auth.getName());
            copy.setStatus("DRAFT");
            copy.setVersion(1);
            copy.setCreatedBy(auth.getName());
            copy.setCreatedAt(LocalDateTime.now());
            copy.setUpdatedAt(LocalDateTime.now());
            return sopRepository.save(copy);
        }).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "SOP not found: " + id));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, String>> delete(@PathVariable String id) {
        sopRepository.findById(id).ifPresent(s -> { writableSop(s); sopRepository.delete(s); });
        return ResponseEntity.ok(Map.of("message", "SOP deleted"));
    }
}

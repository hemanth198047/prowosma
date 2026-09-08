package com.prowosma.backend.controller;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.RaidEntry;
import com.prowosma.backend.repository.RaidRepository;
import io.swagger.v3.oas.annotations.tags.Tag;
import com.prowosma.backend.util.PagedResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/raid")
@Tag(name = "RAID Log")
@RequiredArgsConstructor
public class RaidController {
    private final RaidRepository raidRepository;
    private final WorkspaceContext workspaceContext;

    @GetMapping
    public PagedResponse<RaidEntry> getAll(
            @RequestParam(required = false) String projectId,
            @RequestParam(defaultValue = "0")  int page,
            @RequestParam(defaultValue = "50") int size) {
        String orgId = workspaceContext.getWorkspaceId();
        var all = projectId != null
            ? raidRepository.findByOrganizationIdAndProjectId(orgId, projectId)
            : raidRepository.findByOrganizationId(orgId);
        return PagedResponse.ofList(all, page, Math.min(size, 200));
    }

    @PostMapping
    public RaidEntry create(@RequestBody RaidEntry entry, Authentication auth) {
        entry.setOrganizationId(workspaceContext.getWorkspaceId());
        entry.setCreatedBy(auth.getName());
        entry.setCreatedAt(LocalDateTime.now());
        entry.setUpdatedAt(LocalDateTime.now());
        if (entry.getStatus() == null) entry.setStatus("OPEN");
        return raidRepository.save(entry);
    }

    @PutMapping("/{id}")
    public RaidEntry update(@PathVariable String id, @RequestBody RaidEntry patch) {
        return raidRepository.findById(id).map(e -> {
            if (patch.getTitle()       != null) e.setTitle(patch.getTitle());
            if (patch.getDescription() != null) e.setDescription(patch.getDescription());
            if (patch.getOwner()       != null) e.setOwner(patch.getOwner());
            if (patch.getStatus()      != null) e.setStatus(patch.getStatus());
            if (patch.getMitigation()  != null) e.setMitigation(patch.getMitigation());
            if (patch.getImpact()      != null) e.setImpact(patch.getImpact());
            if (patch.getProbability() != null) e.setProbability(patch.getProbability());
            e.setUpdatedAt(LocalDateTime.now());
            return raidRepository.save(e);
        }).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "RAID entry not found"));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String,String>> delete(@PathVariable String id) {
        raidRepository.deleteById(id);
        return ResponseEntity.ok(Map.of("message","Deleted"));
    }
}

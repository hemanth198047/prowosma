package com.prowosma.backend.controller;
import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.Programme;
import com.prowosma.backend.repository.ProgrammeRepository;
import com.prowosma.backend.util.PagedResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController @RequestMapping("/api/programmes") @RequiredArgsConstructor
public class ProgrammeController {
    private final ProgrammeRepository repo;
    private final WorkspaceContext    ws;

    @GetMapping
    public PagedResponse<Programme> getAll(
            @RequestParam(defaultValue = "0")  int page,
            @RequestParam(defaultValue = "50") int size) {
        return PagedResponse.of(repo.findByOrganizationId(ws.getWorkspaceId(),
            org.springframework.data.domain.PageRequest.of(page, Math.min(size, 200))));
    }

    @PostMapping
    public Programme create(@RequestBody Programme p, Authentication auth) {
        p.setOrganizationId(ws.getWorkspaceId());
        p.setCreatedBy(auth.getName());
        p.setCreatedAt(LocalDateTime.now()); p.setUpdatedAt(LocalDateTime.now());
        return repo.save(p);
    }

    @PutMapping("/{id}")
    public Programme update(@PathVariable String id, @RequestBody Programme patch) {
        return repo.findById(id).map(p -> {
            if (patch.getName()       != null) p.setName(patch.getName());
            if (patch.getDescription()!= null) p.setDescription(patch.getDescription());
            if (patch.getStatus()     != null) p.setStatus(patch.getStatus());
            if (patch.getOwner()      != null) p.setOwner(patch.getOwner());
            if (patch.getProjectIds() != null) p.setProjectIds(patch.getProjectIds());
            if (patch.getMilestones() != null) p.setMilestones(patch.getMilestones());
            p.setUpdatedAt(LocalDateTime.now());
            return repo.save(p);
        }).orElseThrow();
    }

    @PostMapping("/{id}/milestones")
    public Programme addMilestone(@PathVariable String id,
                                  @RequestBody Programme.ProgrammeMilestone m) {
        return repo.findById(id).map(p -> {
            if (m.getId() == null || m.getId().isEmpty()) m.setId(UUID.randomUUID().toString());
            p.getMilestones().add(m);
            p.setUpdatedAt(LocalDateTime.now());
            return repo.save(p);
        }).orElseThrow();
    }

    @PatchMapping("/{id}/milestones/{mId}/toggle")
    public Programme toggleMilestone(@PathVariable String id, @PathVariable String mId) {
        return repo.findById(id).map(p -> {
            p.getMilestones().stream().filter(m -> mId.equals(m.getId()))
                .findFirst().ifPresent(m -> m.setCompleted(!m.isCompleted()));
            p.setUpdatedAt(LocalDateTime.now());
            return repo.save(p);
        }).orElseThrow();
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String,String>> delete(@PathVariable String id) {
        repo.deleteById(id); return ResponseEntity.ok(Map.of("message","Deleted"));
    }
}

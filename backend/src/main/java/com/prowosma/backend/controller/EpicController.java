package com.prowosma.backend.controller;
import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.Epic;
import com.prowosma.backend.repository.EpicRepository;
import com.prowosma.backend.util.PagedResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;
import java.time.LocalDateTime;
import java.util.*;
@RestController @RequestMapping("/api/epics") @RequiredArgsConstructor
public class EpicController {
    private final EpicRepository repo;
    private final WorkspaceContext ws;
    @GetMapping public PagedResponse<Epic> getAll(
            @RequestParam(required = false) String projectId,
            @RequestParam(defaultValue = "0")  int page,
            @RequestParam(defaultValue = "50") int size) {
        var all = repo.findByOrganizationId(ws.getWorkspaceId());
        if (projectId != null)
            all = all.stream().filter(e -> projectId.equals(e.getProjectId())).toList();
        return PagedResponse.ofList(all, page, Math.min(size, 200));
    }
    @PostMapping public Epic create(@RequestBody Epic e, Authentication auth) {
        e.setOrganizationId(ws.getWorkspaceId()); e.setCreatedBy(auth.getName());
        e.setCreatedAt(LocalDateTime.now()); e.setUpdatedAt(LocalDateTime.now());
        return repo.save(e);
    }
    @PutMapping("/{id}") public Epic update(@PathVariable String id, @RequestBody Epic patch) {
        return repo.findById(id).map(e -> {
            if (patch.getName()       != null) e.setName(patch.getName());
            if (patch.getDescription()!= null) e.setDescription(patch.getDescription());
            if (patch.getStatus()     != null) e.setStatus(patch.getStatus());
            if (patch.getColor()      != null) e.setColor(patch.getColor());
            if (patch.getTaskIds()    != null) e.setTaskIds(patch.getTaskIds());
            e.setUpdatedAt(LocalDateTime.now());
            return repo.save(e);
        }).orElseThrow();
    }
    @DeleteMapping("/{id}") public ResponseEntity<Map<String,String>> delete(@PathVariable String id) {
        repo.deleteById(id); return ResponseEntity.ok(Map.of("message","Deleted"));
    }
}

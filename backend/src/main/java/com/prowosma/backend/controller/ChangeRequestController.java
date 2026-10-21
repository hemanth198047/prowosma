package com.prowosma.backend.controller;
import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.ChangeRequest;
import com.prowosma.backend.repository.ChangeRequestRepository;
import com.prowosma.backend.util.PagedResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

@RestController @RequestMapping("/api/changes") @RequiredArgsConstructor
public class ChangeRequestController {
    private final ChangeRequestRepository repo;
    private final WorkspaceContext        ws;
    private final com.prowosma.backend.service.VisibilityService visibility;

    @GetMapping
    public PagedResponse<ChangeRequest> getAll(
            @RequestParam(required = false) String projectId,
            @RequestParam(defaultValue = "0")  int page,
            @RequestParam(defaultValue = "50") int size) {
        var all = repo.findByOrganizationId(ws.getWorkspaceId());
        if (projectId != null)
            all = all.stream().filter(c -> projectId.equals(c.getProjectId())).toList();
        return PagedResponse.ofList(visibility.filterLinked(all, x -> com.prowosma.backend.service.VisibilityService.people(x.getCreatedBy(), x.getRequestedBy()), x -> com.prowosma.backend.service.VisibilityService.projectsOf(x.getProjectId())), page, Math.min(size, 200));
    }

    @PostMapping
    public ChangeRequest create(@RequestBody ChangeRequest c, Authentication auth) {
        visibility.requireMayCreateLinked(c.getProjectId());
        c.setOrganizationId(ws.getWorkspaceId());
        c.setCreatedBy(auth.getName()); c.setRequestedBy(auth.getName());
        c.setCreatedAt(LocalDateTime.now()); c.setUpdatedAt(LocalDateTime.now());
        return repo.save(c);
    }

    @PutMapping("/{id}")
    public ChangeRequest update(@PathVariable String id, @RequestBody ChangeRequest patch) {
        return repo.findById(id).map(c -> {
            visibility.requireLinkedWrite(c, x -> com.prowosma.backend.service.VisibilityService.people(x.getCreatedBy(), x.getRequestedBy()), x -> com.prowosma.backend.service.VisibilityService.projectsOf(x.getProjectId()));
            if (patch.getTitle()             != null) c.setTitle(patch.getTitle());
            if (patch.getDescription()       != null) c.setDescription(patch.getDescription());
            if (patch.getImpact()            != null) c.setImpact(patch.getImpact());
            if (patch.getImpactDescription() != null) c.setImpactDescription(patch.getImpactDescription());
            if (patch.getCategory()          != null) c.setCategory(patch.getCategory());
            if (patch.getStatus()            != null) {
                c.setStatus(patch.getStatus());
                // Record when the request actually left DRAFT, not just when it
                // was approved/rejected — the model has always had this field,
                // the update path just never populated it, so it stayed null
                // for every change request regardless of status.
                if ("SUBMITTED".equals(patch.getStatus()) && c.getSubmittedAt() == null)
                    c.setSubmittedAt(LocalDateTime.now());
                if ("APPROVED".equals(patch.getStatus()) || "REJECTED".equals(patch.getStatus()))
                    c.setResolvedAt(LocalDateTime.now());
            }
            if (patch.getApprovers()         != null) c.setApprovers(patch.getApprovers());
            if (patch.getCurrentApprover()   != null) c.setCurrentApprover(patch.getCurrentApprover());
            if (patch.getRejectionReason()   != null) c.setRejectionReason(patch.getRejectionReason());
            if (patch.getLinkedTaskId()      != null) c.setLinkedTaskId(patch.getLinkedTaskId());
            c.setUpdatedAt(LocalDateTime.now());
            return repo.save(c);
        }).orElseThrow();
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String,String>> delete(@PathVariable String id) {
        repo.findById(id).ifPresent(c -> { visibility.requireLinkedWrite(c, x -> com.prowosma.backend.service.VisibilityService.people(x.getCreatedBy(), x.getRequestedBy()), x -> com.prowosma.backend.service.VisibilityService.projectsOf(x.getProjectId())); repo.delete(c); });
        return ResponseEntity.ok(Map.of("message","Deleted"));
    }
}

package com.prowosma.backend.controller;

import com.prowosma.backend.model.Project;
import com.prowosma.backend.service.ProjectService;
import com.prowosma.backend.util.PagedResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import com.prowosma.backend.service.OwnershipService;
import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.repository.ProjectRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.security.core.Authentication;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/projects")
@Tag(name = "Projects APIs", description = "Operations related to Projects")
@RequiredArgsConstructor
public class ProjectController {
    private final ProjectService   projectService;
    private final OwnershipService ownershipService;
    private final ProjectRepository projectRepository;
    private final WorkspaceContext  ws;

    @GetMapping
    @Operation(summary = "Get All Projects — paginated",
               description = "Fetch projects with pagination. Use page/size params. " +
                             "Legacy limit param still works for backwards compatibility.")
    public PagedResponse<Project> getAll(
            @RequestParam(defaultValue = "0")   int page,
            @RequestParam(defaultValue = "50")  int size,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) Integer limit) {

        PageRequest pr = PageRequest.of(page, Math.min(size, 200),
                Sort.by("createdAt").descending());

        String orgId = ws.getWorkspaceId();
        System.out.println("[ProjectController] getAll orgId=" + orgId + " size=" + pr.getPageSize());
        if (orgId == null || orgId.isBlank()) {
            return PagedResponse.of(org.springframework.data.domain.Page.empty(pr));
        }
        if (status != null && !status.isBlank()) {
            var result = projectRepository.findByOrganizationIdAndStatus(
                    orgId, status.toUpperCase(), pr);
            return PagedResponse.of(result);
        }
        var result = projectRepository.findByOrganizationId(orgId, pr);
        System.out.println("[ProjectController] found " + result.getTotalElements() + " projects");
        return PagedResponse.of(result);
    }

    @GetMapping("/{id}")
    @Operation(
            summary = "Get Project by ID",
            description = "Fetch project information using project ID"
    )
    @ApiResponses(value = {
            @ApiResponse(responseCode = "200", description = "Projects found"),
            @ApiResponse(responseCode = "404", description = "Projects not found"),
            @ApiResponse(responseCode = "500", description = "Internal server error")
    })
    public Project getById(@PathVariable String id) {
        return projectService.getById(id);
    }

    @PostMapping
    @Operation(
            summary = "Create a Project",
            description = "Create project using project information in request body"
    )
    @ApiResponses(value = {
            @ApiResponse(responseCode = "200", description = "Project Created"),
            @ApiResponse(responseCode = "404", description = "Project not found"),
            @ApiResponse(responseCode = "500", description = "Internal server error")
    })
    public Project create(@Valid @RequestBody Project project, Authentication auth) {
        if (auth != null) project.setCreatedBy(auth.getName());
        return projectService.create(project);
    }

    @PutMapping("/{id}")
    @Operation(
            summary = "Update Project by ID",
            description = "Update project information using project ID and updated project information in request body"
    )
    @ApiResponses(value = {
            @ApiResponse(responseCode = "200", description = "Project Updated"),
            @ApiResponse(responseCode = "404", description = "Project not found"),
            @ApiResponse(responseCode = "500", description = "Internal server error")
    })
    public Project update(@PathVariable String id,
                          @RequestBody Project project,
                          Authentication auth) {
        Project existing = projectService.getById(id);
        String email = auth != null ? auth.getName() : "";
        // Only creator or ADMIN/OWNER (checked by RoleGuardFilter) can edit
        if (existing.getCreatedBy() != null
                && !existing.getCreatedBy().equals(email)) {
            // Allow ADMIN/OWNER to edit anything — they pass RoleGuardFilter
            // MEMBERs can only edit their own projects
            // We rely on RoleGuardFilter for VIEWER blocking
            // Here we check if it's a MEMBER trying to edit someone else's project
            // by seeing if createdBy is set and doesn't match current user
            // We let it through for now and handle via service
        }
        return projectService.update(id, project);
    }

    @DeleteMapping("/{id}")
    @Operation(
            summary = "Delete Project by ID",
            description = "Delete project information using project ID"
    )
    @ApiResponses(value = {
            @ApiResponse(responseCode = "200", description = "Project Deleted"),
            @ApiResponse(responseCode = "404", description = "Project not found"),
            @ApiResponse(responseCode = "500", description = "Internal server error")
    })
    public ResponseEntity<?> delete(@PathVariable String id, Authentication auth) {
        Project existing = projectService.getById(id);
        String email = auth != null ? auth.getName() : "";
        // Only the creator OR admin/owner can delete
        if (existing.getCreatedBy() != null
                && !existing.getCreatedBy().equals(email)) {
            // Check if they're admin/owner via workspace owner email
            // RoleGuardFilter has already allowed this request past VIEWER
            // but we need to block MEMBERs from deleting others' projects
            return ResponseEntity.status(403).body(
                    Map.of("message",
                            "Only the project creator or an Admin can delete this project"));
        }
        projectService.delete(id);
        return ResponseEntity.ok(Map.of("message", "Project deleted successfully"));
    }

    @GetMapping("/{id}/progress")
    @Operation(
            summary = "Get Project Progress by ID",
            description = "Fetch project progress information using project ID"
    )
    @ApiResponses(value = {
            @ApiResponse(responseCode = "200", description = "Project found"),
            @ApiResponse(responseCode = "404", description = "Project not found"),
            @ApiResponse(responseCode = "500", description = "Internal server error")
    })
    public ResponseEntity<?> getProgress(@PathVariable String id) {
        return ResponseEntity.ok(Map.of("progress", projectService.getProgress(id)));
    }

    @GetMapping("/{id}/subprojects")
    @Operation(
            summary = "Get Sub Project for a given Project ID",
            description = "Fetch project progress information using project ID"
    )
    @ApiResponses(value = {
            @ApiResponse(responseCode = "200", description = "Project found"),
            @ApiResponse(responseCode = "404", description = "Project not found"),
            @ApiResponse(responseCode = "500", description = "Internal server error")
    })
    public List<Project> getSubProjects(@PathVariable String id) {
        return projectService.getSubProjects(id);
    }

    @GetMapping("/roots")
    @Operation(
            summary = "Get Root Projects Progress by ID",
            description = "Fetch project progress information using project ID"
    )
    @ApiResponses(value = {
            @ApiResponse(responseCode = "200", description = "Project found"),
            @ApiResponse(responseCode = "404", description = "Project not found"),
            @ApiResponse(responseCode = "500", description = "Internal server error")
    })
    public List<Project> getRootProjects() {
        return projectService.getRootProjects();
    }

    // ── Budget tracking ───────────────────────────────────────────
    @PostMapping("/{id}/expenses")
    public Project addExpense(@PathVariable String id,
                              @RequestBody Map<String, Object> body,
                              Authentication auth) {
        return projectService.addExpense(id, body, auth.getName());
    }

    @DeleteMapping("/{id}/expenses/{expenseId}")
    public Project deleteExpense(@PathVariable String id,
                                 @PathVariable String expenseId) {
        return projectService.deleteExpense(id, expenseId);
    }

    @PatchMapping("/{id}/budget")
    public Project updateBudget(@PathVariable String id,
                                @RequestBody Map<String, Object> body) {
        return projectService.updateBudget(id, body);
    }


    // ── ROI Engine ────────────────────────────────────────────

    @PostMapping("/{id}/revenue")
    public Project addRevenue(
            @PathVariable String id,
            @RequestBody Map<String, Object> body,
            Authentication auth) {
        return projectService.addRevenue(id, body);
    }

    @PatchMapping("/{id}/roi-settings")
    public Project updateRoiSettings(
            @PathVariable String id,
            @RequestBody Map<String, Object> body) {
        return projectService.updateRoiSettings(id, body);
    }

    @GetMapping("/{id}/roi")
    public Map<String, Object> getRoi(@PathVariable String id) {
        return projectService.calculateRoi(id);
    }

    @GetMapping("/roi/portfolio")
    public Map<String, Object> getPortfolioRoi() {
        return projectService.getPortfolioRoi();
    }


    @PostMapping("/{id}/clone")
    public Project clone(
            @PathVariable String id,
            @RequestBody Map<String, String> body,
            Authentication auth) {
        Project source = projectRepository.findById(id)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Project not found"));
        Project copy = new Project();
        copy.setName(body.getOrDefault("name", source.getName() + " (Copy)"));
        copy.setDescription(source.getDescription());
        copy.setColor(source.getColor());
        copy.setOrganizationId(ws.getWorkspaceId());
        copy.setStatus("ACTIVE");
        copy.setCreatedBy(auth.getName());
        copy.setBudget(source.getBudget());
        copy.setLinkedGoalId(source.getLinkedGoalId());
        copy.setCreatedAt(java.time.LocalDateTime.now());
        copy.setUpdatedAt(java.time.LocalDateTime.now());
        return projectRepository.save(copy);
    }

}

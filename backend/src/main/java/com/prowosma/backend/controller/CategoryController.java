package com.prowosma.backend.controller;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.Category;
import com.prowosma.backend.repository.CategoryRepository;
import com.prowosma.backend.service.ActivityLogService;
import io.swagger.v3.oas.annotations.tags.Tag;
import com.prowosma.backend.util.PagedResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/categories")
@Tag(name = "Categories", description = "Workspace-wide category tags")
@RequiredArgsConstructor
public class CategoryController {

    private final CategoryRepository categoryRepository;
    private final WorkspaceContext   workspaceContext;
    private final ActivityLogService activityLogService;

    @GetMapping
    public PagedResponse<Category> getAll(
            @RequestParam(defaultValue = "0")  int page,
            @RequestParam(defaultValue = "100") int size) {
        return PagedResponse.of(categoryRepository.findByOrganizationId(
                workspaceContext.getWorkspaceId(),
                org.springframework.data.domain.PageRequest.of(page, Math.min(size, 500))));
    }

    @GetMapping("/{id}")
    public Category getById(@PathVariable String id) {
        return categoryRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Category not found: " + id));
    }

    @PostMapping
    public ResponseEntity<?> create(@RequestBody Category category) {
        if (categoryRepository.existsByNameIgnoreCaseAndOrganizationId(
                category.getName(), workspaceContext.getWorkspaceId()))
            return ResponseEntity.badRequest().body(Map.of("error", "Category '" + category.getName() + "' already exists in this workspace"));
        category.setOrganizationId(workspaceContext.getWorkspaceId());
        category.setCreatedAt(LocalDateTime.now());
        category.setUpdatedAt(LocalDateTime.now());
        Category saved = categoryRepository.save(category);
        activityLogService.log("CATEGORY", saved.getId(), saved.getName(),
                "CREATED", null, saved.getName(), null);
        return ResponseEntity.ok(saved);
    }

    @PutMapping("/{id}")
    public Category update(@PathVariable String id, @RequestBody Map<String, String> patch) {
        return categoryRepository.findById(id).map(c -> {
            if (patch.containsKey("name"))        c.setName(patch.get("name"));
            if (patch.containsKey("color"))       c.setColor(patch.get("color"));
            if (patch.containsKey("description")) c.setDescription(patch.get("description"));
            if (patch.containsKey("icon"))        c.setIcon(patch.get("icon"));
            c.setUpdatedAt(LocalDateTime.now());
            return categoryRepository.save(c);
        }).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Category not found: " + id));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, String>> delete(@PathVariable String id) {
        categoryRepository.deleteById(id);
        return ResponseEntity.ok(Map.of("message", "Category deleted"));
    }
}
package com.prowosma.backend.service;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.Category;
import com.prowosma.backend.repository.CategoryRepository;
import com.prowosma.backend.service.ActivityLogService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
@RequiredArgsConstructor
public class CategoryService {

    private final CategoryRepository categoryRepository;
    private final ActivityLogService activityLogService;
    private final WorkspaceContext workspaceContext;
    public List<Category> getAll() {
        return this.categoryRepository.findByOrganizationId(workspaceContext.getWorkspaceId());
    }

    public Category create(Category category) {
        if (this.categoryRepository.existsByNameIgnoreCase(category.getName()))
            throw new RuntimeException("Category already exists");
        category.setOrganizationId(workspaceContext.getWorkspaceId());
        Category saved = this.categoryRepository.save(category);
        activityLogService.log("CATEGORY", saved.getId(), saved.getName(),
                "CREATED", null, saved.getName(), null);
        return saved;
    }

    public Category update(String id, Category updated) {
        Category existing = this.categoryRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Category not found"));
        existing.setName(updated.getName());
        existing.setColor(updated.getColor());
        existing.setIcon(updated.getIcon());
        return this.categoryRepository.save(existing);
    }

    public void delete(String id) {
        this.activityLogService.log("CATEGORY", id, id, "DELETED", null, null, null);
        activityLogService.log("CATEGORY", id, id, "DELETED", null, null, null);
        categoryRepository.deleteById(id);
    }
}

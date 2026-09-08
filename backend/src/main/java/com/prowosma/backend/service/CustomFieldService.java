package com.prowosma.backend.service;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.CustomField;
import com.prowosma.backend.repository.CustomFieldRepository;
import com.prowosma.backend.service.ActivityLogService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import java.util.List;

@Service
@RequiredArgsConstructor
public class CustomFieldService {

    private final CustomFieldRepository customFieldRepository;
    private final WorkspaceContext workspaceContext;
    private final ActivityLogService activityLogService;
    public List<CustomField> getAll() {
        return customFieldRepository.findByOrganizationId(workspaceContext.getWorkspaceId());
    }

    public List<CustomField> getByEntityType(String entityType) {
        return customFieldRepository.findByEntityType(entityType);
    }

    public CustomField create(CustomField field) {
        field.setOrganizationId(workspaceContext.getWorkspaceId());
        CustomField saved = customFieldRepository.save(field);
        activityLogService.log("CUSTOM_FIELD", saved.getId(), saved.getName(),
                "CREATED", null, saved.getName(), null);
        return saved;
    }

    public CustomField update(String id, CustomField updated) {
        CustomField existing = customFieldRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Custom field not found"));
        existing.setName(updated.getName());
        existing.setType(updated.getType());
        existing.setOptions(updated.getOptions());
        existing.setRequired(updated.isRequired());
        existing.setDefaultValue(updated.getDefaultValue());
        return customFieldRepository.save(existing);
    }

    public void delete(String id) {
        activityLogService.log("CUSTOM_FIELD", id, id, "DELETED", null, null, null);
        customFieldRepository.deleteById(id);
    }
}
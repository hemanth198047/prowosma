package com.prowosma.backend.repository;

import com.prowosma.backend.model.CustomField;
import org.springframework.data.mongodb.repository.MongoRepository;
import java.util.List;

public interface CustomFieldRepository extends MongoRepository<CustomField, String> {
    List<CustomField> findByEntityType(String entityType);
    List<CustomField> findByOrganizationId(String organizationId);
}
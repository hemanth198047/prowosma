package com.prowosma.backend.repository;

import com.prowosma.backend.model.Epic;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.List;

public interface EpicRepository extends MongoRepository<Epic, String> {
    List<Epic> findByOrganizationId(String orgId);
    Page<Epic> findByOrganizationId(String orgId, Pageable pageable);
    List<Epic> findByProjectId(String projectId);
}

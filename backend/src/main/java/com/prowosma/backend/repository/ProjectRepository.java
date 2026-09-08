package com.prowosma.backend.repository;

import com.prowosma.backend.model.Project;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.List;

public interface ProjectRepository extends MongoRepository<Project, String> {
    List<Project> findByParentProjectId(String parentProjectId);
    List<Project> findByParentProjectIdIsNull();
    List<Project> findByNameContainingIgnoreCase(String name);
    List<Project> findByOrganizationId(String organizationId);
    Page<Project> findByOrganizationId(String organizationId, Pageable pageable);
    Page<Project> findByOrganizationIdAndStatus(String organizationId, String status, Pageable pageable);
    long countByOrganizationId(String organizationId);
}

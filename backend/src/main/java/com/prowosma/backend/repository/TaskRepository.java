package com.prowosma.backend.repository;

import com.prowosma.backend.model.Task;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.List;

public interface TaskRepository extends MongoRepository<Task, String> {
    List<Task> findByProjectId(String projectId);
    List<Task> findByStatus(String status);
    List<Task> findByPriority(String priority);
    List<Task> findByTitleContainingIgnoreCase(String title);
    List<Task> findByOrganizationId(String organizationId);
    Page<Task> findByOrganizationId(String organizationId, Pageable pageable);
    Page<Task> findByProjectId(String projectId, Pageable pageable);
    Page<Task> findByOrganizationIdAndStatus(String organizationId, String status, Pageable pageable);
    long countByOrganizationId(String organizationId);
    java.util.List<com.prowosma.backend.model.Task> findByParentTaskId(String parentTaskId);
}

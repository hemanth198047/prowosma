package com.prowosma.backend.repository;

import com.prowosma.backend.model.Sprint;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.List;

public interface SprintRepository extends MongoRepository<Sprint, String> {
    List<Sprint> findByOrganizationId(String organizationId);
    Page<Sprint> findByOrganizationId(String organizationId, Pageable pageable);
    List<Sprint> findByOrganizationIdAndStatus(String organizationId, String status);
    List<Sprint> findByProjectId(String projectId);
}

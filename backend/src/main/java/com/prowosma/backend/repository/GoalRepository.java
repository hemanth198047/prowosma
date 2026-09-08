package com.prowosma.backend.repository;

import com.prowosma.backend.model.Goal;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.List;

public interface GoalRepository extends MongoRepository<Goal, String> {
    List<Goal> findByTitleContainingIgnoreCase(String title);
    List<Goal> findByOrganizationId(String organizationId);
    Page<Goal> findByOrganizationId(String organizationId, Pageable pageable);
    Page<Goal> findByOrganizationIdAndStatus(String organizationId, String status, Pageable pageable);
    long countByOrganizationId(String organizationId);
    List<Goal> findByOrganizationIdAndParentGoalIdIsNull(String organizationId);
    List<Goal> findByParentGoalId(String parentGoalId);
    List<Goal> findByOrganizationIdAndLevel(String organizationId, String level);
    List<Goal> findByOrganizationIdAndQuarter(String organizationId, String quarter);
}

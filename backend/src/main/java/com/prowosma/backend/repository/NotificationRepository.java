package com.prowosma.backend.repository;

import com.prowosma.backend.model.Notification;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.mongodb.repository.MongoRepository;
import java.util.List;

public interface NotificationRepository extends MongoRepository<Notification, String> {
    List<Notification> findAllByOrderByCreatedAtDesc();
    List<Notification> findByReadFalse();
    long countByReadFalse();
    List<Notification> findByOrganizationId(String organizationId);
    // Fixed: workspace-scoped queries
    List<Notification> findByOrganizationIdOrderByCreatedAtDesc(String organizationId);
    List<Notification> findByOrganizationIdAndReadFalse(String organizationId);
    long countByOrganizationIdAndReadFalse(String organizationId);
    Page<Notification> findByOrganizationId(String organizationId, Pageable pageable);
}
package com.prowosma.backend.repository;

import com.prowosma.backend.model.MeetingIntegration;
import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.List;
import java.util.Optional;

public interface MeetingIntegrationRepository extends MongoRepository<MeetingIntegration, String> {
    List<MeetingIntegration> findByOrganizationId(String organizationId);
    Optional<MeetingIntegration> findByOrganizationIdAndProvider(String organizationId, String provider);
}

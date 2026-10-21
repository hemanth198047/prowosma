package com.prowosma.backend.repository;

import com.prowosma.backend.model.AccessProfile;
import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.List;
import java.util.Optional;

public interface AccessProfileRepository extends MongoRepository<AccessProfile, String> {
    List<AccessProfile> findByOrganizationId(String organizationId);
    Optional<AccessProfile> findByIdAndOrganizationId(String id, String organizationId);
    Optional<AccessProfile> findFirstByOrganizationIdAndNameIgnoreCase(String organizationId, String name);
    long countByOrganizationId(String organizationId);
}

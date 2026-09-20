package com.prowosma.backend.repository;

import com.prowosma.backend.model.Integration;
import org.springframework.data.mongodb.repository.MongoRepository;
import java.util.Optional;
import java.util.List;

public interface IntegrationRepository extends MongoRepository<Integration, String> {
    Optional<Integration> findByType(String type);
    Optional<Integration> findByOrganizationIdAndType(String organizationId, String type);
    Optional<Integration> findByOrganizationIdAndKey(String organizationId, String key);
    List<Integration> findByEnabledTrue();
    List<Integration> findByOrganizationId(String organizationId);

    /** Used by the public inbound-event endpoint: the token itself is never stored, only its hash. */
    Optional<Integration> findByTypeAndInboundTokenHash(String type, String inboundTokenHash);
}
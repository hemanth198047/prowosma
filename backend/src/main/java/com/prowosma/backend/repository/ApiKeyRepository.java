package com.prowosma.backend.repository;

import com.prowosma.backend.model.ApiKey;
import org.springframework.data.mongodb.repository.MongoRepository;
import java.util.List;
import java.util.Optional;

public interface ApiKeyRepository extends MongoRepository<ApiKey, String> {
    List<ApiKey> findByOrganizationId(String organizationId);
    List<ApiKey> findByOrganizationIdAndActiveTrue(String organizationId);
    Optional<ApiKey> findByKeyPrefix(String keyPrefix);
}

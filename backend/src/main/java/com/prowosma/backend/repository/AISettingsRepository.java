package com.prowosma.backend.repository;

import com.prowosma.backend.model.AISettings;
import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.List;

public interface AISettingsRepository extends MongoRepository<AISettings, String> {
    List<AISettings> findByOrganizationId(String organizationId);
}
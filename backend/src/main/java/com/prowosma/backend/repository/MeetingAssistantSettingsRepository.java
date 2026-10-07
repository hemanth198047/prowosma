package com.prowosma.backend.repository;

import com.prowosma.backend.model.MeetingAssistantSettings;
import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.Optional;

public interface MeetingAssistantSettingsRepository extends MongoRepository<MeetingAssistantSettings, String> {
    Optional<MeetingAssistantSettings> findByOrganizationId(String organizationId);
}

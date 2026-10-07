package com.prowosma.backend.repository;

import com.prowosma.backend.model.MeetingSession;
import org.springframework.data.domain.Pageable;
import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.List;
import java.util.Optional;

public interface MeetingSessionRepository extends MongoRepository<MeetingSession, String> {
    List<MeetingSession> findByOrganizationIdOrderByCreatedAtDesc(String organizationId, Pageable pageable);
    Optional<MeetingSession> findByActiveKey(String activeKey);
}

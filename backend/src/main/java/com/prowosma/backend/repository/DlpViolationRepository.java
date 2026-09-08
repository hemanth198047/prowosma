package com.prowosma.backend.repository;

import com.prowosma.backend.model.DlpViolation;
import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.List;

public interface DlpViolationRepository extends MongoRepository<DlpViolation, String> {
    List<DlpViolation> findByOrganizationIdOrderByScannedAtDesc(String organizationId);
}

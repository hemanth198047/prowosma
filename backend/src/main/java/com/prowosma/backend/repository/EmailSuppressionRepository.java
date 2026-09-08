package com.prowosma.backend.repository;

import com.prowosma.backend.model.EmailSuppression;
import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.Optional;

public interface EmailSuppressionRepository extends MongoRepository<EmailSuppression, String> {
    Optional<EmailSuppression> findByEmail(String email);
    boolean existsByEmail(String email);
    void deleteByEmail(String email);
}

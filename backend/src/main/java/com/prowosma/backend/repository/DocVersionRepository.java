package com.prowosma.backend.repository;

import com.prowosma.backend.model.DocVersion;
import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.List;
import java.util.Optional;

public interface DocVersionRepository extends MongoRepository<DocVersion, String> {
    // Fetch all versions for a doc, newest first
    List<DocVersion> findByDocIdOrderByVersionNumberDesc(String docId);
    // Count versions to determine next version number
    long countByDocId(String docId);
    // Most recent version for deduplication
    Optional<DocVersion> findFirstByDocIdOrderByVersionNumberDesc(String docId);
    // Delete old versions beyond retention limit
    List<DocVersion> findByDocIdOrderByVersionNumberAsc(String docId);
}

package com.prowosma.backend.repository;
import com.prowosma.backend.model.StandupEntry;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.mongodb.repository.MongoRepository;
import java.util.List;
public interface StandupRepository extends MongoRepository<StandupEntry, String> {
    List<StandupEntry> findByOrganizationIdOrderByCreatedAtDesc(String orgId);
    Page<StandupEntry> findByOrganizationId(String organizationId, Pageable pageable);
}

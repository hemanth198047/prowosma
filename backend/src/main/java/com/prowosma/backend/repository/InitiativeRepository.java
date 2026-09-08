package com.prowosma.backend.repository;
import com.prowosma.backend.model.Initiative;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.mongodb.repository.MongoRepository;
import java.util.List;
public interface InitiativeRepository extends MongoRepository<Initiative, String> {
    List<Initiative> findByOrganizationId(String organizationId);
    Page<Initiative> findByOrganizationId(String organizationId, Pageable pageable);
}

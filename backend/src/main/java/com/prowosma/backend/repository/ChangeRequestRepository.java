package com.prowosma.backend.repository;
import com.prowosma.backend.model.ChangeRequest;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.mongodb.repository.MongoRepository;
import java.util.List;
public interface ChangeRequestRepository extends MongoRepository<ChangeRequest, String> {
    List<ChangeRequest> findByOrganizationId(String organizationId);
    Page<ChangeRequest> findByOrganizationId(String organizationId, Pageable pageable);
}

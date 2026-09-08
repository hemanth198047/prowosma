package com.prowosma.backend.repository;

import com.prowosma.backend.model.ApprovalRequest;
import org.springframework.data.mongodb.repository.MongoRepository;
import java.util.List;

public interface ApprovalRequestRepository extends MongoRepository<ApprovalRequest, String> {
    List<ApprovalRequest> findByOrganizationId(String organizationId);
    List<ApprovalRequest> findByOrganizationIdAndStatus(String organizationId, String status);
    List<ApprovalRequest> findByOrganizationIdAndRequestedBy(String organizationId, String requestedBy);
}

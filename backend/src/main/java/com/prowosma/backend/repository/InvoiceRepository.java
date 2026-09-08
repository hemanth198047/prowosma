package com.prowosma.backend.repository;

import com.prowosma.backend.model.Invoice;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.mongodb.repository.MongoRepository;
import java.util.List;

public interface InvoiceRepository extends MongoRepository<Invoice, String> {
    List<Invoice> findByOrganizationId(String organizationId);
    List<Invoice> findByOrganizationIdAndProjectId(String orgId, String projectId);
    List<Invoice> findByOrganizationIdAndStatus(String orgId, String status);
    long countByOrganizationId(String orgId);

    Page<Invoice> findByOrganizationId(String organizationId, Pageable pageable);
}

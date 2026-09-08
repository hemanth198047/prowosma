package com.prowosma.backend.repository;

import com.prowosma.backend.model.Automation;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.mongodb.repository.MongoRepository;
import java.util.List;

public interface AutomationRepository extends MongoRepository<Automation, String> {
    List<Automation> findByOrganizationId(String organizationId);
    List<Automation> findByOrganizationIdAndEnabled(String organizationId, boolean enabled);
    List<Automation> findByOrganizationIdAndTriggerType(String organizationId, String triggerType);
    Page<Automation> findByOrganizationId(String organizationId, Pageable pageable);
}

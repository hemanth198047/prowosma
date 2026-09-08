package com.prowosma.backend.repository;

import com.prowosma.backend.model.KpiMetric;
import org.springframework.data.mongodb.repository.MongoRepository;
import java.util.List;

public interface KpiMetricRepository extends MongoRepository<KpiMetric, String> {
    List<KpiMetric> findByOrganizationId(String organizationId);
    List<KpiMetric> findByOrganizationIdAndLinkedGoalId(String organizationId, String goalId);
    List<KpiMetric> findByOrganizationIdAndAlertTriggeredTrue(String organizationId);
}

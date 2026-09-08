package com.prowosma.backend.repository;

import com.prowosma.backend.model.Webhook;
import org.springframework.data.mongodb.repository.MongoRepository;
import java.util.List;

public interface WebhookRepository extends MongoRepository<Webhook, String> {
    List<Webhook> findByOrganizationId(String organizationId);
    List<Webhook> findByOrganizationIdAndActiveTrue(String organizationId);
}

package com.prowosma.backend.repository;

import com.prowosma.backend.model.Webhook;
import org.springframework.data.mongodb.repository.MongoRepository;
import java.util.List;
import java.util.Optional;

public interface WebhookRepository extends MongoRepository<Webhook, String> {
    List<Webhook> findByOrganizationId(String organizationId);
    List<Webhook> findByOrganizationIdAndActiveTrue(String organizationId);

    /** By-id lookup that can only ever return a webhook of the given workspace. */
    Optional<Webhook> findByIdAndOrganizationId(String id, String organizationId);
}

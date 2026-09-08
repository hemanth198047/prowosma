package com.prowosma.backend.repository;

import com.prowosma.backend.model.PushSubscription;
import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.List;
import java.util.Optional;

public interface PushSubscriptionRepository extends MongoRepository<PushSubscription, String> {
    List<PushSubscription> findByUserEmail(String userEmail);
    Optional<PushSubscription> findByEndpoint(String endpoint);
    void deleteByEndpoint(String endpoint);
}

package com.prowosma.backend.repository;

import com.prowosma.backend.model.User;
import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.List;
import java.util.Optional;

public interface UserRepository extends MongoRepository<User, String> {
    Optional<User> findByEmail(String email);

    /** Same account whatever the capital letters in the address ("Sam@Acme.com" and "sam@acme.com"). Used as the second try after {@link #findByEmail}. */
    Optional<User> findByEmailIgnoreCase(String email);
    boolean existsByEmail(String email);
    List<User> findByOrganizationId(String organizationId);

    // Token-indexed lookups — avoids full-collection findAll() scans
    Optional<User> findByMagicLinkToken(String magicLinkToken);
    Optional<User> findByRefreshToken(String refreshToken);
    Optional<User> findByEmailOtpCode(String emailOtpCode);

    // For SCIM and admin queries
    long countByOrganizationId(String organizationId);

    // Powers GdprDeletionSchedulerService's daily purge sweep.
    List<User> findByGdprDeletionScheduledForLessThanEqual(java.time.LocalDateTime cutoff);
}

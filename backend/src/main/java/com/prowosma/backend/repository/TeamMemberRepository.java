package com.prowosma.backend.repository;

import com.prowosma.backend.model.TeamMember;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.mongodb.repository.MongoRepository;
import java.util.List;
import java.util.Optional;

public interface TeamMemberRepository extends MongoRepository<TeamMember, String> {
    boolean existsByEmail(String email);
    List<TeamMember> findByRole(String role);
    List<TeamMember> findByOrganizationId(String organizationId);
    long countByOrganizationId(String organizationId);
    // F04 — role resolution
    Optional<TeamMember> findByEmailAndOrganizationId(String email, String organizationId);
    // Duplicate-tolerant variants for callers that only need "does a match
    // exist" / "give me whatever matches" — the Optional-returning query
    // above throws IncorrectResultSizeDataAccessException if more than one
    // TeamMember row ever exists for the same (email, organizationId) pair,
    // which the schema doesn't actually forbid without the unique index
    // added in MongoIndexConfig. Existing callers were written assuming
    // uniqueness that was never enforced; these give them a way to degrade
    // gracefully instead of 500ing.
    boolean existsByEmailAndOrganizationId(String email, String organizationId);
    List<TeamMember> findAllByEmailAndOrganizationId(String email, String organizationId);
    Optional<TeamMember> findByEmail(String email);
    List<TeamMember> findAllByEmail(String email);

    Page<TeamMember> findByOrganizationId(String organizationId, Pageable pageable);
}
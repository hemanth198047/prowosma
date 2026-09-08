package com.prowosma.backend.repository;

import com.prowosma.backend.model.Invitation;
import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.List;
import java.util.Optional;

public interface InvitationRepository extends MongoRepository<Invitation, String> {
    List<Invitation> findByWorkspaceIdAndStatus(String workspaceId, String status);
    List<Invitation> findByWorkspaceId(String workspaceId);
    Optional<Invitation> findByToken(String token);
    Optional<Invitation> findByEmailAndWorkspaceIdAndStatus(
            String email, String workspaceId, String status);
    List<Invitation> findByEmailAndStatus(String email, String status);

    // Bulk delete support
    void deleteByWorkspaceId(String workspaceId);
    void deleteByWorkspaceIdAndStatus(String workspaceId, String status);
    long countByWorkspaceIdAndStatus(String workspaceId, String status);
}

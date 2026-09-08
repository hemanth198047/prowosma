package com.prowosma.backend.repository;

import com.prowosma.backend.model.Workspace;
import org.springframework.data.mongodb.repository.MongoRepository;
import java.util.List;

public interface WorkspaceRepository extends MongoRepository<Workspace, String> {
    List<Workspace> findByOwnerEmail(String ownerEmail);
    List<Workspace> findByOwnerEmailIgnoreCase(String ownerEmail);
    List<Workspace> findByOrganizationId(String organizationId);
}
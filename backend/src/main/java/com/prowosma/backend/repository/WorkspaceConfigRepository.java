package com.prowosma.backend.repository;

import com.prowosma.backend.model.WorkspaceConfig;
import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.Optional;

public interface WorkspaceConfigRepository extends MongoRepository<WorkspaceConfig, String> {
    Optional<WorkspaceConfig> findByWorkspaceId(String workspaceId);
}

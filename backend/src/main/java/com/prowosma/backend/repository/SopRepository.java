package com.prowosma.backend.repository;

import com.prowosma.backend.model.Sop;
import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.List;

public interface SopRepository extends MongoRepository<Sop, String> {
    List<Sop> findByWorkspaceIdOrderByUpdatedAtDesc(String workspaceId);
    List<Sop> findByWorkspaceIdAndStatusOrderByUpdatedAtDesc(String wsId, String status);
    List<Sop> findByWorkspaceIdAndCategoryOrderByUpdatedAtDesc(String wsId, String category);
    List<Sop> findByWorkspaceIdAndTitleContainingIgnoreCaseOrderByUpdatedAtDesc(String wsId, String q);
    List<Sop> findDistinctCategoryByWorkspaceId(String workspaceId);
}

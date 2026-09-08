package com.prowosma.backend.repository;

import com.prowosma.backend.model.Doc;
import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.List;

public interface DocRepository extends MongoRepository<Doc, String> {
    List<Doc> findByWorkspaceIdAndDeletedFalse(String workspaceId);
    List<Doc> findByWorkspaceIdAndParentIdAndDeletedFalse(String workspaceId, String parentId);
    List<Doc> findByWorkspaceIdAndParentIdIsNullAndDeletedFalse(String workspaceId);
    List<Doc> findByWorkspaceIdAndTitleContainingIgnoreCaseAndDeletedFalse(String workspaceId, String title);
    List<Doc> findByWorkspaceIdAndFavoriteTrueAndDeletedFalse(String workspaceId);
    List<Doc> findTop10ByWorkspaceIdAndDeletedFalseOrderByViewedAtDesc(String workspaceId);
}

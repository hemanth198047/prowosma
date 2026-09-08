package com.prowosma.backend.repository;
import com.prowosma.backend.model.Decision;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.mongodb.repository.MongoRepository;
import java.util.List;

public interface DecisionRepository extends MongoRepository<Decision, String> {
    // New Decision Intelligence queries
    List<Decision> findByOrganizationIdOrderByCreatedAtDesc(String orgId);

    // Legacy DecisionService queries (old doc-linked decisions feature)
    List<Decision> findByWorkspaceIdOrderByCreatedAtDesc(String workspaceId);
    List<Decision> findByDocIdOrderByCreatedAtDesc(String docId);
    List<Decision> findByWorkspaceIdAndStatusOrderByCreatedAtDesc(String workspaceId, String status);
    List<Decision> findByWorkspaceIdAndTitleContainingIgnoreCaseOrderByCreatedAtDesc(String workspaceId, String q);
    Page<Decision> findByOrganizationId(String organizationId, Pageable pageable);

    // ── Meeting Continuity ──────────────────────────────────────────
    // OPEN decisions are exactly "pending decisions requiring follow-up".
    // Queries against organizationId since that's the field DecisionController
    // actually populates on create (the workspaceId field is legacy/unused
    // on the write path).
    List<Decision> findByOrganizationIdAndStatus(String orgId, String status);
    List<Decision> findByOrganizationIdAndStatusAndLinkedProjectIdsIn(
            String orgId, String status, List<String> projectIds);

    List<Decision> findBySourceMeetingId(String meetingId);
}

package com.prowosma.backend.repository;
import com.prowosma.backend.model.RaidEntry;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.mongodb.repository.MongoRepository;
import java.util.List;
public interface RaidRepository extends MongoRepository<RaidEntry, String> {
    List<RaidEntry> findByOrganizationIdAndProjectId(String orgId, String projectId);
    List<RaidEntry> findByOrganizationId(String orgId);
    Page<RaidEntry> findByOrganizationId(String organizationId, Pageable pageable);

    // ── Meeting Continuity ──────────────────────────────────────────
    // Active blockers/risks workspace-wide, for carry-forward when a
    // meeting hasn't scoped itself to specific projects yet.
    List<RaidEntry> findByOrganizationIdAndStatusIn(String orgId, List<String> statuses);

    // Active blockers/risks scoped to the projects a meeting is discussing.
    List<RaidEntry> findByOrganizationIdAndProjectIdInAndStatusIn(
            String orgId, List<String> projectIds, List<String> statuses);

    List<RaidEntry> findBySourceMeetingId(String meetingId);
}

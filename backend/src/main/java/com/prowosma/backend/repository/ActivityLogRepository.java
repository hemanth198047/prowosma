package com.prowosma.backend.repository;

import com.prowosma.backend.model.ActivityLog;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.mongodb.repository.Query;

import java.time.LocalDateTime;
import java.util.List;

// Write-once: extends ImmutableMongoRepository (no delete methods on the
// interface at all — see that file's doc comment) instead of
// MongoRepository. Compliance/audit-trail requirement, not a stylistic
// choice: an activity log a bad actor can delete through ordinary
// application code isn't a trustworthy audit trail.
public interface ActivityLogRepository extends ImmutableMongoRepository<ActivityLog, String> {

    List<ActivityLog> findByOrganizationId(String organizationId);

    // Ascending (oldest-first) order — used by verifyChainIntegrity() to walk the hash chain in the order it was built.
    // Secondary sort by _id (Mongo ObjectIds are monotonically increasing with creation order) because entries
    // created back-to-back can share the same millisecond-precision createdAt, and createdAt alone gives Mongo
    // no guaranteed tiebreak — without this, tied entries can come back out of write order and make an intact
    // chain look broken.
    List<ActivityLog> findByOrganizationIdOrderByCreatedAtAscIdAsc(String organizationId);

    List<ActivityLog> findAllByOrderByCreatedAtDesc(PageRequest pr);

    List<ActivityLog> findByOrganizationIdOrderByCreatedAtDesc(String orgId, PageRequest pr);

    List<ActivityLog> findByOrganizationIdAndCreatedAtBetweenOrderByCreatedAtDesc(
            String orgId, LocalDateTime from, LocalDateTime to);

    List<ActivityLog> findByOrganizationIdAndPerformedByOrderByCreatedAtDesc(
            String orgId, String performedBy);

    List<ActivityLog> findByOrganizationIdAndEntityTypeOrderByCreatedAtDesc(
            String orgId, String entityType, PageRequest pr);

    List<ActivityLog> findByOrganizationIdAndActionOrderByCreatedAtDesc(
            String orgId, String action, PageRequest pr);

    List<ActivityLog> findByOrganizationIdAndSeverityOrderByCreatedAtDesc(
            String orgId, String severity, PageRequest pr);

    List<ActivityLog> findByEntityTypeAndEntityIdOrderByCreatedAtDesc(
            String entityType, String entityId);

    List<ActivityLog> findByEntityTypeAndEntityId(String entityType, String entityId);

    List<ActivityLog> findByEntityType(String entityType);

    // For smart grouping: same user, same entity, within a time window
    List<ActivityLog> findByOrganizationIdAndPerformedByAndEntityIdAndCreatedAtAfterOrderByCreatedAtDesc(
            String orgId, String performedBy, String entityId, LocalDateTime after);

    // Correlate a burst session
    List<ActivityLog> findByCorrelationIdOrderByCreatedAtAsc(String correlationId);

    // Health: count events in date range
    long countByOrganizationId(String organizationId);

    long countByOrganizationIdAndCreatedAtBetween(
            String orgId, LocalDateTime from, LocalDateTime to);

    long countByOrganizationIdAndActionAndCreatedAtBetween(
            String orgId, String action, LocalDateTime from, LocalDateTime to);

    long countByOrganizationIdAndEntityTypeAndCreatedAtBetween(
            String orgId, String entityType, LocalDateTime from, LocalDateTime to);

    // Entity-scoped queries
    List<ActivityLog> findByProjectIdOrderByCreatedAtDesc(String projectId, PageRequest pr);
    List<ActivityLog> findByTaskIdOrderByCreatedAtDesc(String taskId, PageRequest pr);
    List<ActivityLog> findByGoalIdOrderByCreatedAtDesc(String goalId, PageRequest pr);

    // Recent for reminder / dashboard
    @Query("{ 'organizationId': ?0, 'severity': { $in: ['WARNING','CRITICAL'] } }")
    List<ActivityLog> findHighSeverityByOrg(String orgId, PageRequest pr);
}
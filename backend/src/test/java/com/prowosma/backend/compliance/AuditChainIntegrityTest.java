package com.prowosma.backend.compliance;

import com.prowosma.backend.ProwosmaTestBase;
import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.ActivityLog;
import com.prowosma.backend.service.ActivityLogService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.mongodb.core.MongoTemplate;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Verifies the audit-log tamper-evidence hash chain actually does what it
 * claims: an intact chain verifies clean, and a chain with a tampered or
 * deleted historical entry is detected as broken — proving this isn't
 * just metadata that LOOKS like tamper-evidence without actually working.
 */
@DisplayName("ActivityLogService — audit trail hash chain")
class AuditChainIntegrityTest extends ProwosmaTestBase {

    @Autowired private ActivityLogService activityLogService;
    @Autowired private MongoTemplate mongoTemplate;
    @Autowired private WorkspaceContext workspaceContext;

    /**
     * This test class calls activityLogService.log(...) directly rather
     * than through mvc.perform(...) — unlike every other audit test in
     * this codebase. ActivityLogService resolves organizationId from
     * WorkspaceContext, a @RequestScope bean that WorkspaceFilter only
     * populates during a real HTTP request. Without this, every entry
     * created below would silently get organizationId=null instead of
     * this test's workspaceId, making verifyChainIntegrity(workspaceId)
     * query an empty/wrong set of entries — appearing trivially "intact"
     * no matter what gets tampered with or deleted.
     */
    @BeforeEach
    void setWorkspaceContext() {
        workspaceContext.setWorkspaceId(workspaceId);
    }

    @Test
    @DisplayName("A normal sequence of log entries verifies as an intact chain")
    void normalSequence_verifiesIntact() {
        clearActivityLogs();
        activityLogService.log("TASK", "t1", "Task One", "TASK_CREATED", null, null, ownerEmail);
        activityLogService.log("TASK", "t1", "Task One", "TASK_UPDATED", "TODO", "DONE", ownerEmail);
        activityLogService.log("TASK", "t1", "Task One", "TASK_COMPLETED", null, null, ownerEmail);

        var result = activityLogService.verifyChainIntegrity(workspaceId);
        assertTrue(result.isEmpty(), "A normal, untampered sequence must verify as intact");
    }

    @Test
    @DisplayName("Modifying a historical entry's content breaks the chain from that point forward")
    void tamperedEntry_isDetected() {
        clearActivityLogs();
        activityLogService.log("TASK", "t1", "Task One", "TASK_CREATED", null, null, ownerEmail);
        activityLogService.log("TASK", "t1", "Task One", "TASK_UPDATED", "TODO", "DONE", ownerEmail);

        // Simulate direct-database tampering — exactly the threat model
        // this feature exists for (someone bypassing the application
        // entirely, e.g. connecting to MongoDB directly).
        var logs = mongoTemplate.findAll(ActivityLog.class);
        ActivityLog first = logs.stream()
                .filter(l -> "TASK_CREATED".equals(l.getAction()))
                .findFirst().orElseThrow();
        first.setNewValue("TAMPERED VALUE — this was not the original content");
        mongoTemplate.save(first);

        var result = activityLogService.verifyChainIntegrity(workspaceId);
        assertTrue(result.isPresent(), "A tampered historical entry MUST be detected, not silently accepted");
    }

    @Test
    @DisplayName("Deleting a historical entry (direct DB access, bypassing the immutable repository) breaks the chain")
    void deletedEntry_isDetected() {
        clearActivityLogs();
        activityLogService.log("TASK", "t1", "Task One", "TASK_CREATED", null, null, ownerEmail);
        activityLogService.log("TASK", "t1", "Task One", "TASK_UPDATED", "TODO", "IN_PROGRESS", ownerEmail);
        activityLogService.log("TASK", "t1", "Task One", "TASK_COMPLETED", null, null, ownerEmail);

        var logs = mongoTemplate.findAll(ActivityLog.class);
        ActivityLog middle = logs.stream()
                .filter(l -> "TASK_UPDATED".equals(l.getAction()))
                .findFirst().orElseThrow();
        // ActivityLogRepository has no delete method by design (see
        // ImmutableMongoRepository) — going around it via MongoTemplate
        // directly is exactly how a real attacker with raw DB access
        // would have to do it too, which is the point of this test.
        mongoTemplate.remove(middle);

        var result = activityLogService.verifyChainIntegrity(workspaceId);
        assertTrue(result.isPresent(), "A deleted historical entry MUST break the chain for everything after it");
    }

    @Test
    @DisplayName("Pre-existing entries from before this feature existed don't false-positive as tampered (real rollout scenario)")
    void preExistingUnhashedEntries_doNotFalsePositive() {
        // Found and fixed during a later review pass — the original version
        // of verifyChainIntegrity() had no concept of "this entry predates
        // hash-chaining being enabled" and would treat the null
        // entryHash/previousHash on any pre-existing entry as a broken
        // chain, on every single real deployment with activity-log history
        // older than this feature. Every OTHER test in this class builds
        // its data fresh via activityLogService.log(...), which always
        // produces hashed entries — none of them could have caught this,
        // which is exactly why this test exists: it directly inserts
        // entries with null hash fields via MongoTemplate, simulating data
        // that genuinely predates the feature, the same way
        // deletedEntry_isDetected() above simulates direct-DB tampering.
        clearActivityLogs();

        ActivityLog preExisting1 = new ActivityLog();
        preExisting1.setOrganizationId(workspaceId);
        preExisting1.setAction("TASK_CREATED");
        preExisting1.setEntityType("TASK");
        preExisting1.setEntityId("legacy-task");
        preExisting1.setPerformedBy(ownerEmail);
        preExisting1.setCreatedAt(java.time.LocalDateTime.now().minusDays(30));
        // entryHash/previousHash intentionally left null — exactly what a
        // real document written before this feature existed looks like.
        mongoTemplate.save(preExisting1);

        ActivityLog preExisting2 = new ActivityLog();
        preExisting2.setOrganizationId(workspaceId);
        preExisting2.setAction("TASK_UPDATED");
        preExisting2.setEntityType("TASK");
        preExisting2.setEntityId("legacy-task");
        preExisting2.setPerformedBy(ownerEmail);
        preExisting2.setCreatedAt(java.time.LocalDateTime.now().minusDays(29));
        mongoTemplate.save(preExisting2);

        // Now write real, hashed entries through the normal path, as would
        // happen after this feature is deployed.
        activityLogService.log("TASK", "t1", "Task One", "TASK_CREATED", null, null, ownerEmail);
        activityLogService.log("TASK", "t1", "Task One", "TASK_COMPLETED", null, null, ownerEmail);

        var result = activityLogService.verifyChainIntegrity(workspaceId);
        assertTrue(result.isEmpty(),
                "Pre-existing, never-hashed entries must be skipped, not treated as a broken chain — " +
                        "found broken at: " + result.orElse("n/a"));
    }

    @Test
    @DisplayName("Tampering with a new (hashed) entry is still detected even when older unhashed entries are also present")
    void tamperingOnNewEntry_stillDetectedAmongMixedData() {
        clearActivityLogs();

        ActivityLog preExisting = new ActivityLog();
        preExisting.setOrganizationId(workspaceId);
        preExisting.setAction("TASK_CREATED");
        preExisting.setEntityType("TASK");
        preExisting.setEntityId("legacy-task");
        preExisting.setPerformedBy(ownerEmail);
        preExisting.setCreatedAt(java.time.LocalDateTime.now().minusDays(30));
        mongoTemplate.save(preExisting);

        activityLogService.log("TASK", "t1", "Task One", "TASK_CREATED", null, null, ownerEmail);
        activityLogService.log("TASK", "t1", "Task One", "TASK_UPDATED", "TODO", "DONE", ownerEmail);

        var hashedEntries = mongoTemplate.findAll(ActivityLog.class).stream()
                .filter(l -> l.getEntryHash() != null && "TASK_UPDATED".equals(l.getAction()))
                .findFirst().orElseThrow();
        hashedEntries.setNewValue("TAMPERED");
        mongoTemplate.save(hashedEntries);

        var result = activityLogService.verifyChainIntegrity(workspaceId);
        assertTrue(result.isPresent(),
                "Tampering with a real hashed entry must still be caught even with unhashed legacy entries present");
    }
}
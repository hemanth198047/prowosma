package com.prowosma.backend.service;

import com.prowosma.backend.model.WorkspaceConfig;
import com.prowosma.backend.repository.WorkspaceConfigRepository;
import com.prowosma.backend.repository.WorkspaceRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;

/**
 * Enforces the retention policy admins configure at
 * /api/admin/retention (WorkspaceConfig.retentionDays / autoDeleteEnabled /
 * legalHoldEnabled) — none of which was previously wired to anything.
 * Admins could toggle "auto-delete after N days" on, and it would do
 * nothing at all; the fields existed only as inert stored preferences.
 *
 * This is the one deliberate, policy-driven bulk-delete path for activity
 * logs in this app, and it exists specifically to work around
 * ActivityLogRepository no longer exposing a delete method at all (see
 * ImmutableMongoRepository) — that restriction is what makes the audit
 * trail trustworthy against arbitrary application code, but a real audit
 * system still needs *some* sanctioned way for old records to eventually
 * age out under an explicit, admin-configured, logged policy. Going
 * through MongoTemplate directly here — instead of adding delete methods
 * back to the repository interface — keeps that capability limited to
 * exactly this one intentional code path instead of being callable from
 * anywhere that injects the repository.
 *
 * A workspace under legal hold is never purged, regardless of its
 * retentionDays/autoDeleteEnabled settings — a legal hold exists
 * specifically to override normal retention, so honoring autoDeleteEnabled
 * over it would defeat the point of having a legal-hold flag at all.
 */
@Service
@RequiredArgsConstructor
public class RetentionEnforcementService {

    private final WorkspaceRepository       wsRepo;
    private final WorkspaceConfigRepository configRepo;
    private final MongoTemplate             mongoTemplate;
    private final ActivityLogService        activityLogService;

    /** Runs once a day at 3am — off-peak, and after the 8am/Monday-8am digest jobs in DigestService so it doesn't compete with them. */
    @Scheduled(cron = "0 0 3 * * *")
    public void enforceRetention() {
        wsRepo.findAll().forEach(ws -> {
            String orgId = ws.getId();
            WorkspaceConfig cfg = configRepo.findByWorkspaceId(orgId).orElse(null);
            if (cfg == null || !cfg.isAutoDeleteEnabled() || cfg.isLegalHoldEnabled()) return;

            LocalDateTime cutoff = LocalDateTime.now().minusDays(cfg.getRetentionDays());

            Query query = new Query(Criteria.where("organizationId").is(orgId)
                    .and("createdAt").lt(cutoff));
            long toDelete = mongoTemplate.count(query, "activity_logs");
            if (toDelete == 0) return;

            mongoTemplate.remove(query, "activity_logs");

            // Log the purge itself — an audit trail whose own maintenance
            // isn't recorded is exactly the kind of gap a real compliance
            // review would flag. This entry is the durable, permanent
            // record that "N records older than the retention window were
            // purged under this policy on this date" even though the
            // purged records themselves are, correctly, now gone.
            activityLogService.log("WORKSPACE", orgId, ws.getName(),
                    "RETENTION_PURGE_EXECUTED", null,
                    toDelete + " activity log entries older than " + cfg.getRetentionDays()
                        + " days purged per retention policy", null);
        });
    }
}

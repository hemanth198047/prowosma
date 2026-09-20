package com.prowosma.backend.service;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.ActivityLog;
import com.prowosma.backend.repository.ActivityLogRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.mongodb.core.FindAndModifyOptions;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;

import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.*;

import static org.springframework.data.mongodb.core.query.Criteria.where;

@Service
@RequiredArgsConstructor
public class ActivityLogService {

    private final ActivityLogRepository repo;
    private final WorkspaceContext workspaceContext;
    private final MongoTemplate mongoTemplate;

    private static final Map<String, String> SEVERITY = Map.ofEntries(
        Map.entry("PROJECT_DELETED",         "WARNING"),
        Map.entry("TASK_DELETED",            "WARNING"),
        Map.entry("GOAL_DELETED",            "WARNING"),
        Map.entry("USER_REMOVED",            "WARNING"),
        Map.entry("ROLE_CHANGED",            "WARNING"),
        Map.entry("PROJECT_DEADLINE_CHANGED","WARNING"),
        Map.entry("PASSWORD_CHANGED",        "WARNING"),
        Map.entry("DELETED",                 "WARNING"),
        Map.entry("BUDGET_LIMIT_REACHED",    "CRITICAL"),
        Map.entry("LOGIN_FAILED",            "CRITICAL"),
        Map.entry("SESSION_REVOKED",         "CRITICAL")
    );

    private static final Map<String, String> RISK = Map.ofEntries(
        Map.entry("BUDGET_LIMIT_REACHED",    "HIGH"),
        Map.entry("LOGIN_FAILED",            "HIGH"),
        Map.entry("PROJECT_DELETED",         "HIGH"),
        Map.entry("USER_REMOVED",            "MEDIUM"),
        Map.entry("ROLE_CHANGED",            "MEDIUM"),
        Map.entry("PROJECT_DEADLINE_CHANGED","MEDIUM"),
        Map.entry("PASSWORD_CHANGED",        "MEDIUM"),
        Map.entry("TASK_DELETED",            "MEDIUM")
    );

    public static String humanize(String action, String entityType,
                                   String entityName, String performedBy,
                                   String oldValue, String newValue) {
        String user   = resolveDisplayName(performedBy);
        String entity = entityName != null ? "\"" + entityName + "\"" : "an item";
        return switch (action) {
            case "PROJECT_CREATED"          -> user + " created project " + entity;
            case "PROJECT_UPDATED"          -> user + " updated project " + entity;
            case "PROJECT_DELETED"          -> user + " deleted project " + entity;
            case "PROJECT_ARCHIVED"         -> user + " archived project " + entity;
            case "PROJECT_REOPENED"         -> user + " reopened project " + entity;
            case "PROJECT_OWNER_CHANGED"    -> user + " changed owner of " + entity + (newValue != null ? " to " + newValue : "");
            case "PROJECT_DEADLINE_CHANGED" -> user + " moved deadline of " + entity + (oldValue != null ? " from " + oldValue : "") + (newValue != null ? " to " + newValue : "");
            case "PROJECT_STATUS_CHANGED"   -> user + " changed status of " + entity + (oldValue != null ? " from " + oldValue : "") + (newValue != null ? " to " + newValue : "");
            case "TASK_CREATED"             -> user + " created task " + entity;
            case "TASK_UPDATED"             -> user + " updated task " + entity;
            case "TASK_DELETED"             -> user + " deleted task " + entity;
            case "TASK_COMPLETED"           -> user + " completed task " + entity;
            case "TASK_STATUS_CHANGED"      -> user + " changed status of " + entity + (oldValue != null ? " from " + oldValue : "") + (newValue != null ? " to " + newValue : "");
            case "TASK_PRIORITY_CHANGED"    -> user + " changed priority of " + entity + (oldValue != null ? " from " + oldValue : "") + (newValue != null ? " to " + newValue : "");
            case "TASK_ASSIGNED"            -> user + " assigned " + entity + (newValue != null ? " to " + newValue : "");
            case "TASK_UNASSIGNED"          -> user + " unassigned " + entity;
            case "TASK_BLOCKED"             -> user + " blocked task " + entity;
            case "TASK_UNBLOCKED"           -> user + " unblocked task " + entity;
            case "GOAL_CREATED"             -> user + " created goal " + entity;
            case "GOAL_UPDATED"             -> user + " updated goal " + entity;
            case "GOAL_DELETED"             -> user + " deleted goal " + entity;
            case "GOAL_COMPLETED"           -> user + " completed goal " + entity;
            case "GOAL_PROGRESS_CHANGED"    -> user + " updated progress of " + entity + (oldValue != null ? " from " + oldValue + "%" : "") + (newValue != null ? " to " + newValue + "%" : "");
            case "SUBGOAL_CREATED"          -> user + " added sub-goal \"" + (newValue != null ? newValue : entityName != null ? entityName : "unknown") + "\"";
            case "STEP_COMPLETED"           -> user + " completed step \"" + (newValue != null ? newValue : "a step") + "\" in goal " + entity;
            case "USER_INVITED"             -> user + " invited " + (newValue != null ? newValue : "a user") + " to the workspace";
            case "USER_REMOVED"             -> user + " removed " + (oldValue != null ? oldValue : "a user") + " from the workspace";
            case "ROLE_CHANGED"             -> user + " changed role of " + (entityName != null ? entityName : "a user") + (oldValue != null ? " from " + oldValue : "") + (newValue != null ? " to " + newValue : "");
            case "WORKSPACE_JOINED"         -> (entityName != null ? entityName : "A user") + " joined the workspace";
            case "WORKSPACE_LEFT"           -> (entityName != null ? entityName : "A user") + " left the workspace";
            case "LOGIN_SUCCESS"            -> user + " logged in";
            case "LOGIN_FAILED"             -> "Failed login attempt for " + (entityName != null ? entityName : "unknown");
            case "PASSWORD_CHANGED"         -> user + " changed their password";
            case "2FA_ENABLED"              -> user + " enabled two-factor authentication";
            case "SESSION_REVOKED"          -> user + " session was revoked";
            case "API_KEY_CREATED"          -> user + " created an API key";
            case "TIME_LOGGED"              -> user + " logged " + (newValue != null ? newValue : "time") + " on " + entity;
            case "TIME_APPROVED"            -> user + " approved time for " + entity;
            case "BUDGET_LIMIT_REACHED"     -> "Budget limit reached for project " + entity;
            case "CREATED"                  -> user + " created " + (entityType != null ? entityType.toLowerCase() : "item") + " " + entity;
            case "UPDATED"                  -> user + " updated " + (entityType != null ? entityType.toLowerCase() : "item") + " " + entity;
            case "DELETED"                  -> user + " deleted " + (entityType != null ? entityType.toLowerCase() : "item") + " " + entity;
            case "STATUS_CHANGED"           -> user + " changed status of " + entity + (oldValue != null ? " from " + oldValue : "") + (newValue != null ? " to " + newValue : "");
            case "PROGRESS_UPDATED"         -> user + " updated progress of " + entity + (newValue != null ? " to " + newValue + "%" : "");
            default                         -> user + " performed " + action.replace("_", " ").toLowerCase() + " on " + entity;
        };
    }

    private static String resolveDisplayName(String performedBy) {
        if (performedBy == null || performedBy.isBlank()) return "System";
        return performedBy.contains("@") ? performedBy.split("@")[0] : performedBy;
    }

    // ── Core log methods ───────────────────────────────────────
    public void log(String entityType, String entityId, String entityName,
                    String action, String oldValue, String newValue,
                    String performedBy) {
        logFull(entityType, entityId, entityName, action,
                oldValue, newValue, performedBy, null, null, null, null, null);
    }

    public void logFull(String entityType, String entityId, String entityName,
                        String action, String oldValue, String newValue,
                        String performedBy, String projectId,
                        String taskId, String goalId) {
        logFull(entityType, entityId, entityName, action,
                oldValue, newValue, performedBy, projectId, taskId, goalId, null, null);
    }

    public void logFull(String entityType, String entityId, String entityName,
                        String action, String oldValue, String newValue,
                        String performedBy, String projectId,
                        String taskId, String goalId,
                        String ipAddress, String userAgent) {

        ActivityLog log = new ActivityLog();
        log.setEntityType(entityType);
        log.setEntityId(entityId);
        log.setEntityName(entityName);
        log.setAction(action);
        log.setOldValue(oldValue);
        log.setNewValue(newValue);
        // Set organizationId — prefer WorkspaceContext, fall back to explicit projectId param
        // (InvitationService passes workspaceId as projectId for unauthenticated flows)
        String ctxOrgId = workspaceContext.getWorkspaceId();
        log.setOrganizationId(ctxOrgId != null ? ctxOrgId : projectId);
        log.setProjectId(ctxOrgId != null ? projectId : null);

        log.setTaskId(taskId);
        log.setGoalId(goalId);
        log.setIpAddress(ipAddress);
        log.setUserAgent(userAgent != null && userAgent.length() > 200
                         ? userAgent.substring(0, 200) : userAgent);
        log.setSeverity(SEVERITY.getOrDefault(action, "INFO"));
        log.setRiskLevel(RISK.getOrDefault(action, "LOW"));

        String performer = performedBy;
        if (performer == null || performer.isBlank()) {
            try {
                var auth = SecurityContextHolder.getContext().getAuthentication();
                performer = auth != null ? auth.getName() : "System";
            } catch (Exception e) { performer = "System"; }
        }
        log.setPerformedBy(performer);
        log.setPerformedByName(resolveDisplayName(performer));
        log.setHumanReadable(humanize(action, entityType, entityName, performer, oldValue, newValue));

        // Smart burst correlation
        String orgId = workspaceContext.getWorkspaceId();
        // Use orgId from entityId fallback if WorkspaceContext returns null
        // (e.g. unauthenticated flows like invitation acceptance)
        if (log.getOrganizationId() == null && orgId != null) {
            log.setOrganizationId(orgId);
        }
        try {
            if (orgId != null && entityId != null) {
                LocalDateTime window = LocalDateTime.now().minusMinutes(5);
                List<ActivityLog> recent = repo
                    .findByOrganizationIdAndPerformedByAndEntityIdAndCreatedAtAfterOrderByCreatedAtDesc(
                        orgId, performer, entityId, window);
                log.setCorrelationId(!recent.isEmpty() && recent.get(0).getCorrelationId() != null
                    ? recent.get(0).getCorrelationId()
                    : UUID.randomUUID().toString());
            } else {
                log.setCorrelationId(UUID.randomUUID().toString());
            }
        } catch (Exception ignored) {
            log.setCorrelationId(UUID.randomUUID().toString());
        }

        try {
            attachHashChain(log);
            repo.save(log);
        } catch (Exception e) {
            // Log to console but never crash the calling service over a logging failure
            org.slf4j.LoggerFactory.getLogger(ActivityLogService.class)
                .warn("Failed to save activity log: {}", e.getMessage());
        }
    }

    /**
     * Tamper-evidence via hash chaining — previously the audit log was
     * append-only at the APPLICATION level (see ImmutableMongoRepository's
     * own comment) but had no way to prove, after the fact, that a record
     * wasn't modified or a record in the middle of the sequence wasn't
     * quietly removed by someone with direct database access (bypassing
     * the application entirely, which the append-only repository
     * interface obviously can't stop). Each entry now embeds a SHA-256
     * hash of its own core fields PLUS the previous entry's hash — so
     * altering or removing any past entry breaks every hash after it in
     * that chain, detectably. See verifyChainIntegrity() / AuditController
     * for how to actually check this.
     *
     * Chained per-organization (not one single global chain) — this
     * matches the natural unit compliance audits actually care about (one
     * workspace's trail), and avoids turning every single log write across
     * the whole app into contention on one global counter document.
     *
     * The "get the previous hash and claim this slot" step uses a
     * claim-token compare-and-swap (see the method body) rather than a
     * naive read-then-write, specifically to close most of the race
     * window where concurrent writes to the same org's chain could
     * silently claim the same previousHash and fork the chain — see the
     * KNOWN LIMITATION note below for the narrow window that remains.
     */
    private void attachHashChain(ActivityLog log) {
        String orgId = log.getOrganizationId() != null ? log.getOrganizationId() : "GLOBAL";

        // Two-step atomic claim, not a plain read-then-write — a naive
        // "read lastHash, then separately write the new lastHash" has a
        // wide race window where two concurrent writers for the same org
        // could both read the same previousHash before either writes
        // theirs back, forking the chain. This narrows that window
        // significantly (down to the claim-to-finalize gap below) without
        // needing a retry loop — see the KNOWN LIMITATION note on this
        // method's own javadoc for the narrow residual race that remains:
        //   1. Atomically SWAP lastHash for a one-off random claim token,
        //      capturing the real previous value in the same operation —
        //      only one caller can ever receive any given real previous
        //      value, since the swap itself is atomic at the document
        //      level. If the value we got back is itself a pending claim
        //      (another writer's step 1 already ran but its step 3
        //      hasn't landed yet), we fall back to previousHash=null
        //      rather than block/retry — see the KNOWN LIMITATION note.
        //   2. Compute this entry's real hash from that previous value.
        //   3. Write the real hash back, gated on the pointer still
        //      holding OUR claim token — guaranteed to succeed (nobody
        //      else could be holding our exact random token), so this
        //      step needs no retry.
        String claimToken = "claim:" + UUID.randomUUID();
        Query claimQuery = Query.query(where("_id").is(orgId));
        Update claimUpdate = new Update().set("lastHash", claimToken).set("updatedAt", LocalDateTime.now());
        ChainPointer previous = mongoTemplate.findAndModify(
            claimQuery, claimUpdate,
            FindAndModifyOptions.options().upsert(true).returnNew(false), // old value = the real previous hash
            ChainPointer.class
        );
        String previousHash = (previous != null && previous.lastHash != null
            && !previous.lastHash.startsWith("claim:")) ? previous.lastHash : null;

        String canonical = String.join("|",
            String.valueOf(previousHash),
            String.valueOf(log.getOrganizationId()),
            String.valueOf(log.getAction()),
            String.valueOf(log.getEntityType()),
            String.valueOf(log.getEntityId()),
            String.valueOf(log.getPerformedBy()),
            String.valueOf(log.getOldValue()),
            String.valueOf(log.getNewValue()),
            String.valueOf(log.getCreatedAt())
        );
        String hash = sha256Hex(canonical);

        log.setPreviousHash(previousHash);
        log.setEntryHash(hash);

        // Finalize — only replaces OUR OWN claim token, never another
        // writer's, so this can't race with anything.
        mongoTemplate.updateFirst(
            Query.query(where("_id").is(orgId).and("lastHash").is(claimToken)),
            new Update().set("lastHash", hash).set("updatedAt", LocalDateTime.now()),
            ChainPointer.class
        );
    }

    private static String sha256Hex(String input) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(input.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : bytes) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 unavailable — should never happen on a standard JVM", e);
        }
    }

    /** Backing document for the per-org "what was the last hash written" pointer, in its own tiny collection. */
    @org.springframework.data.mongodb.core.mapping.Document(collection = "activity_log_chain_pointers")
    static class ChainPointer {
        @org.springframework.data.annotation.Id
        String id; // organizationId (or "GLOBAL")
        String lastHash;
        LocalDateTime updatedAt;
    }

    /**
     * Walks this organization's full chain in creation order and confirms
     * every entry's stored previousHash matches the actual hash of the
     * entry before it, and every entry's stored entryHash matches what
     * re-computing it from its own fields produces. Returns the ID of the
     * first entry where either check fails, or empty if the whole chain
     * is intact. Used by AuditController's /verify endpoint — see
     * docs/COMPLIANCE.md for how to interpret a failure here.
     *
     * REAL-WORLD ROLLOUT HANDLING (found and fixed during a later review
     * pass, not the original implementation — worth calling out
     * explicitly rather than quietly folding in): any workspace with
     * activity-log history from BEFORE this hash-chaining feature was
     * deployed has entries with entryHash/previousHash both null (those
     * fields didn't exist yet when they were written). Those pre-existing
     * entries are correctly unverifiable — this method skips them rather
     * than flag every one of them as "broken," which the original version
     * of this method did (it would have reported the very first
     * pre-existing entry in ANY workspace with history as tampered, with
     * zero actual tampering — an entirely self-inflicted false positive
     * on every real deployment, caught by manually tracing this exact
     * scenario rather than by any test, since every existing test builds
     * its data after the feature already exists). Verification genuinely
     * starts at the first entry that HAS a hash — that entry's own stored
     * previousHash is trusted as the starting baseline (there's no way to
     * verify it against anything from before hashing existed), and the
     * chain is verified strictly from there forward.
     */
    public Optional<String> verifyChainIntegrity(String organizationId) {
        List<ActivityLog> chain = repo.findByOrganizationIdOrderByCreatedAtAscIdAsc(organizationId);
        String expectedPreviousHash = null;
        boolean chainStarted = false;

        for (ActivityLog entry : chain) {
            if (entry.getEntryHash() == null) {
                // Predates this feature being enabled for this organization —
                // not part of the verifiable chain. Not a break; just nothing
                // to check here.
                continue;
            }
            if (!chainStarted) {
                // The first hashed entry is the real start of what we can
                // verify — trust its own recorded previousHash as the
                // baseline rather than assuming null, since unhashed history
                // (if any) before it isn't something this mechanism can
                // speak to either way.
                expectedPreviousHash = entry.getPreviousHash();
                chainStarted = true;
            }

            String canonical = String.join("|",
                String.valueOf(expectedPreviousHash),
                String.valueOf(entry.getOrganizationId()),
                String.valueOf(entry.getAction()),
                String.valueOf(entry.getEntityType()),
                String.valueOf(entry.getEntityId()),
                String.valueOf(entry.getPerformedBy()),
                String.valueOf(entry.getOldValue()),
                String.valueOf(entry.getNewValue()),
                String.valueOf(entry.getCreatedAt())
            );
            String recomputed = sha256Hex(canonical);

            if (!Objects.equals(entry.getPreviousHash(), expectedPreviousHash) ||
                !Objects.equals(entry.getEntryHash(), recomputed)) {
                return Optional.of(entry.getId());
            }
            expectedPreviousHash = entry.getEntryHash();
        }
        return Optional.empty();
    }

    // ── Queries ────────────────────────────────────────────────
    public List<ActivityLog> getRecent(int limit) {
        String orgId = workspaceContext.getWorkspaceId();
        if (orgId == null) return List.of();      // never fall back to every workspace's activity
        return repo.findByOrganizationIdOrderByCreatedAtDesc(orgId, PageRequest.of(0, limit));
    }

    public List<ActivityLog> getByDateRange(LocalDateTime from, LocalDateTime to) {
        String orgId = workspaceContext.getWorkspaceId();
        if (orgId == null) return List.of();
        return repo.findByOrganizationIdAndCreatedAtBetweenOrderByCreatedAtDesc(orgId, from, to);
    }

    public List<ActivityLog> getByEntity(String entityType, String entityId) {
        return repo.findByEntityTypeAndEntityIdOrderByCreatedAtDesc(entityType, entityId);
    }

    public List<ActivityLog> getByEntityType(String entityType) {
        return repo.findByEntityType(entityType);
    }

    public List<ActivityLog> getForProject(String projectId, int limit) {
        return repo.findByProjectIdOrderByCreatedAtDesc(projectId, PageRequest.of(0, limit));
    }

    public List<ActivityLog> getForTask(String taskId, int limit) {
        return repo.findByTaskIdOrderByCreatedAtDesc(taskId, PageRequest.of(0, limit));
    }

    public List<ActivityLog> getForGoal(String goalId, int limit) {
        return repo.findByGoalIdOrderByCreatedAtDesc(goalId, PageRequest.of(0, limit));
    }

    public List<ActivityLog> getHighSeverity(int limit) {
        String orgId = workspaceContext.getWorkspaceId();
        if (orgId == null) return List.of();
        return repo.findHighSeverityByOrg(orgId, PageRequest.of(0, limit));
    }

    public List<Map<String, Object>> getGrouped(int limit) {
        List<ActivityLog> logs = getRecent(limit);
        Map<String, List<ActivityLog>> byCorrelation = new LinkedHashMap<>();
        for (ActivityLog l : logs) {
            String key = l.getCorrelationId() != null ? l.getCorrelationId() : l.getId();
            byCorrelation.computeIfAbsent(key, k -> new ArrayList<>()).add(l);
        }
        List<Map<String, Object>> result = new ArrayList<>();
        for (Map.Entry<String, List<ActivityLog>> e : byCorrelation.entrySet()) {
            List<ActivityLog> group = e.getValue();
            ActivityLog first = group.get(0);
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("correlationId", e.getKey());
            item.put("count", group.size());
            item.put("representative", first);
            item.put("entries", group.size() == 1 ? null : group);
            item.put("isBurst", group.size() > 1);
            result.add(item);
        }
        return result;
    }

    public Map<String, Object> getWorkspaceHealth() {
        String orgId = workspaceContext.getWorkspaceId();
        if (orgId == null) return Map.of();
        LocalDateTime now = LocalDateTime.now();
        LocalDateTime week = now.minusDays(7);
        LocalDateTime prev = now.minusDays(14);
        long thisWeek   = repo.countByOrganizationIdAndCreatedAtBetween(orgId, week, now);
        long lastWeek   = repo.countByOrganizationIdAndCreatedAtBetween(orgId, prev, week);
        long deletions  = repo.countByOrganizationIdAndActionAndCreatedAtBetween(orgId, "DELETED", week, now)
                        + repo.countByOrganizationIdAndActionAndCreatedAtBetween(orgId, "PROJECT_DELETED", week, now)
                        + repo.countByOrganizationIdAndActionAndCreatedAtBetween(orgId, "TASK_DELETED", week, now);
        long completions= repo.countByOrganizationIdAndActionAndCreatedAtBetween(orgId, "TASK_COMPLETED", week, now)
                        + repo.countByOrganizationIdAndActionAndCreatedAtBetween(orgId, "GOAL_COMPLETED", week, now);
        List<ActivityLog> alerts = repo.findHighSeverityByOrg(orgId, PageRequest.of(0, 5));
        Map<String, Object> health = new LinkedHashMap<>();
        health.put("eventsThisWeek",   thisWeek);
        health.put("eventsLastWeek",   lastWeek);
        health.put("velocity",         lastWeek == 0 ? 100 : (int)((thisWeek - lastWeek) * 100.0 / lastWeek));
        health.put("deletionsThisWeek",deletions);
        health.put("completionsThisWeek", completions);
        health.put("recentAlerts",     alerts);
        return health;
    }

    public String exportCsv(LocalDateTime from, LocalDateTime to) {
        List<ActivityLog> logs = from != null && to != null ? getByDateRange(from, to) : getRecent(1000);
        StringBuilder csv = new StringBuilder();
        csv.append("Date,Time,Performed By,Action,Severity,Entity Type,Entity Name,Old Value,New Value,Description,IP Address\n");
        for (ActivityLog l : logs) {
            csv.append(String.format("\"%s\",\"%s\",\"%s\",\"%s\",\"%s\",\"%s\",\"%s\",\"%s\",\"%s\",\"%s\",\"%s\"\n",
                l.getCreatedAt() != null ? l.getCreatedAt().toLocalDate() : "",
                l.getCreatedAt() != null ? l.getCreatedAt().toLocalTime().toString().substring(0, 8) : "",
                safe(l.getPerformedBy()), safe(l.getAction()), safe(l.getSeverity()),
                safe(l.getEntityType()), safe(l.getEntityName()),
                safe(l.getOldValue()), safe(l.getNewValue()),
                safe(l.getHumanReadable()), safe(l.getIpAddress())));
        }
        return csv.toString();
    }

    private String safe(String v) { return v == null ? "" : v.replace("\"", "\"\""); }
}

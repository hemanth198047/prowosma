package com.prowosma.backend.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.context.event.ContextRefreshedEvent;
import org.springframework.context.event.EventListener;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.index.Index;
import org.springframework.data.mongodb.core.index.IndexDefinition;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * MongoDB index configuration — ensured at startup.
 *
 * Organised by collection. Rules:
 *   1. Every findByOrganizationId call needs an index on organizationId.
 *   2. Compound indexes: put equality fields first, range/sort fields last.
 *   3. Text search fields (title, name) get a single ascending index.
 *   4. High-cardinality FK fields (projectId, sprintId, parentTaskId) indexed for JOIN-style lookups.
 */
@Configuration
@RequiredArgsConstructor
@Slf4j
public class MongoIndexConfig {

    private final MongoTemplate mongoTemplate;

    @EventListener(ContextRefreshedEvent.class)
    public void initIndexes() {
        indexesEnsured = 0;
        collectionsTouched.clear();
        try {
            // ── tasks ─────────────────────────────────────────────────────────
            ensure("tasks", idx().on("organizationId", ASC).on("status",      ASC));
            ensure("tasks", idx().on("organizationId", ASC).on("dueDate",     ASC));
            ensure("tasks", idx().on("organizationId", ASC).on("projectId",   ASC));
            ensure("tasks", idx().on("organizationId", ASC).on("sprintId",    ASC));
            ensure("tasks", idx().on("organizationId", ASC).on("createdAt",   DESC));
            ensure("tasks", idx().on("organizationId", ASC).on("priority",    ASC));
            ensure("tasks", idx().on("parentTaskId",   ASC));                          // subtask lookup
            ensure("tasks", idx().on("linkedGoalId",   ASC));                          // goal→task link
            ensure("tasks", idx().on("title",          ASC));                          // title search
            ensure("tasks", idx().on("organizationId", ASC).on("customFieldValues.externalRef", ASC).sparse());   // imported issues / inbound alerts: find by external reference
            ensure("integrations", idx().on("inboundTokenHash", ASC).sparse());                                    // public inbound-event URL looks integrations up by token hash

            // ── projects ─────────────────────────────────────────────────────
            ensure("projects", idx().on("organizationId", ASC).on("status",    ASC));
            ensure("projects", idx().on("organizationId", ASC).on("updatedAt", DESC));
            ensure("projects", idx().on("parentProjectId", ASC));                      // hierarchy
            ensure("projects", idx().on("name",            ASC));                      // name search

            // ── goals ────────────────────────────────────────────────────────
            ensure("goals", idx().on("organizationId", ASC).on("status",       ASC));
            ensure("goals", idx().on("organizationId", ASC).on("createdAt",    DESC));
            ensure("goals", idx().on("parentGoalId",   ASC));                          // goal tree
            ensure("goals", idx().on("title",          ASC));

            // ── activity_logs ─────────────────────────────────────────────────
            ensure("activity_logs", idx().on("organizationId", ASC).on("createdAt",  DESC));
            ensure("activity_logs", idx().on("organizationId", ASC).on("action",     ASC).on("createdAt", DESC));
            ensure("activity_logs", idx().on("organizationId", ASC).on("severity",   ASC));
            ensure("activity_logs", idx().on("organizationId", ASC).on("entityType", ASC).on("entityId", ASC));
            ensure("activity_logs", idx().on("entityType", ASC).on("entityId", ASC));
            ensure("activity_logs", idx().on("projectId", ASC).on("createdAt", DESC));
            ensure("activity_logs", idx().on("taskId",    ASC).on("createdAt", DESC));
            ensure("activity_logs", idx().on("goalId",    ASC).on("createdAt", DESC));
            ensure("activity_logs", idx().on("correlationId", ASC));

            // ── docs ─────────────────────────────────────────────────────────
            ensure("docs", idx().on("workspaceId", ASC).on("deleted", ASC).on("updatedAt", DESC));
            ensure("docs", idx().on("workspaceId", ASC).on("deleted", ASC).on("createdBy", ASC));
            ensure("docs", idx().on("workspaceId", ASC).on("parentId", ASC));         // tree nav
            ensure("docs", idx().on("title",       ASC));

            // ── notifications ─────────────────────────────────────────────────
            ensure("notifications", idx().on("organizationId", ASC).on("read",      ASC).on("createdAt", DESC));
            ensure("notifications", idx().on("userId",         ASC).on("read",      ASC).on("createdAt", DESC));

            // ── sprints ───────────────────────────────────────────────────────
            ensure("sprints", idx().on("organizationId", ASC).on("status",    ASC));
            ensure("sprints", idx().on("organizationId", ASC).on("projectId", ASC));

            // ── meetings ─────────────────────────────────────────────────────
            ensure("meetings", idx().on("workspaceId", ASC).on("meetingDate", DESC));
            ensure("meetings", idx().on("workspaceId", ASC).on("status",      ASC));

            // ── epics ─────────────────────────────────────────────────────────
            ensure("epics", idx().on("organizationId", ASC).on("projectId", ASC));

            // ── webhooks ─────────────────────────────────────────────────────
            ensure("webhooks", idx().on("organizationId", ASC).on("active", ASC));

            // ── automations ───────────────────────────────────────────────────
            ensure("automations", idx().on("organizationId", ASC).on("enabled", ASC).on("triggerType", ASC));

            // ── invitations ───────────────────────────────────────────────────
            ensure("invitations", idx().on("workspaceId", ASC).on("status",    ASC));
            ensure("invitations", idx().on("email",       ASC).on("status",    ASC));
            ensure("invitations", idx().on("token",       ASC).unique());

            // ── api_keys ──────────────────────────────────────────────────────
            ensure("api_keys", idx().on("organizationId", ASC).on("active", ASC));

            // ── workspace_configs ─────────────────────────────────────────────
            ensure("workspace_configs", idx().on("workspaceId", ASC).unique());

            // ── channel_messages ──────────────────────────────────────────────
            ensure("channel_messages", idx().on("channelId", ASC).on("createdAt", DESC));

            // ── team_members ─────────────────────────────────────────────────
            // A person can only have one role in a given workspace — nothing
            // previously enforced that at the schema level, which let
            // duplicate (organizationId, email) rows accumulate and made the
            // Optional-returning lookups in WorkspaceFilter/RoleGuardFilter
            // throw IncorrectResultSizeDataAccessException instead of just
            // returning the (single, correct) membership.
            ensure("team_members", idx().on("organizationId", ASC).on("email", ASC).unique());

            // ── time tracking ─────────────────────────────────────────────────
            ensure("invoices", idx().on("organizationId", ASC).on("issuedAt", DESC));
            ensure("invoices", idx().on("organizationId", ASC).on("status",   ASC));

            // ── raids / scenarios / sops / initiatives / programmes ───────────
            ensure("raid_entries",   idx().on("organizationId", ASC).on("projectId", ASC));
            ensure("scenarios",      idx().on("organizationId", ASC).on("createdAt", DESC));
            ensure("sops",           idx().on("workspaceId",    ASC).on("status",    ASC).on("updatedAt", DESC));
            ensure("initiatives",    idx().on("organizationId", ASC).on("status",    ASC));
            ensure("programmes",     idx().on("organizationId", ASC).on("status",    ASC));

            // ── workspaces ────────────────────────────────────────────────────
            ensure("workspaces", idx().on("ownerEmail",          ASC));
            ensure("workspaces", idx().on("organizationId",      ASC));
            ensure("workspaces", idx().on("parentOrganizationId", ASC));

            // ── users ─────────────────────────────────────────────────────────────
            ensure("users", idx().on("email",            ASC).unique());
            ensure("users", idx().on("organizationId",   ASC));
            ensure("users", idx().on("magicLinkToken",   ASC));
            ensure("users", idx().on("refreshToken",     ASC));
            ensure("users", idx().on("emailOtpCode",     ASC));

            // Previously logged a hardcoded "23" regardless of how many
            // ensure() calls actually ran above (61, as of this writing) —
            // accurate now via the counters ensure() itself maintains, and
            // this banner is what infra/setup-mongodb.bat's "did it work?"
            // check for a non-technical client watching the console looks
            // for (see that script for why the exact wording matters).
            log.info("=================================================");
            log.info("✅ DATABASE READY — {} indexes verified across {} collections", indexesEnsured, collectionsTouched.size());
            log.info("=================================================");
        } catch (Exception e) {
            log.warn("⚠️  Index creation warning (may already exist): {}", e.getMessage());
        }
    }

    private static final Sort.Direction ASC  = Sort.Direction.ASC;
    private static final Sort.Direction DESC = Sort.Direction.DESC;

    private int indexesEnsured = 0;
    private final java.util.Set<String> collectionsTouched = new java.util.HashSet<>();

    private Index idx() { return new Index(); }

    private void ensure(String collection, IndexDefinition index) {
        collectionsTouched.add(collection);
        try {
            mongoTemplate.indexOps(collection).createIndex(index);
            indexesEnsured++;
        } catch (Exception e) {
            log.debug("Index skip [{}]: {}", collection, e.getMessage());
        }
    }
}
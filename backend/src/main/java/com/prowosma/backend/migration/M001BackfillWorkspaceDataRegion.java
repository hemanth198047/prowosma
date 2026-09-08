package com.prowosma.backend.migration;

import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.stereotype.Component;

import static org.springframework.data.mongodb.core.query.Criteria.where;

/**
 * Real first example, not a placeholder: Workspace.dataRegion was added to
 * the Java model partway through this project's history (data-residency
 * work), with a Java-level default of "UNSET". Spring Data MongoDB already
 * handles reads correctly for documents created before that field
 * existed — the Java default applies when a stored document simply lacks
 * the field, so nothing was ever broken for application code going
 * through the normal model/repository layer.
 *
 * But anything that queries MongoDB directly rather than through that
 * layer — an aggregation pipeline, this project's own MongoTemplate-based
 * services (RetentionEnforcementService, the DLP violation queries), an
 * admin running mongosh by hand — would see those older documents simply
 * missing the field, not "UNSET". This migration closes that gap once,
 * for every environment, rather than leaving it as a latent inconsistency
 * between "how Java reads it" and "how the raw database actually looks."
 *
 * Idempotent by construction: the query only matches documents where the
 * field doesn't exist yet, so running this twice (which normally
 * shouldn't happen — see MigrationRunner's locking — but is worth being
 * safe against regardless) is a no-op the second time.
 */
@Component
public class M001BackfillWorkspaceDataRegion implements Migration {

    @Override
    public String id() {
        return "2026-08-11-001-backfill-workspace-data-region";
    }

    @Override
    public String description() {
        return "Sets dataRegion=\"UNSET\" explicitly on Workspace documents created before that field existed";
    }

    @Override
    public void migrate(MongoTemplate template) {
        Query missingField = Query.query(where("dataRegion").exists(false));
        Update setUnset = Update.update("dataRegion", "UNSET");
        template.updateMulti(missingField, setUnset, "workspaces");
    }
}

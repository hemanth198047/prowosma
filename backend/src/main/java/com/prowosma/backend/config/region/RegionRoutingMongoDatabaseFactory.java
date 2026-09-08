package com.prowosma.backend.config.region;

import com.mongodb.ConnectionString;
import com.mongodb.client.MongoClient;
import com.mongodb.client.MongoClients;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.mongodb.MongoDatabaseFactory;
import org.springframework.data.mongodb.core.SimpleMongoClientDatabaseFactory;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * A MongoDatabaseFactory that routes to a genuinely distinct physical
 * MongoDB cluster per data-residency region, based on RegionContext's
 * current value — the actual enforcement mechanism, not metadata.
 *
 * NOT wired as the app's primary/default MongoDatabaseFactory — that
 * would force every single one of the ~60 existing @Document repositories
 * to suddenly depend on region routing being correctly configured
 * end-to-end, which is far too invasive a change to make without being
 * able to compile and test against a real multi-cluster MongoDB setup
 * (not available in the environment this was written in). Instead this is
 * a SEPARATE, named bean ("regionRoutedMongoDatabaseFactory") that
 * specific repositories opt into one at a time — see
 * docs/DATA_RESIDENCY.md for the exact adoption steps and which
 * collections are good first candidates.
 *
 * Falls back to the default/home database (this app's existing single
 * spring.data.mongodb.uri connection) whenever RegionContext.get() is
 * null, OR the region it names has no configured URI — so adopting this
 * factory for a repository is safe even before every region is actually
 * provisioned: it degrades to "everyone shares the home database" rather
 * than failing closed.
 */
@Slf4j
public class RegionRoutingMongoDatabaseFactory implements MongoDatabaseFactory {

    private final MongoDatabaseFactory homeFactory;
    private final RegionConfig regionConfig;
    private final Map<String, MongoDatabaseFactory> regionFactories = new LinkedHashMap<>();

    public RegionRoutingMongoDatabaseFactory(MongoDatabaseFactory homeFactory, RegionConfig regionConfig) {
        this.homeFactory = homeFactory;
        this.regionConfig = regionConfig;
    }

    private MongoDatabaseFactory resolve() {
        String region = RegionContext.get();
        if (region == null) return homeFactory;

        String uri = regionConfig.uriFor(region.toUpperCase());
        if (uri == null) {
            // No real infrastructure for this region yet — degrade to the
            // home database rather than throw, so a workspace that declared
            // a not-yet-provisioned region still functions (just without
            // the residency guarantee it asked for — see
            // WorkspaceService's creation-time validation, which is the
            // layer that should stop this from happening for NEW
            // workspaces; this fallback covers pre-existing data only).
            log.warn("[RegionRouting] No MongoDB URI configured for region '{}' — falling back to the " +
                "home database for this request.", region);
            return homeFactory;
        }

        return regionFactories.computeIfAbsent(region, r -> {
            MongoClient client = MongoClients.create(uri);
            String databaseName = new ConnectionString(uri).getDatabase();
            log.info("[RegionRouting] Opened connection for region '{}' (database: {})", r, databaseName);
            return new SimpleMongoClientDatabaseFactory(client, databaseName);
        });
    }

    @Override
    public com.mongodb.client.MongoDatabase getMongoDatabase() {
        return resolve().getMongoDatabase();
    }

    @Override
    public com.mongodb.client.MongoDatabase getMongoDatabase(String dbName) {
        return resolve().getMongoDatabase(dbName);
    }

    @Override
    public org.springframework.dao.support.PersistenceExceptionTranslator getExceptionTranslator() {
        return homeFactory.getExceptionTranslator();
    }

    @Override
    public com.mongodb.client.ClientSession getSession(com.mongodb.ClientSessionOptions options) {
        return resolve().getSession(options);
    }

    @Override
    public MongoDatabaseFactory withSession(com.mongodb.client.ClientSession session) {
        return resolve().withSession(session);
    }
}

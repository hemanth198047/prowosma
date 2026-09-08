package com.prowosma.backend.migration;

import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.springframework.data.mongodb.core.query.Criteria.where;

/**
 * Runs on every application startup. Discovers every Migration bean Spring
 * knows about, sorts by id(), and runs any whose id isn't already recorded
 * in the "_migrations" collection — then records it, so it never runs
 * again anywhere.
 *
 * Simple Mongo-based lock (a single document with a fixed _id, acquired
 * via an insert that fails if it already exists) guards against two app
 * instances starting simultaneously during a rolling deployment and both
 * trying to run the same migration at once — a real, not hypothetical,
 * concern once more than one backend instance exists (see the
 * horizontal-scaling item elsewhere in this backlog). If the lock can't be
 * acquired, this instance logs that another instance is already migrating
 * and simply skips running migrations itself rather than blocking startup
 * — the instance that holds the lock will finish, and this one will pick
 * up any still-pending migrations on its next restart.
 *
 * Disabled entirely under the "test" profile — ProwosmaTestBase boots a
 * fresh, ephemeral embedded MongoDB (Flapdoodle) per test run, so there's
 * no realistic "existing production data to migrate" scenario in tests to
 * begin with, and this sandbox has no way to actually run the existing
 * test suite to confirm this addition doesn't interact with it in some
 * unexpected way. Opting out entirely is the more conservative, verifiable
 * choice given that constraint, rather than assuming it's harmless.
 */
@Component
@Profile("!test")
@RequiredArgsConstructor
public class MigrationRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(MigrationRunner.class);
    private static final String MIGRATIONS_COLLECTION = "_migrations";
    private static final String LOCK_COLLECTION = "_migration_lock";
    private static final String LOCK_ID = "migration-lock";

    private final MongoTemplate mongoTemplate;
    private final List<Migration> migrations;

    @Override
    public void run(ApplicationArguments args) {
        if (migrations.isEmpty()) return;

        if (!acquireLock()) {
            log.info("Another instance is already running migrations — skipping this startup, "
                    + "will retry any still-pending migrations on next restart.");
            return;
        }

        try {
            List<Migration> sorted = migrations.stream()
                    .sorted(Comparator.comparing(Migration::id))
                    .toList();

            for (Migration m : sorted) {
                boolean alreadyRan = mongoTemplate.exists(
                        Query.query(where("_id").is(m.id())), MIGRATIONS_COLLECTION);
                if (alreadyRan) continue;

                log.info("Running migration {} — {}", m.id(), m.description());
                long startedAt = System.currentTimeMillis();
                m.migrate(mongoTemplate);
                long durationMs = System.currentTimeMillis() - startedAt;

                Map<String, Object> record = new LinkedHashMap<>();
                record.put("_id", m.id());
                record.put("description", m.description());
                record.put("ranAt", LocalDateTime.now().toString());
                record.put("durationMs", durationMs);
                mongoTemplate.save(record, MIGRATIONS_COLLECTION);
                log.info("Migration {} completed in {}ms", m.id(), durationMs);
            }
        } finally {
            releaseLock();
        }
    }

    private boolean acquireLock() {
        try {
            Map<String, Object> lock = new LinkedHashMap<>();
            lock.put("_id", LOCK_ID);
            lock.put("acquiredAt", LocalDateTime.now().toString());
            mongoTemplate.insert(lock, LOCK_COLLECTION);
            return true;
        } catch (DuplicateKeyException e) {
            return false;
        }
    }

    private void releaseLock() {
        mongoTemplate.remove(Query.query(where("_id").is(LOCK_ID)), LOCK_COLLECTION);
    }
}

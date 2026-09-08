package com.prowosma.backend.migration;

import org.springframework.data.mongodb.core.MongoTemplate;

/**
 * A single, versioned MongoDB schema/data migration. Implement this for
 * any change that needs to run exactly once across every environment as
 * document schemas evolve — backfilling a newly-added field onto existing
 * documents, renaming a field, restructuring embedded data, etc.
 *
 * This is a deliberately small, hand-rolled mechanism rather than a
 * third-party library (Mongock and similar were considered — see the
 * write-up alongside this file) — every piece of it (MongoTemplate,
 * ApplicationRunner, standard Spring bean discovery) is already proven to
 * work in this exact codebase, rather than depending on a library whose
 * current Spring Boot 4 compatibility couldn't be confirmed and whose
 * integration couldn't be tested in the environment this was written in.
 *
 * Register a new migration by creating a @Component implementing this
 * interface — MigrationRunner discovers all of them automatically and
 * runs any whose id() hasn't already been recorded as complete, in id()
 * order. IDs should sort chronologically (e.g. "2026-08-11-001") so
 * migration order matches the order they were actually written in.
 */
public interface Migration {

    /**
     * Stable, unique identifier — once a migration with this id has run
     * successfully anywhere, it is never run again, even if this class is
     * later renamed or its logic changed. Use a date-prefixed, sortable
     * format: "YYYY-MM-DD-NNN-short-description".
     */
    String id();

    /** One-line human description, shown in logs and the migration history. */
    String description();

    /**
     * Perform the migration. Must be safe to interrupt and safe to be
     * skipped-then-retried if MigrationRunner itself fails after this
     * returns but before recording completion — prefer idempotent
     * operations (e.g. Mongo update-with-filter rather than blind insert)
     * wherever practical, since "ran twice" should be harmless even
     * though the runner's own locking (see MigrationRunner) is designed
     * to make that not actually happen in normal operation.
     */
    void migrate(MongoTemplate template);
}

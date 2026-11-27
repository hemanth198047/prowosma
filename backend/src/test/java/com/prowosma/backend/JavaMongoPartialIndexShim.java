package com.prowosma.backend;

import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Only when the tests run on the pure-Java Mongo server (TEST_MONGO_JAVA=true). That server ignores {@code partialFilterExpression}, so it
 * builds the app's three "unique only when the key exists" indexes as plain unique ones, and every record WITHOUT the key then collides
 * with the next one (null == null). Real MongoDB doesn't do that, so those indexes are dropped here to match real behaviour for records
 * without a key. The one thing this leaves unchecked is the database-level uniqueness for records that DO carry a key; that is covered at
 * the service level by the tests that insert the same key twice (and by real MongoDB in production).
 */
@Component
public class JavaMongoPartialIndexShim {
    private final MongoTemplate mongo;

    public JavaMongoPartialIndexShim(MongoTemplate mongo) { this.mongo = mongo; }

    @EventListener(ApplicationReadyEvent.class)
    public void dropPartialIndexes() {
        if (!"true".equalsIgnoreCase(System.getenv("TEST_MONGO_JAVA"))) return;
        record Idx(String collection, String name) {}
        for (Idx i : List.of(new Idx("tasks", "uniq_task_meeting_source"), new Idx("projects", "uniq_project_meeting_source"),
                new Idx("uma_meetings", "uniq_calendar_event"))) {
            try { mongo.indexOps(i.collection()).dropIndex(i.name()); } catch (Exception ignored) { /* not there yet */ }
        }
    }
}

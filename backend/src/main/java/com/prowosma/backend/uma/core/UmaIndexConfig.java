package com.prowosma.backend.uma.core;

import lombok.extern.slf4j.Slf4j;
import org.springframework.context.event.ContextRefreshedEvent;
import org.springframework.context.event.EventListener;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.index.Index;
import org.springframework.stereotype.Component;

/** Indexes for the uma_* collections (additive; never touches the existing assistant's collections). */
@Component
@Slf4j
public class UmaIndexConfig {
    private final MongoTemplate mongo;

    public UmaIndexConfig(MongoTemplate mongo) { this.mongo = mongo; }

    @EventListener(ContextRefreshedEvent.class)
    public void ensureIndexes() {
        try {
            mongo.indexOps("uma_meetings").createIndex(new Index().on("organizationId", Sort.Direction.ASC).on("createdAt", Sort.Direction.DESC).named("org_created"));
            mongo.indexOps("uma_segments").createIndex(new Index().on("organizationId", Sort.Direction.ASC).on("meetingId", Sort.Direction.ASC)
                    .on("seq", Sort.Direction.ASC).unique().named("uniq_meeting_seq"));
            mongo.indexOps("uma_jobs").createIndex(new Index().on("jobKey", Sort.Direction.ASC).unique().named("uniq_job_key"));
            mongo.indexOps("uma_jobs").createIndex(new Index().on("status", Sort.Direction.ASC).on("runAfter", Sort.Direction.ASC).named("claim"));
            mongo.indexOps("uma_audit").createIndex(new Index().on("organizationId", Sort.Direction.ASC).on("meetingId", Sort.Direction.ASC).on("at", Sort.Direction.DESC).named("org_meeting_at"));
            mongo.indexOps("uma_questions").createIndex(new Index().on("organizationId", Sort.Direction.ASC).on("meetingId", Sort.Direction.ASC).named("org_meeting"));
            // One task per approved action item. The existing assistant creates this same index (same name and definition, so this is
            // a no-op while both exist); declaring it here keeps the guarantee if that feature is ever retired.
            mongo.indexOps("tasks").createIndex(new Index().on("organizationId", Sort.Direction.ASC).on("sourceActionKey", Sort.Direction.ASC).unique()
                    .partial(org.springframework.data.mongodb.core.index.PartialIndexFilter.of(
                            org.springframework.data.mongodb.core.query.Criteria.where("sourceActionKey").exists(true)))
                    .named("uniq_task_meeting_source"));
        } catch (Exception e) {
            log.warn("Universal Meeting Assistant indexes could not be ensured: {}", e.getClass().getSimpleName());
        }
    }
}

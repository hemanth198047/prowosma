package com.prowosma.backend.config;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.event.ContextRefreshedEvent;
import org.springframework.context.event.EventListener;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.index.Index;

/** Indexes for the Meeting Assistant collections. Kept separate from MongoIndexConfig. */
@Configuration
@RequiredArgsConstructor
@Slf4j
public class MeetingAssistantIndexConfig {

    private final MongoTemplate mongoTemplate;

    @EventListener(ContextRefreshedEvent.class)
    public void ensureIndexes() {
        try {
            // One ACTIVE session per organization+provider+meeting+occurrence. Sparse, so
            // terminal sessions (activeKey absent) never collide with each other.
            mongoTemplate.indexOps("meeting_sessions").createIndex(
                    new Index().on("activeKey", Sort.Direction.ASC).unique().sparse().named("uniq_active_meeting_session"));
            mongoTemplate.indexOps("meeting_sessions").createIndex(
                    new Index().on("organizationId", Sort.Direction.ASC).on("createdAt", Sort.Direction.DESC)
                            .named("org_created"));
            mongoTemplate.indexOps("meeting_integrations").createIndex(
                    new Index().on("organizationId", Sort.Direction.ASC).on("provider", Sort.Direction.ASC)
                            .unique().named("uniq_org_provider"));
            mongoTemplate.indexOps("meeting_assistant_settings").createIndex(
                    new Index().on("organizationId", Sort.Direction.ASC).unique().named("uniq_org_settings"));
        } catch (Exception e) {
            // Never block application startup on an index problem; the service also handles
            // duplicates defensively. Log the type only — no data.
            log.error("Meeting assistant index creation failed: {}", e.getClass().getSimpleName());
        }
    }
}

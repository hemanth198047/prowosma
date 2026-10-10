package com.prowosma.backend.config;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.event.ContextRefreshedEvent;
import org.springframework.context.event.EventListener;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.index.Index;
import org.springframework.data.mongodb.core.query.Criteria;

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
                    new Index().on("firefliesClaimKey", Sort.Direction.ASC).unique().sparse().named("uniq_fireflies_claim"));
            mongoTemplate.indexOps("meeting_sessions").createIndex(
                    new Index().on("organizationId", Sort.Direction.ASC).on("createdAt", Sort.Direction.DESC)
                            .named("org_created"));
            mongoTemplate.indexOps("meeting_sessions").createIndex(
                    new Index().on("organizationId", Sort.Direction.ASC).on("conferenceRecord", Sort.Direction.ASC)
                            .sparse().named("org_conference_record"));
            // Transcript text: one row per line per generation; reads walk (session, generation, seq).
            mongoTemplate.indexOps("meeting_audio_chunks").createIndex(
                    new Index().on("organizationId", Sort.Direction.ASC).on("sessionId", Sort.Direction.ASC)
                            .on("track", Sort.Direction.ASC).on("seq", Sort.Direction.ASC).unique().named("uniq_audio_chunk"));
            mongoTemplate.indexOps("meeting_audio_chunks").createIndex(
                    new Index().on("expireAt", Sort.Direction.ASC).named("audio_chunk_expiry"));
            mongoTemplate.indexOps("transcript_segments").createIndex(
                    new Index().on("organizationId", Sort.Direction.ASC).on("sessionId", Sort.Direction.ASC)
                            .on("generation", Sort.Direction.ASC).on("seq", Sort.Direction.ASC)
                            .unique().named("uniq_session_generation_seq"));
            // Job queue: one live job per (type, session); claim scans by status + runAfter.
            mongoTemplate.indexOps("meeting_jobs").createIndex(
                    new Index().on("jobKey", Sort.Direction.ASC).unique().named("uniq_job_key"));
            mongoTemplate.indexOps("meeting_jobs").createIndex(
                    new Index().on("status", Sort.Direction.ASC).on("runAfter", Sort.Direction.ASC).named("job_due"));
            mongoTemplate.indexOps("meeting_user_connections").createIndex(
                    new Index().on("organizationId", Sort.Direction.ASC).on("userEmail", Sort.Direction.ASC)
                            .on("provider", Sort.Direction.ASC).unique().named("uniq_user_connection"));
            mongoTemplate.indexOps("meeting_oauth_states").createIndex(
                    new Index().on("stateHash", Sort.Direction.ASC).unique().named("uniq_oauth_state"));
            mongoTemplate.indexOps("meeting_oauth_states").createIndex(      // sign-in attempts clean themselves up
                    new Index().on("expiresAt", Sort.Direction.ASC).expire(0).named("ttl_oauth_state"));
            mongoTemplate.indexOps("meeting_audit_events").createIndex(
                    new Index().on("organizationId", Sort.Direction.ASC).on("sessionId", Sort.Direction.ASC)
                            .on("at", Sort.Direction.DESC).named("audit_by_session"));
            mongoTemplate.indexOps("meeting_artifacts").createIndex(
                    new Index().on("organizationId", Sort.Direction.ASC).on("sessionId", Sort.Direction.ASC)
                            .on("type", Sort.Direction.ASC).on("version", Sort.Direction.ASC).unique().named("uniq_artifact_version"));
            mongoTemplate.indexOps("meeting_artifact_heads").createIndex(
                    new Index().on("organizationId", Sort.Direction.ASC).on("sessionId", Sort.Direction.ASC)
                            .on("type", Sort.Direction.ASC).unique().named("uniq_artifact_head"));
            mongoTemplate.indexOps("meeting_generations").createIndex(
                    new Index().on("organizationId", Sort.Direction.ASC).on("requestId", Sort.Direction.ASC)
                            .on("status", Sort.Direction.ASC).unique().sparse().named("uniq_generation_request"));
            mongoTemplate.indexOps("meeting_generations").createIndex(
                    new Index().on("organizationId", Sort.Direction.ASC).on("createdAt", Sort.Direction.DESC).named("generation_by_time"));
            mongoTemplate.indexOps("meeting_actions").createIndex(
                    new Index().on("organizationId", Sort.Direction.ASC).on("sessionId", Sort.Direction.ASC).on("createdAt", Sort.Direction.ASC).named("action_by_session"));
            mongoTemplate.indexOps("meeting_actions").createIndex(
                    new Index().on("organizationId", Sort.Direction.ASC).on("stableId", Sort.Direction.ASC).unique().named("uniq_action_stable_id"));
            mongoTemplate.indexOps("meeting_proposed_projects").createIndex(
                    new Index().on("organizationId", Sort.Direction.ASC).on("sessionId", Sort.Direction.ASC).named("proposed_project_by_session"));
            mongoTemplate.indexOps("meeting_extractions").createIndex(
                    new Index().on("organizationId", Sort.Direction.ASC).on("sessionId", Sort.Direction.ASC).on("status", Sort.Direction.ASC).named("extraction_by_session"));
            mongoTemplate.indexOps("meeting_creation_batches").createIndex(
                    new Index().on("organizationId", Sort.Direction.ASC).on("sessionId", Sort.Direction.ASC).on("createdAt", Sort.Direction.DESC).named("creation_batch_by_session"));
            // Duplicate-proofing at the database: one task per proposed action, one project per proposed project (only records that carry a source key).
            mongoTemplate.indexOps("tasks").createIndex(
                    new Index().on("organizationId", Sort.Direction.ASC).on("sourceActionKey", Sort.Direction.ASC).unique()
                            .partial(org.springframework.data.mongodb.core.index.PartialIndexFilter.of(Criteria.where("sourceActionKey").exists(true))).named("uniq_task_meeting_source"));
            mongoTemplate.indexOps("projects").createIndex(
                    new Index().on("organizationId", Sort.Direction.ASC).on("sourceProposalKey", Sort.Direction.ASC).unique()
                            .partial(org.springframework.data.mongodb.core.index.PartialIndexFilter.of(Criteria.where("sourceProposalKey").exists(true))).named("uniq_project_meeting_source"));
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

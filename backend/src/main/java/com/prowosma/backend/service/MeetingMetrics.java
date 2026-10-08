package com.prowosma.backend.service;

import com.prowosma.backend.model.MeetingJob;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.Set;

/**
 * Prometheus metrics for the Meeting Assistant. Tags are always from small fixed sets (job type, outcome, provider, kind) — never an
 * organization, meeting, person or error text — so cardinality stays bounded and nothing sensitive is exported.
 */
@Component
public class MeetingMetrics {

    private static final Set<String> KNOWN_TYPES = Set.of("FETCH_GOOGLE_TRANSCRIPT", "FETCH_TEAMS_TRANSCRIPT", "GENERATE_MEETING_OUTPUTS",
            "EXTRACT_MEETING_ACTIONS", "CREATE_FROM_MEETING");

    private final MeterRegistry registry;
    private final MongoTemplate mongo;

    public MeetingMetrics(MeterRegistry registry, MongoTemplate mongo) {
        this.registry = registry;
        this.mongo = mongo;
        Gauge.builder("prowosma.meeting.queue.due", this, MeetingMetrics::dueJobs)
                .description("Background jobs that are due to run now (a growing number means workers are not keeping up)").register(registry);
        Gauge.builder("prowosma.meeting.queue.oldest.due.seconds", this, MeetingMetrics::oldestDueSeconds)
                .description("How long the longest-waiting due job has been waiting").register(registry);
        Gauge.builder("prowosma.meeting.queue.expired.leases", this, MeetingMetrics::expiredLeases)
                .description("Running jobs whose worker stopped renewing the lease (crashed or stalled workers)").register(registry);
    }

    public void job(String type, String outcome, long millis) {
        String t = KNOWN_TYPES.contains(type) ? type : "OTHER";
        Counter.builder("prowosma.meeting.jobs").description("Meeting background job runs").tag("type", t).tag("outcome", outcome).register(registry).increment();
        Timer.builder("prowosma.meeting.job.duration").tag("type", t).register(registry).record(Duration.ofMillis(Math.max(0, millis)));
    }

    public void tokens(String kind, long input, long output) {
        Counter.builder("prowosma.meeting.llm.tokens").description("Language-model tokens used").tag("kind", kind).tag("direction", "input").register(registry).increment(Math.max(0, input));
        Counter.builder("prowosma.meeting.llm.tokens").tag("kind", kind).tag("direction", "output").register(registry).increment(Math.max(0, output));
    }

    public void generation(String kind, String status, long millis) {
        Timer.builder("prowosma.meeting.generation.duration").description("Time to produce documents or actions").tag("kind", kind).tag("status", status)
                .register(registry).record(Duration.ofMillis(Math.max(0, millis)));
    }

    public void sessionCreated(String provider) {
        Counter.builder("prowosma.meeting.sessions.created").tag("provider", provider == null ? "UNKNOWN" : provider).register(registry).increment();
    }

    public void transcriptReceived(String source) {
        Counter.builder("prowosma.meeting.transcripts.received").tag("source", source == null ? "UNKNOWN" : source).register(registry).increment();
    }

    private double dueJobs() {
        try {
            return mongo.count(new Query(Criteria.where("status").is("QUEUED").and("runAfter").lte(Instant.now())), MeetingJob.class);
        } catch (RuntimeException e) {
            return Double.NaN;
        }
    }

    private double oldestDueSeconds() {
        try {
            MeetingJob j = mongo.findOne(new Query(Criteria.where("status").is("QUEUED").and("runAfter").lte(Instant.now()))
                    .with(org.springframework.data.domain.Sort.by("runAfter")).limit(1), MeetingJob.class);
            return j == null ? 0 : Math.max(0, Duration.between(j.getRunAfter(), Instant.now()).toSeconds());
        } catch (RuntimeException e) {
            return Double.NaN;
        }
    }

    private double expiredLeases() {
        try {
            return mongo.count(new Query(Criteria.where("status").is("RUNNING").and("leaseUntil").lt(Instant.now())), MeetingJob.class);
        } catch (RuntimeException e) {
            return Double.NaN;
        }
    }
}

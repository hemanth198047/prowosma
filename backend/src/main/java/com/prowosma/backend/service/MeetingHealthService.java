package com.prowosma.backend.service;

import com.prowosma.backend.model.*;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;

/** One organization's operational picture for administrators: is work flowing, what is failing and why, what is the AI costing, are connections healthy. */
@Service
@RequiredArgsConstructor
public class MeetingHealthService {

    private final MongoTemplate mongo;

    public Map<String, Object> summary(String org) {
        Instant now = Instant.now(), since = now.minus(24, ChronoUnit.HOURS);
        Map<String, Object> out = new LinkedHashMap<>();

        Criteria mine = Criteria.where("organizationId").is(org);
        Map<String, Object> queue = new LinkedHashMap<>();
        queue.put("queued", mongo.count(new Query(Criteria.where("organizationId").is(org).and("status").is("QUEUED")), MeetingJob.class));
        queue.put("dueNow", mongo.count(new Query(Criteria.where("organizationId").is(org).and("status").is("QUEUED").and("runAfter").lte(now)), MeetingJob.class));
        queue.put("running", mongo.count(new Query(Criteria.where("organizationId").is(org).and("status").is("RUNNING").and("leaseUntil").gte(now)), MeetingJob.class));
        queue.put("expiredLeases", mongo.count(new Query(Criteria.where("organizationId").is(org).and("status").is("RUNNING").and("leaseUntil").lt(now)), MeetingJob.class));
        MeetingJob oldest = mongo.findOne(new Query(Criteria.where("organizationId").is(org).and("status").is("QUEUED").and("runAfter").lte(now)).with(Sort.by("runAfter")).limit(1), MeetingJob.class);
        queue.put("oldestDueSeconds", oldest == null ? 0 : Math.max(0, Duration.between(oldest.getRunAfter(), now).toSeconds()));
        out.put("queue", queue);

        List<MeetingSession> failed = mongo.find(new Query(Criteria.where("organizationId").is(org).and("status").is("FAILED").and("updatedAt").gte(since)).limit(500), MeetingSession.class);
        Map<String, Integer> byCode = new TreeMap<>();
        for (MeetingSession s : failed) byCode.merge(s.getFailureCode() == null ? "UNKNOWN" : s.getFailureCode(), 1, Integer::sum);
        List<Map<String, Object>> top = new ArrayList<>();
        byCode.entrySet().stream().sorted((a, b) -> b.getValue() - a.getValue()).limit(8).forEach(e -> top.add(Map.of("code", e.getKey(), "count", e.getValue())));
        Map<String, Object> sessions = new LinkedHashMap<>();
        sessions.put("active", mongo.count(new Query(mine).addCriteria(Criteria.where("status").nin("COMPLETED", "FAILED", "CANCELLED")), MeetingSession.class));
        sessions.put("processing", mongo.count(new Query(Criteria.where("organizationId").is(org).and("status").is("PROCESSING")), MeetingSession.class));
        sessions.put("failedLast24h", failed.size());
        sessions.put("topFailureCodes", top);
        out.put("sessions", sessions);

        long ok = 0, bad = 0, in = 0, outTok = 0;
        for (MeetingGeneration g : mongo.find(new Query(Criteria.where("organizationId").is(org).and("createdAt").gte(since)), MeetingGeneration.class)) {
            if ("SUCCEEDED".equals(g.getStatus())) ok++; else bad++;
            in += g.getInputTokens(); outTok += g.getOutputTokens();
        }
        out.put("ai", Map.of("runsLast24h", ok + bad, "failedLast24h", bad, "inputTokens", in, "outputTokens", outTok));

        List<Map<String, Object>> integrations = new ArrayList<>();
        for (MeetingIntegration i : mongo.find(new Query(mine), MeetingIntegration.class)) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("provider", i.getProvider());
            m.put("enabled", i.isEnabled());
            m.put("lastCheckedAt", i.getLastCheckedAt() == null ? null : i.getLastCheckedAt().toString());
            m.put("lastTestHealthy", i.isLastTestHealthy());
            integrations.add(m);
        }
        out.put("integrations", integrations);

        Map<String, Object> last = new LinkedHashMap<>();
        for (String src : List.of("GOOGLE_MEET", "MS_TEAMS", "UPLOAD")) {
            MeetingSession s = mongo.findOne(new Query(Criteria.where("organizationId").is(org).and("transcriptSource").is(src).and("transcriptReceivedAt").ne(null))
                    .with(Sort.by(Sort.Direction.DESC, "transcriptReceivedAt")).limit(1), MeetingSession.class);
            last.put(src, s == null ? null : s.getTranscriptReceivedAt().toString());
        }
        out.put("lastTranscriptBySource", last);
        out.put("generatedAt", now.toString());
        return out;
    }
}

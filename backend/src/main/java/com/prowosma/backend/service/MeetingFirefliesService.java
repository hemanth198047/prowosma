package com.prowosma.backend.service;

import com.prowosma.backend.integration.FirefliesApi;
import com.prowosma.backend.integration.FirefliesException;
import com.prowosma.backend.meetingassistant.ConferenceLink;
import com.prowosma.backend.meetingassistant.FirefliesMatcher;
import com.prowosma.backend.meetingassistant.FirefliesMatcher.Summary;
import com.prowosma.backend.meetingassistant.FirefliesReport;
import com.prowosma.backend.model.MeetingAssistantSettings;
import com.prowosma.backend.model.MeetingSession;
import com.prowosma.backend.repository.MeetingAssistantSettingsRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Fireflies.ai as a transcript source for ANY meeting platform it can join (Google Meet, Zoom, Teams, Webex): send its notetaker to a running meeting,
 * then bring the finished transcript back — or import a transcript Fireflies already has. Off until an admin turns it on and saves an API key.
 * Every method takes an explicit organization so background jobs can use it. Google Meet and Teams imports do not touch this class.
 */
@Service
@RequiredArgsConstructor
public class MeetingFirefliesService {

    public static final String PROVIDER = "FIREFLIES";
    /** Fireflies allows the notetaker to be sent 3 times per 20 minutes; we stop before wasting a request. */
    static final int SENDS_PER_WINDOW = 3;
    static final Duration SEND_WINDOW = Duration.ofMinutes(20);
    /** How long a sent notetaker is waited for before the meeting is marked as having no transcript. */
    public static final Duration GIVE_UP_AFTER = Duration.ofHours(6);
    /** One Fireflies request serves every waiting meeting of a workspace, so a free plan (50 requests a day) is not used up by polling. */
    static final Duration POLL_CACHE = Duration.ofMinutes(4);
    public static final int PICKER_LIMIT = 25;

    private final MongoTemplate mongo;
    private final FieldEncryptionService crypto;
    private final MeetingJobService jobs;
    private final MeetingSessionStore store;
    private final MeetingAssistantSettingsRepository settingsRepo;
    private final FirefliesApi api;

    private record Cached(List<Summary> list, Instant at) {}
    private final Map<String, Cached> cache = new ConcurrentHashMap<>();

    private static MeetingAssistantException err(HttpStatus status, String code, String message) {
        return new MeetingAssistantException(status, code, message);
    }

    // ── settings and readiness ───────────────────────────────────────────────

    public MeetingAssistantSettings settings(String org) {
        return settingsRepo.findByOrganizationId(org).orElseGet(() -> {
            MeetingAssistantSettings s = new MeetingAssistantSettings();
            s.setOrganizationId(org);
            return s;
        });
    }

    public String notReadyReason(MeetingAssistantSettings st) {
        if (!st.isFirefliesEnabled()) return "The Fireflies integration isn't turned on for this workspace. An admin can turn it on in the Fireflies settings.";
        return fetchNotReadyReason(st);
    }

    /** For meetings already in flight: switching the integration off later shouldn't strand a notetaker that is already in a meeting. */
    public String fetchNotReadyReason(MeetingAssistantSettings st) {
        if (!st.isFirefliesKeySaved()) return "No Fireflies API key is saved yet. An admin can add one in the Fireflies settings.";
        if (!crypto.isActive()) return "The Fireflies key can't be used safely because the server has no ENCRYPTION_KEY. Ask whoever runs the server to set it.";
        return null;
    }

    public String apiKey(MeetingAssistantSettings st) {
        return st.getFirefliesApiKeyEnc() == null ? null : crypto.decrypt(st.getFirefliesApiKeyEnc());
    }

    public void applySettingsPatch(Map<String, Object> patch, MeetingAssistantSettings s) {
        if (Boolean.parseBoolean(String.valueOf(patch.get("clearFirefliesApiKey")))) s.setFirefliesApiKeyEnc(null);
        if (patch.containsKey("firefliesApiKey") && patch.get("firefliesApiKey") != null && !String.valueOf(patch.get("firefliesApiKey")).isBlank()) {
            String key = String.valueOf(patch.get("firefliesApiKey")).trim();
            if (key.length() > 300 || key.chars().anyMatch(c -> Character.isWhitespace(c) || Character.isISOControl(c)))
                throw err(HttpStatus.BAD_REQUEST, "INVALID_FIREFLIES_KEY", "That doesn't look like a Fireflies API key (no spaces, and not too long).");
            if (!crypto.isActive())
                throw err(HttpStatus.CONFLICT, "ENCRYPTION_REQUIRED", "The server has no ENCRYPTION_KEY, so the key can't be stored safely. Ask whoever runs the server to set it.");
            s.setFirefliesApiKeyEnc(crypto.encrypt(key));
        }
        if (patch.containsKey("firefliesEnabled")) s.setFirefliesEnabled(Boolean.parseBoolean(String.valueOf(patch.get("firefliesEnabled"))));
        // Only complain when THIS change touches Fireflies — an unrelated save must never be blocked by it.
        boolean touched = patch.keySet().stream().anyMatch(k -> k.toLowerCase(Locale.ROOT).startsWith("fireflies") || k.equals("clearFirefliesApiKey"));
        if (touched && s.isFirefliesEnabled()) {
            String why = fetchNotReadyReason(s);
            if (why != null) throw err(HttpStatus.CONFLICT, "FIREFLIES_NOT_READY", why);
        }
    }

    public Map<String, Object> testConnection(MeetingAssistantSettings st) {
        Map<String, Object> out = new LinkedHashMap<>();
        String why = fetchNotReadyReason(st);
        if (why != null) { out.put("ok", false); out.put("message", why); return out; }
        try {
            FirefliesApi.Account a = api.account(apiKey(st));
            out.put("ok", true);
            out.put("message", "Connected to Fireflies" + (a.email() == null ? "." : " as " + a.email() + "."));
        } catch (FirefliesException e) {
            out.put("ok", false);
            out.put("message", e.getMessage());
        }
        return out;
    }

    /** Fireflies failures as the plain errors the API returns to the browser. */
    public static MeetingAssistantException toApiError(FirefliesException e) {
        return switch (e.getKind()) {
            case AUTH -> err(HttpStatus.CONFLICT, "FIREFLIES_KEY_REJECTED", "Fireflies rejected the saved API key. An admin needs to enter a new one.");
            case PLAN -> err(HttpStatus.CONFLICT, "FIREFLIES_PLAN", e.getMessage());
            case RATE_LIMITED -> err(HttpStatus.TOO_MANY_REQUESTS, "FIREFLIES_RATE_LIMITED", "Fireflies' request limit was reached. Try again in a few minutes.");
            case UNSUPPORTED_PLATFORM -> err(HttpStatus.BAD_REQUEST, "UNSUPPORTED_PLATFORM", "Fireflies can't join that kind of meeting. It works with Google Meet, Zoom, Microsoft Teams and Webex.");
            case BAD_REQUEST -> err(HttpStatus.CONFLICT, "MEETING_NOT_RUNNING", e.getMessage());
            case NOT_FOUND -> err(HttpStatus.NOT_FOUND, "FIREFLIES_NOT_FOUND", e.getMessage());
            default -> err(HttpStatus.SERVICE_UNAVAILABLE, "FIREFLIES_UNAVAILABLE", "Fireflies didn't answer just now. Please try again in a moment.");
        };
    }

    // ── sending the notetaker ────────────────────────────────────────────────

    /** Sends Fireflies' notetaker into the (running) meeting of this session and starts waiting for its transcript. */
    public void sendNotetaker(MeetingSession s, ConferenceLink.Link link, String title, String requestedBy) {
        String org = s.getOrganizationId();
        MeetingAssistantSettings st = settings(org);
        long recent = mongo.count(new Query(Criteria.where("organizationId").is(org).and("notetakerSentAt").gte(Instant.now().minus(SEND_WINDOW))), MeetingSession.class);
        if (recent >= SENDS_PER_WINDOW)
            throw err(HttpStatus.TOO_MANY_REQUESTS, "NOTETAKER_LIMIT", "Fireflies allows the notetaker to be sent 3 times every 20 minutes. Please wait a few minutes and try again.");
        try {
            api.addToLiveMeeting(apiKey(st), link.url(), title);
        } catch (FirefliesException e) {
            throw toApiError(e);
        }
        Instant now = Instant.now();
        mongo.updateFirst(new Query(Criteria.where("_id").is(s.getId()).and("organizationId").is(org)),
                new Update().set("firefliesState", "SENT").set("notetakerSentAt", now).set("platform", link.platform()), MeetingSession.class);
        cache.remove(org);
        FirefliesReport.Report r = FirefliesReport.sent(link.platform());
        store.recordCheck(org, s.getId(), r.code(), r.message(), r.facts());
        jobs.enqueue(org, s.getId(), FirefliesTranscriptFetchHandler.TYPE, requestedBy, now.plusSeconds(180), now.plus(GIVE_UP_AFTER).plus(Duration.ofHours(1)));
    }

    /** Waiting again after a failure: the notetaker is still where it was, so only the transcript search restarts. */
    public void resumeWaiting(MeetingSession s, String requestedBy) {
        Instant now = Instant.now();
        mongo.updateFirst(new Query(Criteria.where("_id").is(s.getId()).and("organizationId").is(s.getOrganizationId())), new Update().set("notetakerSentAt", now), MeetingSession.class);
        cache.remove(s.getOrganizationId());
        jobs.enqueue(s.getOrganizationId(), s.getId(), FirefliesTranscriptFetchHandler.TYPE, requestedBy, now, now.plus(GIVE_UP_AFTER).plus(Duration.ofHours(1)));
    }

    // ── finding transcripts ──────────────────────────────────────────────────

    /** Recent transcripts, shared between all waiting meetings of the workspace for a few minutes. */
    public List<Summary> recentCached(String org, String apiKey) {
        Cached c = cache.get(org);
        if (c != null && Duration.between(c.at(), Instant.now()).compareTo(POLL_CACHE) < 0) return c.list();
        List<Summary> fresh = api.recent(apiKey, PICKER_LIMIT);
        cache.put(org, new Cached(fresh, Instant.now()));
        return fresh;
    }

    public Optional<FirefliesApi.Transcript> transcript(String apiKey, String id) {
        return api.transcript(apiKey, id);
    }

    static String claimKey(String org, String transcriptId) { return org + "|ff|" + transcriptId; }

    public boolean isClaimed(String org, String transcriptId) {
        return mongo.exists(new Query(Criteria.where("firefliesClaimKey").is(claimKey(org, transcriptId))), MeetingSession.class);
    }

    /** Reserves a transcript for a meeting. The database refuses a second claim, so two checks at once can never import one transcript twice. */
    public boolean claim(String org, String sessionId, String transcriptId) {
        try {
            mongo.updateFirst(new Query(Criteria.where("_id").is(sessionId).and("organizationId").is(org)), new Update().set("firefliesClaimKey", claimKey(org, transcriptId)), MeetingSession.class);
            return true;
        } catch (DuplicateKeyException taken) {
            return false;
        }
    }

    public void markImported(String org, String sessionId) {
        mongo.updateFirst(new Query(Criteria.where("_id").is(sessionId).and("organizationId").is(org)), new Update().set("firefliesState", "IMPORTED"), MeetingSession.class);
    }

    /** The picker: the workspace's recent Fireflies meetings, each marked if it was already imported. */
    public List<Map<String, Object>> recentForPicker(String org) {
        MeetingAssistantSettings st = settings(org);
        List<Summary> list = FirefliesMatcher.newestFirst(api.recent(apiKey(st), PICKER_LIMIT));
        List<Map<String, Object>> out = new ArrayList<>();
        for (Summary s : list) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", s.id());
            m.put("title", s.title() == null || s.title().isBlank() ? "Untitled meeting" : s.title());
            m.put("date", s.date() == null ? null : s.date().toString());
            m.put("live", s.live());
            String platform = null;
            try { platform = ConferenceLink.parse(s.meetingLink()).platform(); } catch (RuntimeException ignored) { /* a link we don't recognise */ }
            m.put("platform", platform);
            m.put("imported", isClaimed(org, s.id()));
            out.add(m);
        }
        return out;
    }
}

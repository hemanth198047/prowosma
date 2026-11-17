package com.prowosma.backend.uma.core;

import com.prowosma.backend.integration.FirefliesApi;
import com.prowosma.backend.integration.FirefliesException;
import com.prowosma.backend.meetingassistant.FirefliesMapper;
import com.prowosma.backend.meetingassistant.FirefliesMatcher;
import com.prowosma.backend.repository.MeetingAssistantSettingsRepository;
import com.prowosma.backend.service.FieldEncryptionService;
import com.prowosma.backend.uma.model.UmaMeeting;
import com.prowosma.backend.uma.model.UmaSegment;
import com.prowosma.backend.uma.model.UmaSettings;
import com.prowosma.backend.uma.model.UmaStatus;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.*;

/**
 * Fireflies.ai for the AI Meeting Assistant: import a Fireflies transcript, or send the Fireflies notetaker into a running meeting and
 * fetch its transcript afterwards. Uses the existing Fireflies client and matcher unchanged.
 * Which key: the one an admin saved here (encrypted), else the server's {@code app.uma.fireflies.api-key}, else the key saved for the
 * existing Meeting Assistant when Fireflies is switched on there (read only).
 */
@Component
public class UmaFireflies {
    private final FirefliesApi api;
    private final MongoTemplate mongo;
    private final FieldEncryptionService crypto;
    private final MeetingAssistantSettingsRepository legacySettings;
    private final UmaStore store;

    @Value("${app.uma.fireflies.api-key:}") private String operatorKey = "";

    public UmaFireflies(FirefliesApi api, MongoTemplate mongo, FieldEncryptionService crypto,
                        MeetingAssistantSettingsRepository legacySettings, UmaStore store) {
        this.api = api; this.mongo = mongo; this.crypto = crypto; this.legacySettings = legacySettings; this.store = store;
    }

    public record KeySource(String key, String source) {}

    public Optional<KeySource> key(String org) {
        UmaSettings s = mongo.findById(org, UmaSettings.class);
        if (s != null && s.getFirefliesKeyEnc() != null) {
            String k = crypto.decrypt(s.getFirefliesKeyEnc());
            if (k != null && !k.isBlank()) return Optional.of(new KeySource(k, "WORKSPACE"));
        }
        if (operatorKey != null && !operatorKey.isBlank()) return Optional.of(new KeySource(operatorKey.trim(), "SERVER"));
        return legacySettings.findByOrganizationId(org)
                .filter(x -> x.isFirefliesEnabled() && x.isFirefliesKeySaved())
                .map(x -> crypto.decrypt(x.getFirefliesApiKeyEnc()))
                .filter(k -> k != null && !k.isBlank())
                .map(k -> new KeySource(k, "MEETING_ASSISTANT"));
    }

    private String requireKey(String org) {
        return key(org).map(KeySource::key).orElseThrow(() -> new UmaException(HttpStatus.FAILED_DEPENDENCY, "NO_FIREFLIES",
                "Fireflies isn't connected for this workspace.", "An admin can add the Fireflies API key under Connections on the AI Meeting Assistant page."));
    }

    public Map<String, Object> status(String org) {
        Map<String, Object> r = new LinkedHashMap<>();
        Optional<KeySource> k = key(org);
        r.put("connected", k.isPresent());
        r.put("source", k.map(KeySource::source).orElse(null));
        UmaSettings s = mongo.findById(org, UmaSettings.class);
        if (s != null && s.getFirefliesKeyEnc() != null) {
            r.put("account", s.getFirefliesAccountName());
            r.put("accountEmail", s.getFirefliesAccountEmail());
            r.put("savedAt", s.getFirefliesSavedAt());
        }
        r.put("canSaveKey", crypto.isActive());
        return r;
    }

    /** Checks the key with Fireflies first, then stores it encrypted. */
    public Map<String, Object> saveKey(String org, String key, String by) {
        if (key == null || key.isBlank()) throw new UmaException(HttpStatus.BAD_REQUEST, "EMPTY_KEY", "Paste the Fireflies API key.");
        if (!crypto.isActive())
            throw new UmaException(HttpStatus.CONFLICT, "NO_ENCRYPTION", "The server can't store secrets safely yet.",
                    "Set ENCRYPTION_KEY on the server (see the setup guide), or set UMA_FIREFLIES_API_KEY instead.");
        FirefliesApi.Account acc;
        try { acc = api.account(key.trim()); } catch (FirefliesException e) { throw toUma(e); }
        UmaSettings s = Optional.ofNullable(mongo.findById(org, UmaSettings.class)).orElseGet(() -> { UmaSettings n = new UmaSettings(); n.setId(org); return n; });
        s.setFirefliesKeyEnc(crypto.encrypt(key.trim()));
        s.setFirefliesAccountName(acc.name());
        s.setFirefliesAccountEmail(acc.email());
        s.setFirefliesSavedBy(by);
        s.setFirefliesSavedAt(Instant.now());
        mongo.save(s);
        return status(org);
    }

    public Map<String, Object> removeKey(String org) {
        UmaSettings s = mongo.findById(org, UmaSettings.class);
        if (s != null) {
            s.setFirefliesKeyEnc(null); s.setFirefliesAccountName(null); s.setFirefliesAccountEmail(null);
            mongo.save(s);
        }
        return status(org);
    }

    /** Recent Fireflies meetings, newest first, marked when already imported into this workspace. */
    public List<Map<String, Object>> recent(String org) {
        List<FirefliesMatcher.Summary> list;
        try { list = FirefliesMatcher.newestFirst(api.recent(requireKey(org), 25)); } catch (FirefliesException e) { throw toUma(e); }
        Set<String> imported = importedIds(org);
        List<Map<String, Object>> out = new ArrayList<>();
        for (FirefliesMatcher.Summary s : list) {
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("id", s.id()); r.put("title", s.title()); r.put("date", s.date()); r.put("meetingLink", s.meetingLink());
            r.put("live", s.live()); r.put("imported", imported.contains(s.id()));
            out.add(r);
        }
        return out;
    }

    private Set<String> importedIds(String org) {
        Set<String> ids = new HashSet<>();
        Query q = new Query(Criteria.where("organizationId").is(org).and("fireflies.transcriptId").ne(null));
        q.fields().include("fireflies.transcriptId");
        for (UmaMeeting m : mongo.find(q, UmaMeeting.class)) ids.add(m.getFireflies().getTranscriptId());
        return ids;
    }

    public boolean alreadyImported(String org, String transcriptId) { return importedIds(org).contains(transcriptId); }

    public Optional<FirefliesApi.Transcript> transcript(String org, String id) {
        try { return api.transcript(requireKey(org), id); } catch (FirefliesException e) { throw toUma(e); }
    }

    public void sendNotetaker(String org, String meetingUrl, String title) {
        try { api.addToLiveMeeting(requireKey(org), meetingUrl, title); } catch (FirefliesException e) { throw toUma(e); }
    }

    /** After the meeting: the Fireflies transcript that belongs to this meeting's link, if it is ready. */
    public FirefliesMatcher.Decision findForMeeting(UmaMeeting m) {
        List<FirefliesMatcher.Summary> list;
        try { list = api.recent(requireKey(m.getOrganizationId()), 50); } catch (FirefliesException e) { throw toUma(e); }
        Set<String> taken = importedIds(m.getOrganizationId());
        Instant anchor = m.getFireflies() != null && m.getFireflies().getNotetakerSentAt() != null ? m.getFireflies().getNotetakerSentAt() : m.getMeetingAt();
        return FirefliesMatcher.pick(list, com.prowosma.backend.meetingassistant.ConferenceLink.keyOf(m.getMeetingUrl()), anchor, taken::contains, m.getTitle());
    }

    /** Stores the transcript's lines on the meeting and hands it to the analysis step. */
    public int apply(UmaMeeting m, FirefliesApi.Transcript t, String by) {
        String org = m.getOrganizationId();
        List<UmaSegment> segs = new ArrayList<>();
        int seq = 0;
        boolean speakers = false;
        for (FirefliesMapper.Line l : FirefliesMapper.toLines(t.sentences(), t.durationMinutes())) {
            UmaSegment u = new UmaSegment();
            u.setOrganizationId(org); u.setMeetingId(m.getId()); u.setSeq(++seq);
            u.setStartMs(l.startMs()); u.setEndMs(l.endMs()); u.setSpeaker(l.speaker()); u.setText(l.text());
            if (l.speaker() != null) speakers = true;
            segs.add(u);
        }
        if (segs.isEmpty()) throw new UmaException(HttpStatus.UNPROCESSABLE_CONTENT, "NO_TEXT",
                "Fireflies didn't share a transcript for that meeting.",
                "In Fireflies, check the meeting has a transcript and is shared with the team (or with the person whose API key is connected), then try again.");
        store.replaceSegments(org, m.getId(), segs);
        UmaMeeting.FirefliesLink f = m.getFireflies() == null ? new UmaMeeting.FirefliesLink() : m.getFireflies();
        f.setTranscriptId(t.id());
        m.setFireflies(f);
        if (m.getMeetingUrl() == null && t.meetingLink() != null) m.setMeetingUrl(t.meetingLink());
        UmaMeeting.TranscriptInfo info = new UmaMeeting.TranscriptInfo();
        info.setOrigin("FIREFLIES"); info.setEngine("Fireflies.ai"); info.setSegmentCount(segs.size());
        info.setSpeakersKnown(speakers); info.setUpdatedAt(Instant.now());
        m.setTranscript(info);
        m.setProgressPercent(80);
        store.save(m);
        store.transition(org, m.getId(), UmaStatus.ANALYZING, by, "Writing the summary and finding decisions and actions…", "Fireflies transcript");
        store.audit(org, m.getId(), by, "FIREFLIES_IMPORTED", segs.size() + " lines");
        return segs.size();
    }

    public static UmaException toUma(FirefliesException e) {
        HttpStatus st = switch (e.getKind()) {
            case AUTH -> HttpStatus.BAD_REQUEST;
            case PLAN -> HttpStatus.FORBIDDEN;
            case NOT_FOUND -> HttpStatus.NOT_FOUND;
            case RATE_LIMITED -> HttpStatus.TOO_MANY_REQUESTS;
            case TRANSIENT -> HttpStatus.SERVICE_UNAVAILABLE;
            default -> HttpStatus.BAD_GATEWAY;
        };
        String hint = switch (e.getKind()) {
            case AUTH -> "Check the API key in Fireflies (Settings → Developer settings) and save it again.";
            case PLAN -> "Fireflies' API needs a paid plan, and the key must belong to an active member of the team.";
            case RATE_LIMITED, TRANSIENT -> "Try again in a few minutes.";
            case UNSUPPORTED_PLATFORM -> "Fireflies joins Google Meet, Zoom, Teams and Webex links.";
            default -> null;
        };
        return new UmaException(st, "FIREFLIES_" + e.getKind().name(), e.getMessage(), hint);
    }
}

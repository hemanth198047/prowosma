package com.prowosma.backend.service;

import com.mongodb.client.gridfs.model.GridFSFile;
import com.prowosma.backend.integration.OpenAiCompatibleSttClient;
import com.prowosma.backend.integration.OutboundUrlPolicy;
import com.prowosma.backend.integration.SpeechToTextClient;
import com.prowosma.backend.integration.SttException;
import com.prowosma.backend.meetingassistant.RecordingRules;
import com.prowosma.backend.model.MeetingAssistantSettings;
import com.prowosma.backend.model.MeetingAudioChunk;
import com.prowosma.backend.model.MeetingSession;
import com.prowosma.backend.repository.MeetingAssistantSettingsRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.bson.Document;
import org.bson.types.ObjectId;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.data.mongodb.gridfs.GridFsTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.regex.Pattern;

/**
 * Meeting recordings: audio arrives in short self-contained pieces (or as one uploaded file), is stored ENCRYPTED, is turned into text by the
 * speech-to-text server an admin configured, and is then deleted — after the admin's retention time (24 hours unless changed), so a failure can be
 * retried. Every method takes an explicit organization, so background jobs can use it without a request context.
 *
 * Nothing here is used unless an admin turned recording on; Google Meet and Teams imports do not touch this class.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class MeetingRecordingService {

    public static final String PROVIDER = "RECORDING";
    /** Whatever the admin chose, audio never waits less than this for a first attempt to succeed (relevant when "delete right after success" is on). */
    static final int MIN_FAILURE_WINDOW_HOURS = 24;
    /** Safety net while a recording is still being made: audio of an abandoned recording is removed after this long at the latest. */
    static final Duration IN_PROGRESS_SAFETY = Duration.ofHours(RecordingRules.MAX_RETENTION_HOURS);

    private static final Pattern MODEL = Pattern.compile("^[A-Za-z0-9._:/@-]{1,120}$");
    private static final Pattern LANGUAGE = Pattern.compile("^[a-z]{2,3}(-[A-Za-z]{2,4})?$");

    private final MongoTemplate mongo;
    private final GridFsTemplate gridFs;
    private final FieldEncryptionService crypto;
    private final MeetingJobService jobs;
    private final MeetingAssistantSettingsRepository settingsRepo;
    private final SpeechToTextClient stt;

    private volatile Instant lastOrphanSweep = Instant.EPOCH;

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

    /** Why people can't record yet, in plain words — or null when they can. */
    public String notReadyReason(MeetingAssistantSettings st) {
        if (!st.isRecordingEnabled()) return "Recording isn't turned on for this workspace. An admin can turn it on in the recording settings.";
        return transcriptionNotReadyReason(st);
    }

    /** For audio that already exists: recording may have been switched off since, but the audio can still be turned into text. */
    public String transcriptionNotReadyReason(MeetingAssistantSettings st) {
        if (st.getSttBaseUrl() == null || st.getSttBaseUrl().isBlank())
            return "No speech-to-text server is set up yet. An admin can add one in the recording settings.";
        if (!crypto.isActive())
            return "Recordings can't be stored safely because the server has no ENCRYPTION_KEY. Ask whoever runs the server to set it.";
        return null;
    }

    public SpeechToTextClient.Settings sttSettings(MeetingAssistantSettings st) {
        String key = st.getSttApiKeyEnc() == null ? null : crypto.decrypt(st.getSttApiKeyEnc());
        return new SpeechToTextClient.Settings(st.getSttBaseUrl(), key, st.getSttModel(), st.getSttLanguage());
    }

    /** Applies the recording-related fields of an admin's settings change. Validates everything; never stores or returns a key in the clear. */
    public void applySettingsPatch(Map<String, Object> patch, MeetingAssistantSettings s) {
        if (patch.containsKey("sttBaseUrl")) {
            String v = patch.get("sttBaseUrl") == null ? "" : String.valueOf(patch.get("sttBaseUrl")).trim();
            if (v.isEmpty()) s.setSttBaseUrl(null);
            else {
                if (v.length() > 300) throw err(HttpStatus.BAD_REQUEST, "INVALID_STT_URL", "That address is too long.");
                try {
                    OutboundUrlPolicy.parseHttps(v, "The speech-to-text address");
                } catch (IllegalArgumentException e) {
                    throw err(HttpStatus.BAD_REQUEST, "INVALID_STT_URL", e.getMessage() + ". Use the https address of your speech-to-text server.");
                }
                while (v.endsWith("/")) v = v.substring(0, v.length() - 1);
                s.setSttBaseUrl(v);
            }
        }
        if (Boolean.parseBoolean(String.valueOf(patch.get("clearSttApiKey")))) s.setSttApiKeyEnc(null);
        if (patch.containsKey("sttApiKey") && patch.get("sttApiKey") != null && !String.valueOf(patch.get("sttApiKey")).isBlank()) {
            String key = String.valueOf(patch.get("sttApiKey")).trim();
            if (key.length() > 500) throw err(HttpStatus.BAD_REQUEST, "INVALID_STT_KEY", "That key is too long.");
            if (!crypto.isActive())
                throw err(HttpStatus.CONFLICT, "ENCRYPTION_REQUIRED", "The server has no ENCRYPTION_KEY, so the key can't be stored safely. Ask whoever runs the server to set it.");
            s.setSttApiKeyEnc(crypto.encrypt(key));
        }
        if (patch.containsKey("sttModel")) {
            String v = patch.get("sttModel") == null ? "" : String.valueOf(patch.get("sttModel")).trim();
            if (!v.isEmpty() && !MODEL.matcher(v).matches()) throw err(HttpStatus.BAD_REQUEST, "INVALID_STT_MODEL", "The model name can use letters, digits and . _ : / @ -");
            s.setSttModel(v.isEmpty() ? null : v);
        }
        if (patch.containsKey("sttLanguage")) {
            String v = patch.get("sttLanguage") == null ? "" : String.valueOf(patch.get("sttLanguage")).trim();
            if (!v.isEmpty() && !LANGUAGE.matcher(v).matches()) throw err(HttpStatus.BAD_REQUEST, "INVALID_STT_LANGUAGE", "Use a language code such as en, fr or pt-BR, or leave it empty to detect automatically.");
            s.setSttLanguage(v.isEmpty() ? null : v);
        }
        if (patch.containsKey("audioRetentionHours")) {
            int h;
            try {
                double d = Double.parseDouble(String.valueOf(patch.get("audioRetentionHours")));
                if (!Double.isFinite(d)) throw new NumberFormatException();          // "NaN" must not quietly become 0 = "delete immediately"
                h = (int) d;
            } catch (NumberFormatException e) { throw err(HttpStatus.BAD_REQUEST, "INVALID_RETENTION", "Audio retention must be a number of hours."); }
            if (h < 0 || h > RecordingRules.MAX_RETENTION_HOURS)
                throw err(HttpStatus.BAD_REQUEST, "INVALID_RETENTION", "Audio can be kept for 0 to " + RecordingRules.MAX_RETENTION_HOURS + " hours (0 deletes it as soon as it has been turned into text).");
            s.setAudioRetentionHours(h);
        }
        if (patch.containsKey("recordingEnabled")) s.setRecordingEnabled(Boolean.parseBoolean(String.valueOf(patch.get("recordingEnabled"))));
        // Only complain when THIS change touches recording — an unrelated save (the assistant's name, say) must never be blocked by it.
        boolean touched = patch.keySet().stream().anyMatch(k -> k.startsWith("stt") || k.equals("recordingEnabled") || k.equals("clearSttApiKey") || k.equals("audioRetentionHours"));
        if (touched && s.isRecordingEnabled()) {
            String why = transcriptionNotReadyReason(s);
            if (why != null) throw err(HttpStatus.CONFLICT, "RECORDING_NOT_READY", why);
        }
    }

    /** "Test connection": sends one second of silence to the configured server and says plainly what happened. */
    public Map<String, Object> testConnection(MeetingAssistantSettings st) {
        Map<String, Object> out = new LinkedHashMap<>();
        String why = transcriptionNotReadyReason(st);
        if (why != null) { out.put("ok", false); out.put("message", why); return out; }
        try {
            stt.transcribe(sttSettings(st), OpenAiCompatibleSttClient.silentWav(), "audio/wav", "test.wav");
            out.put("ok", true);
            out.put("message", "The speech-to-text server answered correctly.");
        } catch (SttException e) {
            out.put("ok", false);
            out.put("message", e.getMessage());
        }
        return out;
    }

    // ── recording a meeting ──────────────────────────────────────────────────

    private void updateSession(String org, String sessionId, Update u) {
        mongo.updateFirst(new Query(Criteria.where("_id").is(sessionId).and("organizationId").is(org)), u, MeetingSession.class);
    }

    private static boolean acceptsAudio(MeetingSession s) {
        return "SCHEDULED".equals(s.getStatus()) || "AWAITING_TRANSCRIPT".equals(s.getStatus());
    }

    /** Marks the meeting as being recorded. Idempotent while it is being recorded; a meeting that already has finished audio is refused. */
    public void start(MeetingSession s) {
        if (!acceptsAudio(s)) throw err(HttpStatus.CONFLICT, "INVALID_STATE", "This meeting isn't waiting for a transcript, so it can't be recorded.");
        if (s.isSimulated()) throw err(HttpStatus.BAD_REQUEST, "SIMULATED", "Simulated meetings can't be recorded.");
        String state = s.getRecordingState();
        if (state != null && !"RECORDING".equals(state) && !"DELETED".equals(state) && !"EXPIRED".equals(state))
            throw err(HttpStatus.CONFLICT, "ALREADY_RECORDED", "This meeting already has a recording.");
        if ("RECORDING".equals(state)) return;
        updateSession(s.getOrganizationId(), s.getId(), new Update().set("recordingState", "RECORDING").set("recordingStartedAt", Instant.now())
                .unset("recordingFinishedAt").unset("audioDeletedAt").unset("audioExpiresAt"));
    }

    public MeetingAudioChunk storeChunk(MeetingSession s, String trackRaw, int seq, long startMs, long durationMs, byte[] data) {
        if (!"RECORDING".equals(s.getRecordingState())) throw err(HttpStatus.CONFLICT, "NOT_RECORDING", "This meeting isn't being recorded.");
        if (!acceptsAudio(s)) throw err(HttpStatus.CONFLICT, "INVALID_STATE", "This meeting isn't waiting for a transcript any more.");
        return store(s, trackRaw, seq, startMs, durationMs, data, RecordingRules.MAX_CHUNK_BYTES);
    }

    private MeetingAudioChunk store(MeetingSession s, String trackRaw, int seq, long startMs, long durationMs, byte[] data, long maxBytes) {
        String track = RecordingRules.track(trackRaw);
        if (track == null) throw err(HttpStatus.BAD_REQUEST, "INVALID_TRACK", "Unknown audio track.");
        if (seq < 0 || seq >= RecordingRules.MAX_CHUNKS_PER_SESSION) throw err(HttpStatus.BAD_REQUEST, "INVALID_SEQUENCE", "That recording part number isn't valid.");
        if (data == null || data.length == 0) throw err(HttpStatus.BAD_REQUEST, "EMPTY_AUDIO", "The audio was empty.");
        if (data.length > maxBytes) throw err(HttpStatus.PAYLOAD_TOO_LARGE, "AUDIO_TOO_LARGE", "That audio is larger than " + (maxBytes / 1_000_000) + " MB.");
        String kind = RecordingRules.audioKind(data);
        if (kind == null) throw err(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "NOT_AUDIO", "That doesn't look like an audio or video recording.");
        if (!crypto.isActive()) throw err(HttpStatus.CONFLICT, "ENCRYPTION_REQUIRED", "Recordings can't be stored safely because the server has no ENCRYPTION_KEY.");

        String org = s.getOrganizationId();
        List<MeetingAudioChunk> existing = mongo.find(new Query(Criteria.where("organizationId").is(org).and("sessionId").is(s.getId())), MeetingAudioChunk.class);
        MeetingAudioChunk old = null;
        long total = 0;
        int others = 0;
        for (MeetingAudioChunk c : existing) {
            if (track.equals(c.getTrack()) && c.getSeq() == seq) old = c;
            else { total += c.getSizeBytes(); others++; }
        }
        if (others >= RecordingRules.MAX_CHUNKS_PER_SESSION) throw err(HttpStatus.PAYLOAD_TOO_LARGE, "RECORDING_TOO_LONG", "This recording has reached the maximum number of parts.");
        if (total + data.length > RecordingRules.MAX_SESSION_BYTES) throw err(HttpStatus.PAYLOAD_TOO_LARGE, "RECORDING_TOO_LARGE", "This recording has reached the maximum size.");

        String newFile = putFile(org, s.getId(), kind, data);
        String oldFile = old == null ? null : old.getFileId();
        MeetingAudioChunk c = old != null ? old : new MeetingAudioChunk();
        Instant now = Instant.now();
        c.setOrganizationId(org);
        c.setSessionId(s.getId());
        c.setTrack(track);
        c.setSeq(seq);
        c.setStartMs(Math.max(0, startMs));
        c.setDurationMs(Math.max(0, durationMs));
        c.setKind(kind);
        c.setSizeBytes(data.length);
        c.setFileId(newFile);
        c.setStatus("PENDING");
        c.setAttempts(0);
        c.setError(null);
        c.setLanguage(null);
        c.setPhrases(new ArrayList<>());
        c.setTranscribedAt(null);
        c.setCreatedAt(now);
        c.setExpireAt(now.plus(IN_PROGRESS_SAFETY));
        try {
            c = mongo.save(c);
        } catch (DuplicateKeyException dup) {                    // the same part arrived twice at once; the other copy wins
            deleteFile(newFile);
            throw err(HttpStatus.CONFLICT, "CHUNK_CONFLICT", "That recording part was being saved already. Try again.");
        }
        if (oldFile != null) deleteFile(oldFile);
        return c;
    }

    /** The recording is over: set the deletion time and queue the audio to be turned into text. */
    public void finish(MeetingSession s, String requestedBy) {
        String org = s.getOrganizationId();
        long parts = mongo.count(new Query(Criteria.where("organizationId").is(org).and("sessionId").is(s.getId())), MeetingAudioChunk.class);
        if (parts == 0) throw err(HttpStatus.CONFLICT, "NO_AUDIO", "Nothing was recorded. If you shared a tab, make sure \"Share tab audio\" was ticked.");
        Instant now = Instant.now();
        int hours = RecordingRules.clampRetentionHours(settings(org).getAudioRetentionHours());
        Instant expireAt = RecordingRules.expiryAfter(now, Math.max(hours, hours == 0 ? MIN_FAILURE_WINDOW_HOURS : hours));
        mongo.updateMulti(new Query(Criteria.where("organizationId").is(org).and("sessionId").is(s.getId())), new Update().set("expireAt", expireAt), MeetingAudioChunk.class);
        updateSession(org, s.getId(), new Update().set("recordingState", "UPLOADED").set("recordingFinishedAt", now).set("audioExpiresAt", expireAt).unset("audioDeletedAt"));
        jobs.enqueue(org, s.getId(), TranscribeRecordingHandler.TYPE, requestedBy, now, expireAt);
    }

    /** A whole recording supplied as one file. */
    public void uploadFile(MeetingSession s, byte[] data, String requestedBy) {
        if (!acceptsAudio(s)) throw err(HttpStatus.CONFLICT, "INVALID_STATE", "This meeting isn't waiting for a transcript, so a recording can't be added.");
        if (s.isSimulated()) throw err(HttpStatus.BAD_REQUEST, "SIMULATED", "Simulated meetings can't receive a recording.");
        String state = s.getRecordingState();
        if (state != null && !"DELETED".equals(state) && !"EXPIRED".equals(state)) throw err(HttpStatus.CONFLICT, "ALREADY_RECORDED", "This meeting already has a recording.");
        store(s, RecordingRules.TRACK_MIXED, 0, 0, 0, data, RecordingRules.MAX_UPLOAD_BYTES);
        updateSession(s.getOrganizationId(), s.getId(), new Update().set("recordingState", "RECORDING").set("recordingStartedAt", Instant.now()));
        finish(s, requestedBy);
    }

    // ── what the transcription job needs ─────────────────────────────────────

    public List<MeetingAudioChunk> chunks(String org, String sessionId) {
        List<MeetingAudioChunk> list = mongo.find(new Query(Criteria.where("organizationId").is(org).and("sessionId").is(sessionId)), MeetingAudioChunk.class);
        list.sort(Comparator.comparing(MeetingAudioChunk::getTrack).thenComparingInt(MeetingAudioChunk::getSeq));
        return list;
    }

    public boolean hasAudio(String org, String sessionId) {
        return mongo.exists(new Query(Criteria.where("organizationId").is(org).and("sessionId").is(sessionId)), MeetingAudioChunk.class);
    }

    public byte[] audio(MeetingAudioChunk c) {
        return getFile(c.getFileId());
    }

    public void setState(String org, String sessionId, String state) {
        updateSession(org, sessionId, new Update().set("recordingState", state));
    }

    public void markDone(MeetingAudioChunk c, SpeechToTextClient.Result r) {
        List<MeetingAudioChunk.Phrase> phrases = new ArrayList<>();
        for (SpeechToTextClient.Segment g : r.segments()) {
            MeetingAudioChunk.Phrase p = new MeetingAudioChunk.Phrase();
            p.setStartMs(g.startMs());
            p.setEndMs(g.endMs());
            p.setText(g.text());
            p.setNoSpeechProb(g.noSpeechProb());
            phrases.add(p);
        }
        mongo.updateFirst(new Query(Criteria.where("_id").is(c.getId())), new Update().set("status", "DONE").set("phrases", phrases)
                .set("language", r.language()).set("transcribedAt", Instant.now()).unset("error"), MeetingAudioChunk.class);
        c.setStatus("DONE");
        c.setPhrases(phrases);
    }

    public void noteFailure(MeetingAudioChunk c, SttException e) {
        mongo.updateFirst(new Query(Criteria.where("_id").is(c.getId())),
                new Update().set("status", e.isTransient() ? "PENDING" : "FAILED").set("error", e.getMessage()).inc("attempts", 1), MeetingAudioChunk.class);
    }

    /** The recording became text. With "delete right after success" the audio goes now; otherwise it stays until its deletion time. */
    public void markTranscribed(String org, String sessionId) {
        int hours = RecordingRules.clampRetentionHours(settings(org).getAudioRetentionHours());
        setState(org, sessionId, "DONE");
        if (hours == 0) deleteAudio(org, sessionId);
    }

    // ── deleting audio ───────────────────────────────────────────────────────

    /** Removes all stored audio of a meeting (the transcript, if any, is separate and stays). */
    public void deleteAudio(String org, String sessionId) {
        for (MeetingAudioChunk c : chunks(org, sessionId)) {
            deleteFile(c.getFileId());
            mongo.remove(new Query(Criteria.where("_id").is(c.getId())), MeetingAudioChunk.class);
        }
        Update u = new Update().set("audioDeletedAt", Instant.now()).unset("audioExpiresAt");
        updateSession(org, sessionId, u);
    }

    /** The person asked for the audio to go. A recording not yet turned into text is cancelled; one already turned into text just loses its audio. */
    public void deleteAudioOnRequest(MeetingSession s) {
        String state = s.getRecordingState();
        deleteAudio(s.getOrganizationId(), s.getId());
        if ("RECORDING".equals(state) || "UPLOADED".equals(state) || "TRANSCRIBING".equals(state)) {
            setState(s.getOrganizationId(), s.getId(), "DELETED");
            jobs.cancelForSession(s.getOrganizationId(), s.getId());
        }
    }

    /** Housekeeping: removes audio whose time is up, ends recordings that stopped sending audio, and clears stray files. Safe to call often. */
    public int sweep() {
        int removed = 0;
        try { removed = purgeExpired(); } catch (RuntimeException e) { log.error("Audio purge failed: {}", e.getClass().getSimpleName()); }
        try { finishAbandoned(); } catch (RuntimeException e) { log.error("Abandoned-recording check failed: {}", e.getClass().getSimpleName()); }
        try { purgeOrphans(); } catch (RuntimeException e) { log.error("Orphan audio purge failed: {}", e.getClass().getSimpleName()); }
        return removed;
    }

    int purgeExpired() {
        Instant now = Instant.now();
        List<MeetingAudioChunk> due = mongo.find(new Query(Criteria.where("expireAt").lte(now)).limit(500), MeetingAudioChunk.class);
        Set<String> touched = new LinkedHashSet<>();
        for (MeetingAudioChunk c : due) {
            deleteFile(c.getFileId());
            mongo.remove(new Query(Criteria.where("_id").is(c.getId())), MeetingAudioChunk.class);
            touched.add(c.getOrganizationId() + "|" + c.getSessionId());
        }
        for (String key : touched) {
            String[] k = key.split("\\|", 2);
            if (hasAudio(k[0], k[1])) continue;
            // audio that expired before it was ever turned into text: say so, instead of leaving the meeting waiting forever
            mongo.updateFirst(new Query(Criteria.where("_id").is(k[1]).and("organizationId").is(k[0]).and("recordingState").in("UPLOADED", "TRANSCRIBING")),
                    new Update().set("recordingState", "EXPIRED"), MeetingSession.class);
            updateSession(k[0], k[1], new Update().set("audioDeletedAt", now).unset("audioExpiresAt"));
        }
        return due.size();
    }

    /** A recording whose browser went away (closed tab, lost connection) is finished automatically so what was captured isn't lost. */
    void finishAbandoned() {
        Instant now = Instant.now();
        List<MeetingSession> recording = mongo.find(new Query(Criteria.where("recordingState").is("RECORDING")).limit(100), MeetingSession.class);
        for (MeetingSession s : recording) {
            Instant last = s.getRecordingStartedAt();
            for (MeetingAudioChunk c : chunks(s.getOrganizationId(), s.getId())) if (c.getCreatedAt() != null && (last == null || c.getCreatedAt().isAfter(last))) last = c.getCreatedAt();
            if (last != null && Duration.between(last, now).compareTo(RecordingRules.ABANDONED_AFTER) < 0) continue;
            if (!hasAudio(s.getOrganizationId(), s.getId())) {
                setState(s.getOrganizationId(), s.getId(), "EXPIRED");              // nothing was ever captured
                continue;
            }
            try {
                finish(s, s.getRequestedBy());
            } catch (MeetingAssistantException e) {
                log.warn("Could not finish an abandoned recording ({})", e.getCode());
            }
        }
    }

    /** Files that lost their record (a crash between saving the audio and its record) must not linger: anything older than the longest possible retention goes. */
    void purgeOrphans() {
        Instant now = Instant.now();
        if (Duration.between(lastOrphanSweep, now).toMinutes() < 60) return;
        lastOrphanSweep = now;
        Instant cutoff = now.minus(IN_PROGRESS_SAFETY).minus(Duration.ofHours(24));
        for (GridFSFile f : gridFs.find(new Query(Criteria.where("filename").regex("^meeting-audio\\.").and("uploadDate").lt(Date.from(cutoff))).limit(200))) {
            String hex = f.getObjectId().toHexString();
            if (!mongo.exists(new Query(Criteria.where("fileId").is(hex)), MeetingAudioChunk.class)) deleteFile(hex);
        }
    }

    // ── encrypted file storage ───────────────────────────────────────────────

    private String putFile(String org, String sessionId, String kind, byte[] plain) {
        byte[] enc = crypto.encryptBytes(plain);
        Document meta = new Document("organizationId", org).append("sessionId", sessionId);
        ObjectId id = gridFs.store(new ByteArrayInputStream(enc), "meeting-audio." + kind, RecordingRules.mimeOf(kind), meta);
        return id.toHexString();
    }

    private byte[] getFile(String fileId) {
        GridFSFile f = gridFs.findOne(new Query(Criteria.where("_id").is(new ObjectId(fileId))));
        if (f == null) throw err(HttpStatus.GONE, "AUDIO_MISSING", "The audio for this recording is no longer stored.");
        try (InputStream in = gridFs.getResource(f).getInputStream()) {
            return crypto.decryptBytes(in.readAllBytes());
        } catch (IOException e) {
            throw err(HttpStatus.INTERNAL_SERVER_ERROR, "AUDIO_UNREADABLE", "The stored audio couldn't be read.");
        }
    }

    private void deleteFile(String fileId) {
        if (fileId == null) return;
        try {
            gridFs.delete(new Query(Criteria.where("_id").is(new ObjectId(fileId))));
        } catch (RuntimeException e) {
            log.warn("Could not delete a stored audio file: {}", e.getClass().getSimpleName());
        }
    }
}

package com.prowosma.backend.uma.app;

import com.prowosma.backend.meetingassistant.TranscriptFileReader;
import com.prowosma.backend.meetingassistant.TranscriptParser;
import com.prowosma.backend.model.Task;
import com.prowosma.backend.service.FileStorageService;
import com.prowosma.backend.service.TaskService;
import com.prowosma.backend.uma.ai.MeetingIntelligence;
import com.prowosma.backend.uma.core.*;
import com.prowosma.backend.uma.model.*;
import com.prowosma.backend.uma.provider.ProviderRegistry;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.*;

/** Everything a person can do in the Universal Meeting Assistant. Every method checks the feature flag and the caller's access. */
@Service
public class UmaService {
    public static final Set<String> AUDIO_EXTENSIONS = Set.of(".mp3", ".wav", ".m4a", ".mp4", ".webm", ".ogg", ".oga", ".opus", ".aac", ".flac", ".mov", ".mkv", ".mpeg", ".mpga");

    private final UmaFeature feature;
    private final UmaAccess access;
    private final UmaStore store;
    private final UmaJobQueue queue;
    private final ProviderRegistry providers;
    private final FileStorageService files;
    private final TaskService tasks;
    private final MeetingIntelligence intelligence;
    private final UmaTranscriber transcriber;
    private final MongoTemplate mongo;

    @Value("${app.uma.max-upload-mb:500}") private long maxUploadMb = 500;
    @Value("${app.uma.recording-retention-hours:24}") private int retentionHours = 24;

    public UmaService(UmaFeature feature, UmaAccess access, UmaStore store, UmaJobQueue queue, ProviderRegistry providers,
                      FileStorageService files, TaskService tasks, MeetingIntelligence intelligence, UmaTranscriber transcriber, MongoTemplate mongo) {
        this.feature = feature; this.access = access; this.store = store; this.queue = queue; this.providers = providers;
        this.files = files; this.tasks = tasks; this.intelligence = intelligence; this.transcriber = transcriber; this.mongo = mongo;
    }

    public record Ctx(String org, UmaAccess.Caller caller) {}

    public Ctx ctx(String org, String email) {
        feature.require(org);
        return new Ctx(org, access.caller(org, email));
    }

    private UmaMeeting readable(Ctx c, String id) {
        UmaMeeting m = store.meeting(c.org(), id).orElse(null);
        access.requireRead(m, c.caller());
        return m;
    }

    private UmaMeeting manageable(Ctx c, String id) {
        UmaMeeting m = store.meeting(c.org(), id).orElse(null);
        access.requireManage(m, c.caller());
        return m;
    }

    // ── status / dashboard ────────────────────────────────────────────────

    public Map<String, Object> readiness(String org) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("enabled", feature.isOn(org));
        String stt = transcriber.notReadyReason(org);
        String ai = intelligence.notReadyReason(org);
        r.put("transcriptionReady", stt == null);
        r.put("transcriptionReason", stt);
        r.put("aiReady", ai == null);
        r.put("aiReason", ai);
        r.put("audioSplitting", AudioSplitter.ffmpegAvailable());
        r.put("maxUploadMb", maxUploadMb);
        return r;
    }

    public Map<String, Object> dashboard(Ctx c) {
        List<UmaMeeting> visible = store.meetings(c.org(), 300).stream().filter(m -> access.canRead(m, c.caller())).toList();
        Instant now = Instant.now();
        List<Map<String, Object>> upcoming = new ArrayList<>(), inProgress = new ArrayList<>(), review = new ArrayList<>(),
                failed = new ArrayList<>(), recent = new ArrayList<>(), pendingActions = new ArrayList<>();
        for (UmaMeeting m : visible) {
            Map<String, Object> row = summary(m);
            if (m.getStatus() == UmaStatus.CREATED && m.getMeetingAt() != null && m.getMeetingAt().isAfter(now)) upcoming.add(row);
            else if (m.getStatus().isWorking()) inProgress.add(row);
            else if (m.getStatus() == UmaStatus.FAILED) failed.add(row);
            else if (m.getStatus() == UmaStatus.REVIEW_READY) review.add(row);
            if (m.getStatus() != UmaStatus.CANCELLED && recent.size() < 20) recent.add(row);
            if (m.getStatus() == UmaStatus.REVIEW_READY && pendingActions.size() < 25) {
                store.insights(c.org(), m.getId()).ifPresent(ins -> ins.getActions().stream()
                        .filter(a -> "PENDING".equals(a.getStatus())).limit(25 - pendingActions.size())
                        .forEach(a -> pendingActions.add(Map.of("meetingId", m.getId(), "meetingTitle", m.getTitle(), "action", a))));
            }
        }
        upcoming.sort(Comparator.comparing(r -> String.valueOf(r.get("meetingAt"))));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("upcoming", upcoming);
        out.put("inProgress", inProgress);
        out.put("awaitingReview", review);
        out.put("failed", failed);
        out.put("recent", recent);
        out.put("pendingActions", pendingActions);
        out.put("readiness", readiness(c.org()));
        out.put("canCreate", !c.caller().viewer() && !"NONE".equals(c.caller().role()));
        return out;
    }

    public Map<String, Object> summary(UmaMeeting m) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("id", m.getId());
        r.put("title", m.getTitle());
        r.put("source", m.getSource());
        r.put("provider", m.getProvider());
        r.put("status", m.getStatus());
        r.put("statusLabel", m.getStatus().label());
        r.put("statusDetail", m.getStatusDetail());
        r.put("progressPercent", m.getProgressPercent());
        r.put("meetingAt", m.getMeetingAt());
        r.put("createdAt", m.getCreatedAt());
        r.put("createdBy", m.getCreatedBy());
        r.put("durationMs", m.getRecording() == null ? null : m.getRecording().getDurationMs());
        return r;
    }

    public Map<String, Object> detail(Ctx c, String id) {
        UmaMeeting m = readable(c, id);
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("meeting", m);
        r.put("statusLabel", m.getStatus().label());
        r.put("canManage", access.canManage(m, c.caller()));
        r.put("insights", store.insights(c.org(), id).orElse(null));
        r.put("segments", store.segments(c.org(), id));
        r.put("questions", store.questions(c.org(), id));
        r.put("provider", providers.byId(m.getProvider()).map(p -> Map.of("id", p.id(), "name", p.displayName(), "capabilities", p.capabilities())).orElse(null));
        return r;
    }

    // ── create ────────────────────────────────────────────────────────────

    private UmaMeeting newMeeting(Ctx c, String title, String source, String projectId, Instant meetingAt, String timezone) {
        access.requireCanCreate(c.caller());
        UmaMeeting m = new UmaMeeting();
        m.setOrganizationId(c.org());
        m.setTitle(cleanTitle(title));
        m.setSource(source);
        m.setProjectId(blank(projectId));
        m.setMeetingAt(meetingAt == null ? Instant.now() : meetingAt);
        m.setTimezone(blank(timezone));
        m.setCreatedBy(c.caller().email());
        return m;
    }

    public UmaMeeting uploadRecording(Ctx c, MultipartFile file, String title, String projectId, Instant meetingAt, String timezone, boolean consent) {
        UmaMeeting m = newMeeting(c, title != null && !title.isBlank() ? title : TranscriptFileReader.titleFromFilename(file == null ? null : file.getOriginalFilename()),
                "RECORDING_UPLOAD", projectId, meetingAt, timezone);
        m = store.save(m);
        try {
            return attachRecording(c, m, file, consent);
        } catch (RuntimeException e) {
            store.deleteMeeting(c.org(), m.getId());
            throw e;
        }
    }

    public UmaMeeting addRecording(Ctx c, String id, MultipartFile file, boolean consent) {
        UmaMeeting m = manageable(c, id);
        if (m.getStatus() != UmaStatus.CREATED && m.getStatus() != UmaStatus.FAILED)
            throw new UmaException(HttpStatus.CONFLICT, "HAS_CONTENT", "This meeting already has its content. Add a new meeting for another recording.");
        return attachRecording(c, m, file, consent);
    }

    private UmaMeeting attachRecording(Ctx c, UmaMeeting m, MultipartFile file, boolean consent) {
        if (!consent) throw new UmaException(HttpStatus.BAD_REQUEST, "CONSENT_REQUIRED",
                "Please confirm that everyone in the meeting knew it was being recorded and transcribed.");
        if (file == null || file.isEmpty()) throw new UmaException(HttpStatus.BAD_REQUEST, "EMPTY_FILE", "Choose a recording to upload.");
        String name = file.getOriginalFilename() == null ? "recording" : file.getOriginalFilename();
        String ext = name.contains(".") ? name.substring(name.lastIndexOf('.')).toLowerCase(Locale.ROOT) : "";
        if (!AUDIO_EXTENSIONS.contains(ext))
            throw new UmaException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "UNSUPPORTED_FORMAT",
                    "That file type isn't supported. Upload MP3, WAV, M4A, MP4, WebM, OGG, AAC, FLAC or MOV.");
        if (file.getSize() > maxUploadMb * 1024 * 1024)
            throw new UmaException(HttpStatus.CONTENT_TOO_LARGE, "FILE_TOO_LARGE", "That recording is larger than " + maxUploadMb + " MB.",
                    "Split it into parts, or export it at a lower quality (audio only is enough).");
        String key;
        try { key = files.store(file); } catch (IOException e) {
            throw new UmaException(HttpStatus.BAD_REQUEST, "UPLOAD_REJECTED", e.getMessage() == null ? "The file couldn't be stored." : e.getMessage());
        }
        UmaMeeting.Recording rec = new UmaMeeting.Recording();
        rec.setFileKey(key); rec.setFileName(name); rec.setMimeType(file.getContentType()); rec.setSizeBytes(file.getSize());
        m.setRecording(rec);
        m.setSource(m.getSource() == null ? "RECORDING_UPLOAD" : m.getSource());
        m.setConsentConfirmed(true); m.setConsentBy(c.caller().email()); m.setConsentAt(Instant.now());
        m.setProgressPercent(5);
        store.save(m);
        m = store.transition(c.org(), m.getId(), UmaStatus.QUEUED, c.caller().email(), "Waiting to be transcribed…", "recording uploaded");
        queue.enqueue(c.org(), m.getId(), UmaPipeline.TRANSCRIBE, c.caller().email());
        store.audit(c.org(), m.getId(), c.caller().email(), "RECORDING_UPLOADED", (file.getSize() / 1024) + " KB");
        return m;
    }

    public UmaMeeting importTranscript(Ctx c, String text, MultipartFile file, String title, String projectId, Instant meetingAt, String timezone) {
        String content; String hint = null; String fileName = file == null ? null : file.getOriginalFilename();
        if (file != null && !file.isEmpty()) {
            if (file.getSize() > 25L * 1024 * 1024) throw new UmaException(HttpStatus.CONTENT_TOO_LARGE, "FILE_TOO_LARGE", "That transcript file is larger than 25 MB.");
            try {
                TranscriptFileReader.Content read = TranscriptFileReader.read(file.getBytes(), fileName);
                content = read.text(); hint = read.formatHint();
            } catch (IOException e) {
                throw new UmaException(HttpStatus.BAD_REQUEST, "UNREADABLE_FILE", "That file couldn't be read.");
            } catch (RuntimeException e) {
                throw new UmaException(HttpStatus.BAD_REQUEST, "UNREADABLE_FILE", e.getMessage() == null ? "That file couldn't be read." : e.getMessage());
            }
        } else content = text;
        if (content == null || content.isBlank()) throw new UmaException(HttpStatus.BAD_REQUEST, "EMPTY_TRANSCRIPT", "Paste the transcript or choose a file.");

        TranscriptParser.Parsed parsed;
        try { parsed = TranscriptParser.parse(content, hint); }
        catch (TranscriptParser.TranscriptFormatException e) { throw new UmaException(HttpStatus.BAD_REQUEST, e.getCode(), e.getMessage()); }
        if (parsed.segments().isEmpty()) throw new UmaException(HttpStatus.BAD_REQUEST, "NO_TEXT", "No spoken text could be found in that transcript.");

        UmaMeeting m = newMeeting(c, title != null && !title.isBlank() ? title : (fileName != null ? TranscriptFileReader.titleFromFilename(fileName) : "Imported meeting"),
                "TRANSCRIPT_IMPORT", projectId, meetingAt, timezone);
        m = store.save(m);
        List<UmaSegment> segs = new ArrayList<>();
        int seq = 0;
        boolean speakers = false;
        for (TranscriptParser.Segment s : parsed.segments()) {
            UmaSegment u = new UmaSegment();
            u.setOrganizationId(c.org()); u.setMeetingId(m.getId()); u.setSeq(++seq);
            u.setStartMs(s.startMs()); u.setEndMs(s.endMs()); u.setSpeaker(blank(s.speaker())); u.setText(s.text());
            if (u.getSpeaker() != null) speakers = true;
            segs.add(u);
        }
        store.replaceSegments(c.org(), m.getId(), segs);
        UmaMeeting.TranscriptInfo info = new UmaMeeting.TranscriptInfo();
        info.setOrigin("IMPORT"); info.setSegmentCount(segs.size()); info.setSpeakersKnown(speakers); info.setUpdatedAt(Instant.now());
        info.setEngine(parsed.format());
        m.setTranscript(info);
        m.setProgressPercent(80);
        store.save(m);
        m = store.transition(c.org(), m.getId(), UmaStatus.ANALYZING, c.caller().email(), "Writing the summary and finding decisions and actions…", "transcript imported");
        queue.enqueue(c.org(), m.getId(), UmaPipeline.ANALYZE, c.caller().email());
        store.audit(c.org(), m.getId(), c.caller().email(), "TRANSCRIPT_IMPORTED", segs.size() + " lines" + (parsed.warnings().isEmpty() ? "" : ", " + parsed.warnings().size() + " warnings"));
        return m;
    }

    public UmaMeeting registerLink(Ctx c, String url, String title, String projectId, Instant meetingAt, String timezone) {
        ProviderRegistry.Detected d = providers.detect(url);
        UmaMeeting m = newMeeting(c, title != null && !title.isBlank() ? title : d.provider().displayName() + " meeting", "MEETING_LINK", projectId, meetingAt, timezone);
        m.setProvider(d.provider().id());
        m.setMeetingUrl(d.url());
        m.setStatusDetail("After the meeting, add its recording or transcript here.");
        m = store.save(m);
        store.audit(c.org(), m.getId(), c.caller().email(), "MEETING_REGISTERED", d.provider().id());
        return m;
    }

    // ── lifecycle ────────────────────────────────────────────────────────

    public UmaMeeting retry(Ctx c, String id) {
        UmaMeeting m = manageable(c, id);
        if (m.getStatus() != UmaStatus.FAILED) throw new UmaException(HttpStatus.CONFLICT, "NOT_FAILED", "Only a meeting that needs attention can be retried.");
        boolean transcribe = m.getFailedStage() == UmaStatus.TRANSCRIBING || m.getFailedStage() == UmaStatus.QUEUED
                || (m.getTranscript() == null && m.getRecording() != null);
        if (transcribe) {
            if (m.getRecording() == null || m.getRecording().getFileKey() == null)
                throw new UmaException(HttpStatus.GONE, "NO_RECORDING", "The recording is no longer stored.", "Upload it again.");
            m = store.transition(c.org(), id, UmaStatus.QUEUED, c.caller().email(), "Waiting to be transcribed…", "retry");
            queue.enqueue(c.org(), id, UmaPipeline.TRANSCRIBE, c.caller().email());
        } else {
            m = store.transition(c.org(), id, UmaStatus.ANALYZING, c.caller().email(), "Writing the summary and finding decisions and actions…", "retry");
            queue.enqueue(c.org(), id, UmaPipeline.ANALYZE, c.caller().email());
        }
        store.audit(c.org(), id, c.caller().email(), "RETRIED", transcribe ? "transcription" : "analysis");
        return m;
    }

    public UmaMeeting regenerate(Ctx c, String id) {
        UmaMeeting m = manageable(c, id);
        if (m.getStatus() != UmaStatus.REVIEW_READY && m.getStatus() != UmaStatus.COMPLETED)
            throw new UmaException(HttpStatus.CONFLICT, "INVALID_STATE", "The summary can be regenerated once the meeting has been processed.");
        m = store.transition(c.org(), id, UmaStatus.ANALYZING, c.caller().email(), "Writing a new version of the summary…", "regenerate");
        queue.enqueue(c.org(), id, UmaPipeline.ANALYZE, c.caller().email());
        store.audit(c.org(), id, c.caller().email(), "REGENERATED", null);
        return m;
    }

    public UmaMeeting cancel(Ctx c, String id) {
        UmaMeeting m = manageable(c, id);
        queue.cancel(c.org(), id);
        m = store.transition(c.org(), id, UmaStatus.CANCELLED, c.caller().email(), "Cancelled.", "cancelled");
        store.audit(c.org(), id, c.caller().email(), "CANCELLED", null);
        return m;
    }

    public UmaMeeting complete(Ctx c, String id) {
        manageable(c, id);
        UmaMeeting m = store.transition(c.org(), id, UmaStatus.COMPLETED, c.caller().email(), "Completed.", "marked complete");
        store.audit(c.org(), id, c.caller().email(), "COMPLETED", null);
        return m;
    }

    /** Deletes the meeting, its transcript, insights, questions and recording file. Tasks already created are kept (they belong to the project). */
    public void delete(Ctx c, String id) {
        UmaMeeting m = manageable(c, id);
        queue.cancel(c.org(), id);
        deleteRecordingFile(m);
        store.deleteMeeting(c.org(), id);
        store.audit(c.org(), id, c.caller().email(), "DELETED", null);
    }

    private void deleteRecordingFile(UmaMeeting m) {
        if (m.getRecording() != null && m.getRecording().getFileKey() != null) {
            try { files.delete(m.getRecording().getFileKey()); } catch (IOException ignored) { /* best effort; retention sweep tries again */ }
        }
    }

    public UmaMeeting share(Ctx c, String id, String visibility, List<String> sharedWith) {
        UmaMeeting m = manageable(c, id);
        if (visibility != null) {
            if (!Set.of("PRIVATE", "WORKSPACE").contains(visibility)) throw new UmaException(HttpStatus.BAD_REQUEST, "INVALID_VISIBILITY", "Choose who can see this meeting.");
            m.setVisibility(visibility);
        }
        if (sharedWith != null) m.setSharedWith(sharedWith.stream().filter(Objects::nonNull).map(s -> s.trim().toLowerCase(Locale.ROOT)).filter(s -> s.contains("@")).distinct().limit(200).toList());
        m = store.save(m);
        store.audit(c.org(), id, c.caller().email(), "SHARED", m.getVisibility() + ", " + m.getSharedWith().size() + " people");
        return m;
    }

    public UmaSegment editSegment(Ctx c, String id, int seq, String text, String speaker) {
        UmaMeeting m = manageable(c, id);
        UmaSegment s = store.segment(c.org(), id, seq).orElseThrow(() -> new UmaException(HttpStatus.NOT_FOUND, "NO_LINE", "That transcript line doesn't exist."));
        if (text != null) {
            String t = text.strip();
            if (t.isEmpty()) throw new UmaException(HttpStatus.BAD_REQUEST, "EMPTY_LINE", "A transcript line can't be empty.");
            s.setText(t.length() > 4000 ? t.substring(0, 4000) : t);
        }
        if (speaker != null) s.setSpeaker(speaker.isBlank() ? null : speaker.strip());
        s.setEdited(true); s.setEditedBy(c.caller().email());
        store.saveSegment(s);
        if (m.getTranscript() != null) { m.getTranscript().setEdited(true); m.getTranscript().setUpdatedAt(Instant.now()); store.save(m); }
        store.audit(c.org(), id, c.caller().email(), "TRANSCRIPT_EDITED", "line " + seq);
        return s;
    }

    // ── action items ─────────────────────────────────────────────────────

    private UmaInsights insightsFor(Ctx c, String id) {
        return store.insights(c.org(), id).orElseThrow(() -> new UmaException(HttpStatus.CONFLICT, "NO_INSIGHTS", "This meeting hasn't been processed yet."));
    }

    private static UmaInsights.ActionItem action(UmaInsights ins, String actionId) {
        return ins.getActions().stream().filter(a -> a.getId().equals(actionId)).findFirst()
                .orElseThrow(() -> new UmaException(HttpStatus.NOT_FOUND, "NO_ACTION", "That action item doesn't exist."));
    }

    public UmaInsights.ActionItem editAction(Ctx c, String id, String actionId, Map<String, Object> patch) {
        manageable(c, id);
        UmaInsights ins = insightsFor(c, id);
        UmaInsights.ActionItem a = action(ins, actionId);
        if ("CREATED".equals(a.getStatus())) throw new UmaException(HttpStatus.CONFLICT, "ALREADY_CREATED", "A task was already created from this item; change the task instead.");
        if (patch.containsKey("title")) {
            String t = Objects.toString(patch.get("title"), "").strip();
            if (t.isEmpty()) throw new UmaException(HttpStatus.BAD_REQUEST, "EMPTY_TITLE", "An action item needs a title.");
            a.setTitle(t.length() > 200 ? t.substring(0, 200) : t);
        }
        if (patch.containsKey("description")) a.setDescription(Objects.toString(patch.get("description"), "").strip());
        if (patch.containsKey("ownerMemberId")) {
            String mid = blank(Objects.toString(patch.get("ownerMemberId"), null));
            a.setOwnerMemberId(mid);
            a.setOwnerState(mid == null ? "UNASSIGNED" : "MATCHED");
        }
        if (patch.containsKey("dueDate")) {
            String d = blank(Objects.toString(patch.get("dueDate"), null));
            try { a.setDueDate(d == null ? null : LocalDate.parse(d)); } catch (Exception e) { throw new UmaException(HttpStatus.BAD_REQUEST, "INVALID_DATE", "Use a date like 2026-11-20."); }
            a.setDueState(d == null ? "UNSPECIFIED" : "EXACT");
        }
        if (patch.containsKey("priority")) {
            String p = Objects.toString(patch.get("priority"), "MEDIUM").toUpperCase(Locale.ROOT);
            a.setPriority(Set.of("LOW", "MEDIUM", "HIGH").contains(p) ? p : "MEDIUM");
        }
        if (patch.containsKey("projectId")) a.setProjectId(blank(Objects.toString(patch.get("projectId"), null)));
        a.setEdited(true);
        store.saveInsights(ins);
        store.audit(c.org(), id, c.caller().email(), "ACTION_EDITED", actionId);
        return a;
    }

    public UmaInsights.ActionItem reject(Ctx c, String id, String actionId) {
        manageable(c, id);
        UmaInsights ins = insightsFor(c, id);
        UmaInsights.ActionItem a = action(ins, actionId);
        if ("CREATED".equals(a.getStatus())) throw new UmaException(HttpStatus.CONFLICT, "ALREADY_CREATED", "A task was already created from this item.");
        a.setStatus("REJECTED"); a.setDecidedBy(c.caller().email()); a.setDecidedAt(Instant.now());
        store.saveInsights(ins);
        store.audit(c.org(), id, c.caller().email(), "ACTION_REJECTED", actionId);
        completeIfAllDecided(c, id, ins);
        return a;
    }

    public static String sourceKey(String meetingId, String actionId) { return "uma:" + meetingId + ":" + actionId; }

    /** Approving creates the task in the existing task module. Safe to repeat: the same item never creates a second task. */
    public List<UmaInsights.ActionItem> approve(Ctx c, String id, List<String> actionIds) {
        UmaMeeting m = manageable(c, id);
        UmaInsights ins = insightsFor(c, id);
        List<UmaInsights.ActionItem> out = new ArrayList<>();
        for (String actionId : actionIds) {
            UmaInsights.ActionItem a = action(ins, actionId);
            if ("CREATED".equals(a.getStatus())) { out.add(a); continue; }
            String key = sourceKey(id, actionId);
            try {
                Task existing = mongo.findOne(new Query(Criteria.where("organizationId").is(c.org()).and("sourceActionKey").is(key)), Task.class);
                if (existing == null) {
                    Task t = new Task();
                    t.setTitle(a.getTitle());
                    t.setDescription(taskDescription(m, a));
                    t.setProjectId(a.getProjectId());
                    t.setPriority(a.getPriority());
                    if (a.getDueDate() != null) t.setDueDate(a.getDueDate().atStartOfDay());
                    if (a.getOwnerMemberId() != null) t.setAssigneeIds(new ArrayList<>(List.of(a.getOwnerMemberId())));
                    t.setTags(new ArrayList<>(List.of("meeting")));
                    t.setCreatedBy(c.caller().email());
                    t.setSourceMeetingId(id);
                    t.setSourceMeetingTitle(m.getTitle());
                    t.setSourceActionKey(key);
                    t.setSourceEvidence(new ArrayList<>(a.getEvidence()));
                    try { existing = tasks.create(t); }
                    catch (DuplicateKeyException race) {
                        existing = mongo.findOne(new Query(Criteria.where("organizationId").is(c.org()).and("sourceActionKey").is(key)), Task.class);
                        if (existing == null) throw race;
                    }
                }
                a.setStatus("CREATED"); a.setCreatedTaskId(existing.getId()); a.setFailureReason(null);
                a.setDecidedBy(c.caller().email()); a.setDecidedAt(Instant.now());
                store.audit(c.org(), id, c.caller().email(), "ACTION_APPROVED", actionId + " -> task " + existing.getId());
            } catch (UmaException e) {
                throw e;
            } catch (RuntimeException e) {
                a.setStatus("FAILED");
                a.setFailureReason(e.getMessage() == null ? "The task couldn't be created." : e.getMessage());
            }
            out.add(a);
        }
        store.saveInsights(ins);
        completeIfAllDecided(c, id, ins);
        return out;
    }

    private void completeIfAllDecided(Ctx c, String id, UmaInsights ins) {
        boolean open = ins.getActions().stream().anyMatch(a -> "PENDING".equals(a.getStatus()) || "FAILED".equals(a.getStatus()));
        UmaMeeting m = store.meeting(c.org(), id).orElse(null);
        if (!open && m != null && m.getStatus() == UmaStatus.REVIEW_READY)
            store.transition(c.org(), id, UmaStatus.COMPLETED, c.caller().email(), "All action items have been reviewed.", "all actions decided");
    }

    private static String taskDescription(UmaMeeting m, UmaInsights.ActionItem a) {
        StringBuilder sb = new StringBuilder();
        if (a.getDescription() != null && !a.getDescription().isBlank()) sb.append(a.getDescription()).append("\n\n");
        if (a.getOwnerSpoken() != null && a.getOwnerMemberId() == null) sb.append("Owner named in the meeting: ").append(a.getOwnerSpoken()).append("\n");
        if (a.getDueSpoken() != null && a.getDueDate() == null) sb.append("Deadline as said: ").append(a.getDueSpoken()).append("\n");
        sb.append("From the meeting \"").append(m.getTitle()).append("\" (AI Meeting Assistant), transcript line")
          .append(a.getEvidence().size() == 1 ? " " : "s ").append(String.join(", ", a.getEvidence().stream().map(i -> "#" + i).toList())).append('.');
        return sb.toString();
    }

    // ── ask / export / audit ─────────────────────────────────────────────

    public UmaQuestion ask(Ctx c, String id, String question) {
        UmaMeeting m = readable(c, id);
        UmaQuestion q = intelligence.ask(m, question, c.caller().email());
        store.audit(c.org(), id, c.caller().email(), "ASKED_AI", q.isGrounded() ? "answered" : "not in transcript");
        return q;
    }

    public UmaExporter.Export export(Ctx c, String id, String format) {
        UmaMeeting m = readable(c, id);
        UmaExporter.Export e = UmaExporter.export(m, store.insights(c.org(), id).orElse(null), store.segments(c.org(), id), format);
        store.audit(c.org(), id, c.caller().email(), "EXPORTED", format);
        return e;
    }

    public List<UmaAuditEvent> audit(Ctx c, String id) {
        UmaMeeting m = readable(c, id);
        if (!access.canManage(m, c.caller())) throw new UmaException(HttpStatus.FORBIDDEN, "NOT_ALLOWED", "Only the person who added this meeting, or an admin, can see its history.");
        return store.auditTrail(c.org(), id);
    }

    // ── retention ────────────────────────────────────────────────────────

    /** Deletes recording files once their transcript is done and the retention window has passed. Run by the scheduler. */
    public int purgeRecordings() {
        Instant cutoff = Instant.now().minusSeconds(retentionHours * 3600L);
        List<UmaMeeting> due = mongo.find(new Query(Criteria.where("recording.fileKey").ne(null).and("recording.deletedAt").is(null)
                .and("transcript.origin").is("STT").and("updatedAt").lt(cutoff)).limit(100), UmaMeeting.class);
        for (UmaMeeting m : due) {
            deleteRecordingFile(m);
            m.getRecording().setFileKey(null);
            m.getRecording().setDeletedAt(Instant.now());
            store.save(m);
            store.audit(m.getOrganizationId(), m.getId(), "system", "RECORDING_DELETED", "retention " + retentionHours + "h");
        }
        return due.size();
    }

    private static String blank(String s) { return s == null || s.isBlank() ? null : s.strip(); }

    private static String cleanTitle(String t) {
        String s = t == null ? "" : t.replaceAll("\\s+", " ").strip();
        if (s.isEmpty()) s = "Untitled meeting";
        return s.length() > 200 ? s.substring(0, 200) : s;
    }
}

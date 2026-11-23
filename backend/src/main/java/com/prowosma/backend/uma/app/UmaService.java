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
    private final UmaTaskWriter taskWriter;
    private final MeetingIntelligence intelligence;
    private final UmaTranscriber transcriber;
    private final MongoTemplate mongo;
    private final com.prowosma.backend.repository.TeamMemberRepository members;
    private final com.prowosma.backend.repository.UserRepository users;
    private final com.prowosma.backend.uma.core.UmaFireflies fireflies;
    private final com.prowosma.backend.uma.core.UmaGoogleMeet googleMeet;
    private final UmaAutomation automation;
    private final com.prowosma.backend.uma.core.UmaCalendar calendar;
    private final com.prowosma.backend.uma.core.UmaGoogleAuth googleAuth;
    private final com.prowosma.backend.service.ProjectService projectService;
    private final UmaPostMeeting postMeeting;
    private final com.prowosma.backend.uma.core.UmaTeams teams;
    private final com.prowosma.backend.uma.core.UmaMicrosoftAuth microsoft;

    @Value("${app.uma.max-upload-mb:500}") private long maxUploadMb = 500;
    @Value("${app.uma.recording-retention-hours:24}") private int retentionHours = 24;

    public UmaService(UmaFeature feature, UmaAccess access, UmaStore store, UmaJobQueue queue, ProviderRegistry providers,
                      FileStorageService files, UmaTaskWriter taskWriter, MeetingIntelligence intelligence, UmaTranscriber transcriber, MongoTemplate mongo,
                      com.prowosma.backend.repository.TeamMemberRepository members, com.prowosma.backend.repository.UserRepository users,
                      com.prowosma.backend.uma.core.UmaFireflies fireflies, com.prowosma.backend.uma.core.UmaGoogleMeet googleMeet,
                      UmaAutomation automation, com.prowosma.backend.uma.core.UmaCalendar calendar, com.prowosma.backend.uma.core.UmaGoogleAuth googleAuth,
                      com.prowosma.backend.service.ProjectService projectService, UmaPostMeeting postMeeting,
                      com.prowosma.backend.uma.core.UmaTeams teams, com.prowosma.backend.uma.core.UmaMicrosoftAuth microsoft) {
        this.feature = feature; this.access = access; this.store = store; this.queue = queue; this.providers = providers;
        this.files = files; this.taskWriter = taskWriter; this.intelligence = intelligence; this.transcriber = transcriber; this.mongo = mongo;
        this.members = members; this.users = users; this.fireflies = fireflies; this.googleMeet = googleMeet;
        this.automation = automation; this.calendar = calendar; this.googleAuth = googleAuth;
        this.projectService = projectService; this.postMeeting = postMeeting; this.teams = teams; this.microsoft = microsoft;
    }

    /** The person's name as the workspace knows it (team member, else account), or null. */
    String memberName(String org, String email) {
        if (email == null) return null;
        String n = members.findAllByEmailAndOrganizationId(email, org).stream().map(com.prowosma.backend.model.TeamMember::getName)
                .filter(x -> x != null && !x.isBlank()).findFirst().orElse(null);
        if (n == null) n = users.findByEmail(email).map(com.prowosma.backend.model.User::getName).filter(x -> x != null && !x.isBlank()).orElse(null);
        return n == null ? null : n.strip();
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
            row.put("canManage", access.canManage(m, c.caller()));
            if (m.getStatus() == UmaStatus.CREATED && m.getMeetingAt() != null && m.getMeetingAt().isAfter(now)) upcoming.add(row);
            else if (m.getStatus().isWorking() || Set.of("In progress", "Getting transcript", "Waiting for transcript").contains(String.valueOf(row.get("statusLabel")))) inProgress.add(row);
            else if (m.getStatus() == UmaStatus.FAILED) failed.add(row);
            else if (m.getStatus() == UmaStatus.REVIEW_READY) review.add(row);
            if (m.getStatus() != UmaStatus.CANCELLED && recent.size() < 50) recent.add(row);
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
        UmaSettings ws = mongo.findById(c.org(), UmaSettings.class);
        out.put("retentionDays", ws == null ? 15 : ws.retentionDays());
        out.put("readiness", readiness(c.org()));
        out.put("canCreate", !c.caller().readOnly() && !"NONE".equals(c.caller().role()));
        out.put("isAdmin", c.caller().admin());
        return out;
    }

    public Map<String, Object> summary(UmaMeeting m) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("id", m.getId());
        r.put("title", m.getTitle());
        r.put("source", m.getSource());
        r.put("provider", m.getProvider());
        r.put("status", m.getStatus());
        r.put("statusLabel", label(m));
        r.put("statusDetail", m.getStatusDetail());
        r.put("progressPercent", m.getProgressPercent());
        r.put("meetingAt", m.getMeetingAt());
        r.put("createdAt", m.getCreatedAt());
        r.put("createdBy", m.getCreatedBy());
        r.put("durationMs", m.getRecording() == null ? null : m.getRecording().getDurationMs());
        r.put("projectId", m.getProjectId());
        r.put("meetingType", m.getMeetingType());
        return r;
    }

    /** Where a meeting without content stands, in one word: SCHEDULED, IN_PROGRESS, ENDED, STARTED (should be running, nothing seen) or NONE. */
    String phase(UmaMeeting m) {
        if (m.getStatus() != UmaStatus.CREATED) return null;
        if ("ENDED".equals(m.getLiveState())) return "ENDED";
        if ("IN_PROGRESS".equals(m.getLiveState())) return "IN_PROGRESS";
        if (m.getMeetingAt() != null && m.getMeetingAt().isAfter(Instant.now())) return "SCHEDULED";
        return automation.pendingCapture(m).isEmpty() ? "NONE" : "STARTED";
    }

    /** What people see. */
    String label(UmaMeeting m) {
        String p = phase(m);
        if (p == null) return m.getStatus().label();
        return switch (p) {
            case "SCHEDULED" -> "Scheduled";
            case "IN_PROGRESS" -> "In progress";
            case "ENDED" -> "Getting transcript";
            case "STARTED" -> "Waiting for transcript";
            default -> m.getStatus().label();
        };
    }

    /** Everything the meeting page needs to say plainly what is happening and what happens next. */
    Map<String, Object> capture(UmaMeeting m) {
        Map<String, Object> r = new LinkedHashMap<>();
        if (m.getStatus() != UmaStatus.CREATED) { r.put("pending", List.of()); return r; }
        List<com.prowosma.backend.uma.model.UmaJob> jobs = automation.pendingCapture(m);
        List<String> types = jobs.stream().map(com.prowosma.backend.uma.model.UmaJob::getType).distinct().toList();
        r.put("pending", types);
        r.put("phase", phase(m));
        r.put("startedAt", m.getStartedAt());
        r.put("endedAt", m.getEndedAt());
        r.put("liveSource", m.getLiveSource());
        r.put("firefliesJoining", types.contains(UmaPipeline.FIREFLIES_JOIN));
        r.put("firefliesSent", m.getFireflies() != null && m.getFireflies().getNotetakerSentAt() != null);
        r.put("firefliesInMeeting", m.getFireflies() != null && m.getFireflies().isInMeeting());
        r.put("googleWatching", types.contains(UmaPipeline.FETCH_GOOGLE));
        r.put("teamsWatching", types.contains(UmaPipeline.FETCH_TEAMS));
        jobs.stream().filter(j -> !UmaPipeline.FIREFLIES_JOIN.equals(j.getType())).map(com.prowosma.backend.uma.model.UmaJob::getRunAfter)
                .filter(Objects::nonNull).min(Comparator.naturalOrder()).ifPresent(t -> r.put("nextCheckAt", t));
        Instant last = null;
        if (m.getFireflies() != null && m.getFireflies().getLastCheckAt() != null) last = m.getFireflies().getLastCheckAt();
        if (m.getGoogle() != null && m.getGoogle().getLastCheckAt() != null && (last == null || m.getGoogle().getLastCheckAt().isAfter(last))) last = m.getGoogle().getLastCheckAt();
        if (last != null) r.put("lastCheckAt", last);
        return r;
    }

    /** "Check now" for a meeting waiting for its transcript. */
    public Map<String, Object> checkNow(Ctx c, String id) {
        UmaMeeting m = manageable(c, id);
        if (m.getStatus() != UmaStatus.CREATED) throw new UmaException(HttpStatus.CONFLICT, "HAS_CONTENT", "This meeting already has its content.");
        int n = automation.checkNow(m);
        if (n == 0) throw new UmaException(HttpStatus.CONFLICT, "NOTHING_TO_CHECK", "Nothing is waiting to be fetched for this meeting.",
                "Send the Fireflies notetaker, get the transcript from Google Meet, or add the recording.");
        return Map.of("checks", n);
    }

    public Map<String, Object> detail(Ctx c, String id) {
        UmaMeeting m = readable(c, id);
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("meeting", m);
        r.put("statusLabel", label(m));
        r.put("capture", capture(m));
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
        String fileName = file == null ? null : file.getOriginalFilename();
        TranscriptParser.Parsed parsed = readTranscript(text, file);
        UmaMeeting m = newMeeting(c, title != null && !title.isBlank() ? title : (fileName != null ? TranscriptFileReader.titleFromFilename(fileName) : "Imported meeting"),
                "TRANSCRIPT_IMPORT", projectId, meetingAt, timezone);
        m = store.save(m);
        return applyTranscript(c, m, parsed, "TRANSCRIPT_IMPORTED");
    }

    /** Gives an EXISTING meeting its transcript from a file or pasted text (for example one downloaded from Fireflies when the automatic fetch is stuck). */
    public UmaMeeting attachTranscript(Ctx c, String id, String text, MultipartFile file) {
        UmaMeeting m = manageable(c, id);
        if (m.getStatus() != UmaStatus.CREATED && m.getStatus() != UmaStatus.FAILED)
            throw new UmaException(HttpStatus.CONFLICT, "HAS_CONTENT", "This meeting already has its content. Add a new meeting for another transcript.");
        TranscriptParser.Parsed parsed = readTranscript(text, file);
        queue.cancel(c.org(), id);                                   // stop waiting for the notetaker / Google transcript
        m.setErrorCode(null); m.setRecoveryHint(null); m.setFailedStage(null);
        return applyTranscript(c, m, parsed, "TRANSCRIPT_ATTACHED");
    }

    private TranscriptParser.Parsed readTranscript(String text, MultipartFile file) {
        String content; String hint = null;
        if (file != null && !file.isEmpty()) {
            if (file.getSize() > 25L * 1024 * 1024) throw new UmaException(HttpStatus.CONTENT_TOO_LARGE, "FILE_TOO_LARGE", "That transcript file is larger than 25 MB.");
            try {
                TranscriptFileReader.Content read = TranscriptFileReader.read(file.getBytes(), file.getOriginalFilename());
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
        return parsed;
    }

    private UmaMeeting applyTranscript(Ctx c, UmaMeeting m, TranscriptParser.Parsed parsed, String auditAction) {
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
        store.audit(c.org(), m.getId(), c.caller().email(), auditAction, segs.size() + " lines" + (parsed.warnings().isEmpty() ? "" : ", " + parsed.warnings().size() + " warnings"));
        return m;
    }

    // ── browser capture ──────────────────────────────────────────────────

    public static final long MAX_PIECE_BYTES = 6_000_000L;      // a 3-minute speech piece is about 1 MB
    public static final int MAX_PIECES = 1000;

    /** Starts recording in the browser: a new meeting, or the meeting a link was registered for. */
    public UmaMeeting startCapture(Ctx c, String existingId, String title, String projectId, Instant meetingAt, String timezone, boolean consent) {
        if (!consent) throw new UmaException(HttpStatus.BAD_REQUEST, "CONSENT_REQUIRED",
                "Please confirm that everyone in the meeting knows it is being recorded and transcribed.");
        UmaMeeting m;
        if (existingId != null && !existingId.isBlank()) {
            m = manageable(c, existingId);
            if (m.getStatus() != UmaStatus.CREATED)
                throw new UmaException(HttpStatus.CONFLICT, "HAS_CONTENT", "This meeting already has its content. Start a new recording instead.");
        } else {
            m = store.save(newMeeting(c, title != null && !title.isBlank() ? title : "Recorded meeting", "BROWSER_CAPTURE", projectId, meetingAt, timezone));
        }
        UmaMeeting.Recording rec = new UmaMeeting.Recording();
        rec.setFileName("browser recording");
        rec.setMimeType("audio/webm");
        rec.setRecorderName(recorderName(c));
        rec.setLastPieceAt(Instant.now());
        m.setRecording(rec);
        m.setConsentConfirmed(true); m.setConsentBy(c.caller().email()); m.setConsentAt(Instant.now());
        store.save(m);
        m = store.transition(c.org(), m.getId(), UmaStatus.CAPTURING, c.caller().email(), "Recording in your browser…", "capture started");
        store.audit(c.org(), m.getId(), c.caller().email(), "CAPTURE_STARTED", null);
        return m;
    }

    private String recorderName(Ctx c) {
        String email = c.caller().email();
        return memberName(c.org(), email);
    }

    /** One short piece of one track. Safe to send twice (the second copy is ignored). */
    public Map<String, Object> capturePiece(Ctx c, String id, String track, int seq, long startMs, long durationMs, byte[] audio) {
        UmaMeeting m = manageable(c, id);
        if (m.getStatus() != UmaStatus.CAPTURING)
            throw new UmaException(HttpStatus.CONFLICT, "NOT_RECORDING", "This recording has already been finished.");
        String t = "MIC".equalsIgnoreCase(track) ? "MIC" : "TAB".equalsIgnoreCase(track) ? "TAB" : null;
        if (t == null || seq < 0 || startMs < 0 || durationMs < 0)
            throw new UmaException(HttpStatus.BAD_REQUEST, "BAD_PIECE", "That piece of audio wasn't labelled correctly.");
        if (audio == null || audio.length == 0) throw new UmaException(HttpStatus.BAD_REQUEST, "EMPTY_PIECE", "That piece of audio was empty.");
        if (audio.length > MAX_PIECE_BYTES) throw new UmaException(HttpStatus.CONTENT_TOO_LARGE, "PIECE_TOO_LARGE", "That piece of audio is too large.");
        String kind = com.prowosma.backend.meetingassistant.RecordingRules.audioKind(audio);
        if (kind == null) throw new UmaException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "NOT_AUDIO", "That piece isn't audio.");
        List<UmaMeeting.Piece> have = m.getRecording() == null ? List.of() : m.getRecording().getPieces();
        if (have.stream().anyMatch(p -> p.getTrack().equals(t) && p.getSeq() == seq)) return Map.of("stored", false, "duplicate", true);
        if (have.size() >= MAX_PIECES) throw new UmaException(HttpStatus.CONFLICT, "TOO_LONG", "This recording has reached its length limit. Press Stop.");
        long total = have.stream().mapToLong(UmaMeeting.Piece::getSizeBytes).sum() + audio.length;
        if (total > maxUploadMb * 1024 * 1024) throw new UmaException(HttpStatus.CONTENT_TOO_LARGE, "TOO_LARGE", "This recording has reached its size limit. Press Stop.");

        String key;
        try { key = files.store(new com.prowosma.backend.uma.core.BytesUpload(audio, t.toLowerCase(Locale.ROOT) + "-" + seq + "." + kind,
                com.prowosma.backend.meetingassistant.RecordingRules.mimeOf(kind))); }
        catch (IOException e) { throw new UmaException(HttpStatus.BAD_REQUEST, "UPLOAD_REJECTED", e.getMessage() == null ? "The audio couldn't be stored." : e.getMessage()); }
        UmaMeeting.Piece p = new UmaMeeting.Piece();
        p.setTrack(t); p.setSeq(seq); p.setStartMs(startMs); p.setDurationMs(durationMs); p.setFileKey(key); p.setSizeBytes(audio.length);
        // Atomic append, only while still recording and only if this piece isn't there yet (two tabs or a retry can race).
        Query q = new Query(Criteria.where("_id").is(id).and("organizationId").is(c.org()).and("status").is(UmaStatus.CAPTURING)
                .and("recording.pieces").not().elemMatch(Criteria.where("track").is(t).and("seq").is(seq)));
        org.springframework.data.mongodb.core.query.Update u = new org.springframework.data.mongodb.core.query.Update()
                .push("recording.pieces", p).set("recording.lastPieceAt", Instant.now()).set("updatedAt", Instant.now());
        boolean stored = mongo.updateFirst(q, u, UmaMeeting.class).getModifiedCount() == 1;
        if (!stored) { try { files.delete(key); } catch (IOException ignored) { } }
        return Map.of("stored", stored, "duplicate", !stored);
    }

    public UmaMeeting finishCapture(Ctx c, String id) {
        UmaMeeting m = manageable(c, id);
        if (m.getStatus() != UmaStatus.CAPTURING) return m;                      // already finished (double click, auto-finish)
        if (m.getRecording() == null || m.getRecording().getPieces().isEmpty()) {
            UmaMeeting f = store.transition(c.org(), id, UmaStatus.FAILED, c.caller().email(), "No audio was recorded.", "capture finished empty");
            f.setErrorCode("NO_AUDIO"); f.setFailedStage(UmaStatus.CAPTURING);
            f.setRecoveryHint("Start the recording again: choose the meeting tab and tick “Share tab audio”.");
            return store.save(f);
        }
        m = store.transition(c.org(), id, UmaStatus.QUEUED, c.caller().email(), "Waiting to be transcribed…", "capture finished");
        queue.enqueue(c.org(), id, UmaPipeline.TRANSCRIBE, c.caller().email());
        store.audit(c.org(), id, c.caller().email(), "CAPTURE_FINISHED", m.getRecording().getPieces().size() + " pieces");
        return m;
    }

    // ── Fireflies ────────────────────────────────────────────────────────

    public Map<String, Object> firefliesStatus(Ctx c) { return fireflies.status(c.org()); }

    public Map<String, Object> saveFirefliesKey(Ctx c, String key) {
        requireAdmin(c);
        Map<String, Object> r = fireflies.saveKey(c.org(), key, c.caller().email());
        store.audit(c.org(), null, c.caller().email(), "FIREFLIES_CONNECTED", null);
        return r;
    }

    public Map<String, Object> removeFirefliesKey(Ctx c) {
        requireAdmin(c);
        store.audit(c.org(), null, c.caller().email(), "FIREFLIES_DISCONNECTED", null);
        return fireflies.removeKey(c.org());
    }

    private static void requireAdmin(Ctx c) {
        if (!c.caller().admin()) throw new UmaException(HttpStatus.FORBIDDEN, "ADMIN_ONLY", "Only a workspace admin can change connections.");
    }

    public List<Map<String, Object>> firefliesRecent(Ctx c) {
        access.requireCanCreate(c.caller());
        return fireflies.recent(c.org());
    }

    /** Imports one Fireflies meeting as a new meeting (once per workspace). */
    public UmaMeeting importFromFireflies(Ctx c, String transcriptId, String projectId) {
        access.requireCanCreate(c.caller());
        if (transcriptId == null || transcriptId.isBlank()) throw new UmaException(HttpStatus.BAD_REQUEST, "NO_ID", "Choose a Fireflies meeting.");
        if (fireflies.alreadyImported(c.org(), transcriptId))
            throw new UmaException(HttpStatus.CONFLICT, "ALREADY_IMPORTED", "That Fireflies meeting has already been imported.");
        com.prowosma.backend.integration.FirefliesApi.Transcript t = fireflies.transcript(c.org(), transcriptId)
                .orElseThrow(() -> new UmaException(HttpStatus.CONFLICT, "NOT_READY", "Fireflies is still processing that meeting.", "Try again in a few minutes."));
        if (t.live()) throw new UmaException(HttpStatus.CONFLICT, "STILL_LIVE", "That meeting is still running in Fireflies.", "Import it after it ends.");
        UmaMeeting m = newMeeting(c, t.title() != null && !t.title().isBlank() ? t.title() : "Fireflies meeting", "FIREFLIES_IMPORT", projectId,
                t.date(), null);
        m.setMeetingUrl(t.meetingLink());
        if (t.meetingLink() != null) {
            try { m.setProvider(providers.detect(t.meetingLink()).provider().id()); } catch (UmaException ignored) { /* not a usable link */ }
        }
        m = store.save(m);
        try {
            fireflies.apply(m, t, c.caller().email());
        } catch (RuntimeException e) {
            store.deleteMeeting(c.org(), m.getId());
            throw e;
        }
        queue.enqueue(c.org(), m.getId(), UmaPipeline.ANALYZE, c.caller().email());
        return store.meeting(c.org(), m.getId()).orElseThrow();
    }

    /** Asks the Fireflies notetaker to join this meeting now; its transcript is fetched automatically afterwards. */
    public UmaMeeting sendFirefliesNotetaker(Ctx c, String id) {
        UmaMeeting m = manageable(c, id);
        if (m.getMeetingUrl() == null) throw new UmaException(HttpStatus.BAD_REQUEST, "NO_LINK", "This meeting has no link for the notetaker to join.");
        if (m.getStatus() != UmaStatus.CREATED && m.getStatus() != UmaStatus.FAILED)
            throw new UmaException(HttpStatus.CONFLICT, "HAS_CONTENT", "This meeting already has its content.");
        fireflies.sendNotetaker(c.org(), m.getMeetingUrl(), m.getTitle());
        if (m.getStatus() == UmaStatus.FAILED) m = store.transition(c.org(), id, UmaStatus.CREATED, c.caller().email(), null, "notetaker sent again");
        UmaMeeting.FirefliesLink f = m.getFireflies() == null ? new UmaMeeting.FirefliesLink() : m.getFireflies();
        f.setNotetakerSentAt(Instant.now()); f.setNotetakerSentBy(c.caller().email()); f.setChecks(0);
        m.setFireflies(f);
        m.setErrorCode(null); m.setRecoveryHint(null);
        m.setStatusDetail("Fireflies' notetaker is joining. The transcript is fetched automatically after the meeting.");
        m = store.save(m);
        queue.enqueueAt(c.org(), id, UmaPipeline.FETCH_FIREFLIES, c.caller().email(), Instant.now().plus(UmaAutomation.FIRST_LOOK));
        store.audit(c.org(), id, c.caller().email(), "FIREFLIES_NOTETAKER_SENT", null);
        return m;
    }

    // ── Google Meet ──────────────────────────────────────────────────────

    public Map<String, Object> googleStatus(Ctx c) { return googleMeet.status(c.org(), c.caller().email()); }

    // ── Microsoft 365 / Teams ──
    public Map<String, Object> microsoftStatus(Ctx c) { return teams.status(c.org(), c.caller().email()); }

    public Map<String, Object> microsoftAuthorize(Ctx c) {
        access.requireCanCreate(c.caller());
        return Map.of("url", microsoft.authorizeUrl(c.org(), c.caller().email()));
    }

    public Map<String, Object> microsoftComplete(Ctx c, String code, String state) {
        microsoft.complete(c.org(), c.caller().email(), code, state);
        store.audit(c.org(), "connections", c.caller().email(), "MICROSOFT_CONNECTED", null);
        return microsoftStatus(c);
    }

    public Map<String, Object> microsoftDisconnect(Ctx c) {
        microsoft.disconnect(c.org(), c.caller().email());
        store.audit(c.org(), "connections", c.caller().email(), "MICROSOFT_DISCONNECTED", null);
        return microsoftStatus(c);
    }

    public Map<String, Object> googleAuthorize(Ctx c) {
        access.requireCanCreate(c.caller());
        return Map.of("url", googleMeet.authorizeUrl(c.org(), c.caller().email()));
    }

    public Map<String, Object> googleDisconnect(Ctx c) {
        googleMeet.disconnect(c.org(), c.caller().email());
        return googleMeet.status(c.org(), c.caller().email());
    }

    public Map<String, Object> googleComplete(Ctx c, String code, String state) {
        access.requireCanCreate(c.caller());
        googleMeet.complete(c.org(), c.caller().email(), code, state);
        store.audit(c.org(), null, c.caller().email(), "GOOGLE_CONNECTED", null);
        return googleMeet.status(c.org(), c.caller().email());
    }

    /** The person's automation choices: add upcoming Meet meetings from their calendar; send Fireflies to them. */
    public Map<String, Object> googlePreferences(Ctx c, Boolean autoImportCalendar, Boolean autoFireflies) {
        com.prowosma.backend.uma.model.UmaGoogleConnection conn = googleAuth.connection(c.org(), c.caller().email())
                .orElseThrow(() -> new UmaException(HttpStatus.CONFLICT, "GOOGLE_NOT_CONNECTED", "Connect your Google account first."));
        if (Boolean.TRUE.equals(autoImportCalendar) && !conn.getScopes().contains(com.prowosma.backend.uma.core.UmaGoogleAuth.CALENDAR_SCOPE))
            throw new UmaException(HttpStatus.CONFLICT, "GOOGLE_NO_CALENDAR", "Calendar access wasn't granted.", "Disconnect and connect Google again, and allow Calendar.");
        if (Boolean.TRUE.equals(autoFireflies) && fireflies.key(c.org()).isEmpty())
            throw new UmaException(HttpStatus.CONFLICT, "NO_FIREFLIES", "Fireflies isn't connected for this workspace.", "An admin connects it under Connections.");
        if (autoImportCalendar != null) conn.setAutoImportCalendar(autoImportCalendar);
        if (autoFireflies != null) conn.setAutoFireflies(autoFireflies);
        if (Boolean.TRUE.equals(autoImportCalendar)) conn.setLastCalendarSyncAt(null);          // look right away
        googleAuth.save(conn);
        store.audit(c.org(), null, c.caller().email(), "AUTOMATION_CHANGED", "calendar=" + conn.isAutoImportCalendar() + " fireflies=" + conn.isAutoFireflies());
        return googleMeet.status(c.org(), c.caller().email());
    }

    /** "Check my calendar now". */
    public Map<String, Object> syncCalendarNow(Ctx c) {
        com.prowosma.backend.uma.model.UmaGoogleConnection conn = googleAuth.connection(c.org(), c.caller().email())
                .orElseThrow(() -> new UmaException(HttpStatus.CONFLICT, "GOOGLE_NOT_CONNECTED", "Connect your Google account first."));
        int added = automation.syncOne(conn);
        conn.setLastCalendarSyncAt(Instant.now());
        conn.setLastCalendarSyncNote(added == 0 ? "Up to date." : added + " meeting(s) added.");
        googleAuth.save(conn);
        return Map.of("added", added);
    }

    /** Creates a Google Meet meeting in the person's Google Calendar (Google sends the invitations) and sets up its automation. */
    /** GOOGLE_MEET or MS_TEAMS; when not given, the person's default (Settings), else Google Meet. */
    public String platformFor(Ctx c, String requested) {
        String p = requested == null || requested.isBlank() ? postMeeting.prefs(c.org(), c.caller().email()).getDefaultPlatform() : requested.trim().toUpperCase(Locale.ROOT);
        if (!Set.of("GOOGLE_MEET", "MS_TEAMS").contains(p)) throw new UmaException(HttpStatus.BAD_REQUEST, "BAD_PLATFORM", "Choose Google Meet or Microsoft Teams.");
        return p;
    }

    public UmaMeeting scheduleMeeting(Ctx c, String title, Instant start, Integer durationMinutes, String timezone, List<String> attendees,
                                      String description, String projectId, boolean autoFireflies) {
        return scheduleMeeting(c, title, start, durationMinutes, timezone, attendees, description, projectId, autoFireflies, null);
    }

    public UmaMeeting scheduleMeeting(Ctx c, String title, Instant start, Integer durationMinutes, String timezone, List<String> attendees,
                                      String description, String projectId, boolean autoFireflies, String platform) {
        String provider = platformFor(c, platform);
        access.requireCanCreate(c.caller());
        String t = cleanTitle(title);
        if (start == null) throw new UmaException(HttpStatus.BAD_REQUEST, "NO_TIME", "Choose when the meeting starts.");
        if (start.isBefore(Instant.now().minusSeconds(300))) throw new UmaException(HttpStatus.BAD_REQUEST, "IN_THE_PAST", "That time has already passed.");
        int minutes = durationMinutes == null ? 30 : durationMinutes;
        if (minutes < 5 || minutes > 720) throw new UmaException(HttpStatus.BAD_REQUEST, "BAD_DURATION", "A meeting can be 5 minutes to 12 hours long.");
        List<String> people = new ArrayList<>();
        for (String a : attendees == null ? List.<String>of() : attendees) {
            String e = a == null ? "" : a.trim().toLowerCase(Locale.ROOT);
            if (e.isEmpty()) continue;
            if (!e.matches("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")) throw new UmaException(HttpStatus.BAD_REQUEST, "BAD_EMAIL", "“" + a.trim() + "” isn't an email address.");
            if (!people.contains(e)) people.add(e);
        }
        if (people.size() > 100) throw new UmaException(HttpStatus.BAD_REQUEST, "TOO_MANY", "Invite at most 100 people.");
        if (autoFireflies && fireflies.key(c.org()).isEmpty())
            throw new UmaException(HttpStatus.CONFLICT, "NO_FIREFLIES", "Fireflies isn't connected for this workspace.", "An admin connects it under Connections, or untick Fireflies.");
        Instant end = start.plusSeconds(minutes * 60L);
        UmaMeeting m = newMeeting(c, t, "MEETING_LINK", projectId, start, timezone);
        if ("MS_TEAMS".equals(provider)) {
            com.prowosma.backend.uma.core.UmaTeams.Created ev = teams.createMeeting(c.org(), c.caller().email(), t, start, end, timezone, people, description);
            m.setProvider("MS_TEAMS");
            m.setMeetingUrl(ev.joinUrl());
            m.setCalendarEventId("ms:" + ev.eventId());
            m.setCalendarLink(ev.webLink());
        } else {
            com.prowosma.backend.uma.core.UmaCalendar.Event ev = calendar.createMeeting(c.org(), c.caller().email(), t, start, end, timezone, people, description);
            m.setProvider("GOOGLE_MEET");
            m.setMeetingUrl(ev.meetUrl());
            m.setCalendarEventId(ev.id());
            m.setCalendarLink(ev.htmlLink());
        }
        m.setMeetingEndAt(end);
        m.setAttendees(people);
        m.setAutoFireflies(autoFireflies);
        m = store.save(m);
        store.audit(c.org(), m.getId(), c.caller().email(), "MEETING_SCHEDULED", people.size() + " invited");
        automation.plan(m);
        return store.meeting(c.org(), m.getId()).orElse(m);
    }

    /**
     * "Meet now": a Google Meet that starts right away, in the person's Google Calendar (so invitations go out and it is on record), with the
     * same automation as a scheduled meeting - Fireflies is sent as soon as the first person is in the call, then the
     * transcript is fetched and summarised.
     */
    public UmaMeeting instantMeeting(Ctx c, String title, Integer durationMinutes, String timezone, List<String> attendees,
                                     String projectId, boolean autoFireflies) {
        return instantMeeting(c, title, durationMinutes, timezone, attendees, projectId, autoFireflies, null);
    }

    public UmaMeeting instantMeeting(Ctx c, String title, Integer durationMinutes, String timezone, List<String> attendees,
                                     String projectId, boolean autoFireflies, String platform) {
        String zone = com.prowosma.backend.uma.core.UmaCalendar.validZone(timezone);
        String t = title != null && !title.isBlank() ? title
                : "Instant meeting - " + java.time.format.DateTimeFormatter.ofPattern("d MMM, HH:mm").withZone(java.time.ZoneId.of(zone)).format(Instant.now());
        Instant start = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MINUTES);
        UmaMeeting m = scheduleMeeting(c, t, start, durationMinutes == null ? 30 : durationMinutes, zone, attendees, null, projectId, autoFireflies, platform);
        if (m.isAutoFireflies() && m.getStatus() == UmaStatus.CREATED) {
            // Fireflies is sent the moment the first person is in the call (Google Meet tells us; Teams' lobby holds it), so nobody waits for it.
            m.setStatusDetail("Open the meeting now. Fireflies' notetaker asks to join as soon as you're in - admit it" + ("MS_TEAMS".equals(m.getProvider()) ? " from the lobby. " : ". ")
                    + "The summary is ready a few minutes after the meeting ends.");
            m = store.save(m);
        }
        store.audit(c.org(), m.getId(), c.caller().email(), "INSTANT_MEETING", null);
        return m;
    }

    /** Switches the automatic Fireflies join on or off for a meeting that hasn't happened yet. */
    public UmaMeeting setAutoFireflies(Ctx c, String id, boolean on) {
        UmaMeeting m = manageable(c, id);
        if (m.getStatus() != UmaStatus.CREATED) throw new UmaException(HttpStatus.CONFLICT, "HAS_CONTENT", "This meeting already has its content.");
        if (on && fireflies.key(c.org()).isEmpty())
            throw new UmaException(HttpStatus.CONFLICT, "NO_FIREFLIES", "Fireflies isn't connected for this workspace.", "An admin connects it under Connections.");
        m.setAutoFireflies(on);
        m = store.save(m);
        if (!on) queue.cancelType(c.org(), id, UmaPipeline.FIREFLIES_JOIN);
        automation.plan(m);
        return store.meeting(c.org(), id).orElse(m);
    }

    /** Read Google's transcript for this Meet meeting now (and keep checking until it is there). */
    public UmaMeeting fetchFromGoogle(Ctx c, String id) {
        UmaMeeting m = manageable(c, id);
        if (com.prowosma.backend.uma.core.UmaGoogleMeet.meetingCode(m.getMeetingUrl()) == null)
            throw new UmaException(HttpStatus.BAD_REQUEST, "NOT_A_MEET_LINK", "This meeting has no Google Meet link.");
        if (m.getStatus() != UmaStatus.CREATED && m.getStatus() != UmaStatus.FAILED)
            throw new UmaException(HttpStatus.CONFLICT, "HAS_CONTENT", "This meeting already has its content.");
        if (!googleMeet.connected(c.org(), c.caller().email()))
            throw new UmaException(HttpStatus.CONFLICT, "GOOGLE_NOT_CONNECTED", "Your Google account isn't connected.",
                    "Connect it under Connections on the AI Meeting Assistant page, then try again.");
        if (m.getStatus() == UmaStatus.FAILED) m = store.transition(c.org(), id, UmaStatus.CREATED, c.caller().email(), null, "Google fetch again");
        UmaMeeting.GoogleLink g = m.getGoogle() == null ? new UmaMeeting.GoogleLink() : m.getGoogle();
        g.setRequestedBy(c.caller().email()); g.setChecks(0);
        m.setGoogle(g);
        m.setErrorCode(null); m.setRecoveryHint(null);
        m.setStatusDetail("Checking Google Meet for this meeting's transcript…");
        m = store.save(m);
        queue.enqueue(c.org(), id, UmaPipeline.FETCH_GOOGLE, c.caller().email());
        store.audit(c.org(), id, c.caller().email(), "GOOGLE_FETCH_REQUESTED", null);
        return m;
    }

    public UmaMeeting registerLink(Ctx c, String url, String title, String projectId, Instant meetingAt, String timezone) {
        return registerLink(c, url, title, projectId, meetingAt, timezone, false, null);
    }

    public UmaMeeting registerLink(Ctx c, String url, String title, String projectId, Instant meetingAt, String timezone,
                                   boolean autoFireflies, Integer durationMinutes) {
        ProviderRegistry.Detected d = providers.detect(url);
        UmaMeeting m = newMeeting(c, title != null && !title.isBlank() ? title : d.provider().displayName() + " meeting", "MEETING_LINK", projectId, meetingAt, timezone);
        m.setProvider(d.provider().id());
        m.setMeetingUrl(d.url());
        m.setAutoFireflies(autoFireflies);
        if (durationMinutes != null && durationMinutes > 0) m.setMeetingEndAt(m.getMeetingAt().plusSeconds(Math.min(durationMinutes, 720) * 60L));
        m.setStatusDetail("After the meeting, add its recording or transcript here.");
        m = store.save(m);
        store.audit(c.org(), m.getId(), c.caller().email(), "MEETING_REGISTERED", d.provider().id());
        automation.plan(m);
        return store.meeting(c.org(), m.getId()).orElse(m);
    }

    // ── lifecycle ────────────────────────────────────────────────────────

    public UmaMeeting retry(Ctx c, String id) {
        UmaMeeting m = manageable(c, id);
        UmaStatus st = m.getStatus();
        if (st == UmaStatus.ANALYZING || st == UmaStatus.QUEUED || st == UmaStatus.TRANSCRIBING) {
            // "Try again now" while the app is waiting between automatic attempts (for example after changing the AI model in AI Settings).
            boolean analysis = st == UmaStatus.ANALYZING;
            String type = analysis ? UmaPipeline.ANALYZE : UmaPipeline.TRANSCRIBE;
            queue.cancelType(c.org(), id, type);                       // only the one waiting its turn; a step that is running right now is left alone
            queue.enqueue(c.org(), id, type, c.caller().email());
            m.setStatusDetail("Trying again now…");
            m = store.save(m);
            store.audit(c.org(), id, c.caller().email(), "RETRIED_NOW", analysis ? "analysis" : "transcription");
            return m;
        }
        if (st != UmaStatus.FAILED) throw new UmaException(HttpStatus.CONFLICT, "NOT_FAILED", "Only a meeting that needs attention can be retried.");
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

    /** "Stop processing": stops the work but KEEPS the meeting, its transcript and recording. It shows as "Needs attention" with Retry, so nothing is lost. */
    public UmaMeeting stop(Ctx c, String id) {
        UmaMeeting m = manageable(c, id);
        UmaStatus st = m.getStatus();
        if (st != UmaStatus.QUEUED && st != UmaStatus.TRANSCRIBING && st != UmaStatus.ANALYZING)
            throw new UmaException(HttpStatus.CONFLICT, "NOT_PROCESSING", "This meeting isn't being processed.");
        queue.cancel(c.org(), id);
        UmaStatus stage = st == UmaStatus.ANALYZING ? UmaStatus.ANALYZING : UmaStatus.TRANSCRIBING;
        m = store.transition(c.org(), id, UmaStatus.FAILED, c.caller().email(), "Processing was stopped.", "stopped");
        m.setErrorCode("STOPPED");
        m.setRecoveryHint("Nothing was lost. Press Retry when you want to continue.");
        m.setFailedStage(stage);
        m = store.save(m);
        store.audit(c.org(), id, c.caller().email(), "STOPPED", null);
        return m;
    }

    public UmaMeeting cancel(Ctx c, String id) {
        UmaMeeting m = manageable(c, id);
        queue.cancel(c.org(), id);
        if (m.getStatus() == UmaStatus.CAPTURING) { deleteRecordingFile(m); store.save(m); }   // a stopped recording isn't kept
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

    // ── clearing old meetings ────────────────────────────────────────────

    /** Busy meetings are never cleared (they are being recorded or processed); neither is a meeting that hasn't happened yet. */
    static boolean clearable(UmaMeeting m, Instant cutoff, Instant now) {
        if (m.getStatus() == UmaStatus.CAPTURING || m.getStatus().isWorking()) return false;
        Instant when = m.getMeetingAt() != null ? m.getMeetingAt() : m.getCreatedAt();
        if (when == null) return false;
        if (m.getStatus() == UmaStatus.CREATED && (m.getMeetingEndAt() != null ? m.getMeetingEndAt() : when).isAfter(now)) return false;
        return !when.isAfter(cutoff);
    }

    private void wipe(String org, UmaMeeting m, String by, String reason) {
        queue.cancel(org, m.getId());
        deleteRecordingFile(m);
        store.deleteMeeting(org, m.getId());
        store.audit(org, m.getId(), by, "DELETED", reason);
    }

    /** Deletes the chosen meetings the person may manage. Tasks already created from them stay in Tasks. */
    public Map<String, Object> deleteMany(Ctx c, List<String> ids) {
        if (ids == null || ids.isEmpty()) throw new UmaException(HttpStatus.BAD_REQUEST, "NOTHING_CHOSEN", "Choose the meetings to delete.");
        if (ids.size() > 200) throw new UmaException(HttpStatus.BAD_REQUEST, "TOO_MANY", "Delete at most 200 meetings at a time.");
        int deleted = 0;
        List<Map<String, String>> skipped = new ArrayList<>();
        for (String id : new LinkedHashSet<>(ids)) {
            UmaMeeting m = store.meeting(c.org(), id).orElse(null);
            if (m == null || !access.canRead(m, c.caller())) { skipped.add(Map.of("id", String.valueOf(id), "reason", "Not found.")); continue; }
            if (!access.canManage(m, c.caller())) { skipped.add(Map.of("id", id, "reason", "Only the person who added it, or an admin, can delete it.")); continue; }
            wipe(c.org(), m, c.caller().email(), "deleted with others");
            deleted++;
        }
        return Map.of("deleted", deleted, "skipped", skipped);
    }

    /**
     * The person's meetings older than {@code olderThanDays} (0 = every meeting that has already happened). Upcoming meetings and ones
     * being recorded or processed are never included. {@code apply} false only counts them (for the confirmation).
     */
    public Map<String, Object> clearOld(Ctx c, int olderThanDays, boolean apply) {
        if (olderThanDays < 0 || olderThanDays > 3650) throw new UmaException(HttpStatus.BAD_REQUEST, "BAD_AGE", "Choose 0 to 3650 days.");
        Instant now = Instant.now(), cutoff = olderThanDays == 0 ? now : now.minus(java.time.Duration.ofDays(olderThanDays));
        List<UmaMeeting> due = store.meetings(c.org(), 5000).stream()
                .filter(m -> access.canManage(m, c.caller()) && clearable(m, cutoff, now)).toList();
        if (apply) for (UmaMeeting m : due) wipe(c.org(), m, c.caller().email(), "cleared: older than " + olderThanDays + " days");
        return Map.of("count", due.size(), "deleted", apply ? due.size() : 0);
    }

    /** Daily: each workspace's meetings older than its retention (default 15 days) are deleted. Returns how many. */
    public int purgeOldMeetings() {
        Instant now = Instant.now();
        int n = 0;
        for (Object orgId : mongo.getCollection("uma_meetings").distinct("organizationId", String.class)) {
            String org = (String) orgId;
            UmaSettings s = mongo.findById(org, UmaSettings.class);
            int days = s == null ? 15 : s.retentionDays();
            if (days == 0) continue;                                            // this workspace keeps its meetings
            Instant cutoff = now.minus(java.time.Duration.ofDays(days));
            List<UmaMeeting> old = mongo.find(new Query(Criteria.where("organizationId").is(org).orOperator(
                    Criteria.where("meetingAt").lt(cutoff), Criteria.where("meetingAt").is(null).and("createdAt").lt(cutoff))).limit(500), UmaMeeting.class);
            for (UmaMeeting m : old) {
                if (!clearable(m, cutoff, now)) continue;
                wipe(org, m, "system", "older than " + days + " days (workspace setting)");
                n++;
            }
        }
        return n;
    }

    private void deleteRecordingFile(UmaMeeting m) {
        if (m.getRecording() == null) return;
        if (m.getRecording().getFileKey() != null) {
            try { files.delete(m.getRecording().getFileKey()); } catch (IOException ignored) { /* best effort; retention sweep tries again */ }
        }
        for (UmaMeeting.Piece p : m.getRecording().getPieces()) {
            if (p.getFileKey() == null) continue;
            try { files.delete(p.getFileKey()); } catch (IOException ignored) { }
            p.setFileKey(null);
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

    public static String sourceKey(String meetingId, String actionId) { return UmaTaskWriter.sourceKey(meetingId, actionId); }

    /** Approving creates the task in the existing task module. Safe to repeat: the same item never creates a second task. */
    public List<UmaInsights.ActionItem> approve(Ctx c, String id, List<String> actionIds) {
        UmaMeeting m = manageable(c, id);
        UmaInsights ins = insightsFor(c, id);
        List<UmaInsights.ActionItem> out = new ArrayList<>();
        for (String actionId : actionIds) {
            UmaInsights.ActionItem a = action(ins, actionId);
            if ("CREATED".equals(a.getStatus())) { out.add(a); continue; }
            try {
                Task existing = taskWriter.createOrFind(c.org(), m, a, c.caller().email(), true);
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

    // ── projects the meeting asked for ───────────────────────────────────

    /** create: make the project (as the person, with their permissions) · link: use an existing project · dismiss: not wanted. */
    public UmaInsights.ProjectItem projectDecision(Ctx c, String id, String projectItemId, String op, String existingProjectId) {
        UmaMeeting m = manageable(c, id);
        UmaInsights ins = insightsFor(c, id);
        UmaInsights.ProjectItem p = ins.getProjects().stream().filter(x -> x.getId().equals(projectItemId)).findFirst()
                .orElseThrow(() -> new UmaException(HttpStatus.NOT_FOUND, "NOT_FOUND", "That project suggestion isn't in this meeting."));
        if ("CREATED".equals(p.getStatus()) && !"dismiss".equals(op))
            throw new UmaException(HttpStatus.CONFLICT, "ALREADY_CREATED", "This project was already created.");
        switch (op) {
            case "create" -> {
                String key = UmaTaskWriter.sourceKey(id, p.getId());
                com.prowosma.backend.model.Project found = mongo.findOne(new Query(Criteria.where("organizationId").is(c.org()).and("sourceProposalKey").is(key)),
                        com.prowosma.backend.model.Project.class);
                if (found == null) {
                    com.prowosma.backend.model.Project pr = new com.prowosma.backend.model.Project();
                    pr.setName(p.getName());
                    pr.setDescription(((p.getDescription() == null || p.getDescription().isBlank()) ? "" : p.getDescription() + "\n\n")
                            + "Created from the meeting \"" + m.getTitle() + "\" (AI Meeting Assistant).");
                    pr.setStatus("ACTIVE");
                    pr.setSourceMeetingId(id); pr.setSourceMeetingTitle(m.getTitle()); pr.setSourceProposalKey(key);
                    try { found = projectService.create(pr); }
                    catch (org.springframework.dao.DuplicateKeyException race) {
                        found = mongo.findOne(new Query(Criteria.where("organizationId").is(c.org()).and("sourceProposalKey").is(key)), com.prowosma.backend.model.Project.class);
                        if (found == null) throw race;
                    }
                }
                p.setStatus("CREATED"); p.setProjectId(found.getId()); p.setAutomatic(false);
            }
            case "link" -> {
                com.prowosma.backend.model.Project target = existingProjectId == null ? null : mongo.findById(existingProjectId, com.prowosma.backend.model.Project.class);
                if (target == null || !c.org().equals(target.getOrganizationId())) throw new UmaException(HttpStatus.BAD_REQUEST, "NO_SUCH_PROJECT", "Choose a project in this workspace.");
                projectService.getById(target.getId());                                         // the person must be able to see it
                p.setStatus("LINKED"); p.setProjectId(target.getId()); p.setAutomatic(false);
            }
            case "dismiss" -> { if (!"CREATED".equals(p.getStatus())) p.setStatus("DISMISSED"); }
            default -> throw new UmaException(HttpStatus.BAD_REQUEST, "BAD_OPERATION", "Unknown operation.");
        }
        p.setReviewReason(null); p.setDecidedBy(c.caller().email()); p.setDecidedAt(Instant.now());
        // Pending actions with no project yet follow the project the person just chose.
        if (!"dismiss".equals(op) && m.getProjectId() == null)
            for (UmaInsights.ActionItem a : ins.getActions())
                if ("PENDING".equals(a.getStatus()) && a.getProjectId() == null) a.setProjectId(p.getProjectId());
        store.saveInsights(ins);
        store.audit(c.org(), id, c.caller().email(), "PROJECT_" + op.toUpperCase(Locale.ROOT), p.getId() + (p.getProjectId() == null ? "" : " -> " + p.getProjectId()));
        completeIfAllDecided(c, id, ins);
        return p;
    }

    // ── automation settings ──────────────────────────────────────────────

    public Map<String, Object> automationSettings(Ctx c) {
        UmaSettings s = mongo.findById(c.org(), UmaSettings.class);
        if (s == null) s = new UmaSettings();
        UmaUserPrefs mine = postMeeting.prefs(c.org(), c.caller().email());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("workspace", Map.of("autoCreateTasks", s.tasksOn(), "autoAssign", s.assignOn(), "autoCreateProjects", s.projectsOn(),
                "maxAutoTasksPerMeeting", s.maxTasks(), "meetingRetentionDays", s.retentionDays()));
        out.put("mine", Map.of("defaultPlatform", mine.getDefaultPlatform(), "autoTasks", mine.isAutoTasks()));
        out.put("canChangeWorkspace", c.caller().admin());
        return out;
    }

    public Map<String, Object> saveWorkspaceAutomation(Ctx c, Map<String, Object> body) {
        if (!c.caller().admin()) throw new UmaException(HttpStatus.FORBIDDEN, "ADMIN_ONLY", "Only a workspace admin can change what the assistant does on its own.");
        UmaSettings s = mongo.findById(c.org(), UmaSettings.class);
        if (s == null) { s = new UmaSettings(); s.setId(c.org()); }
        if (body.get("autoCreateTasks") instanceof Boolean b) s.setAutoCreateTasks(b);
        if (body.get("autoAssign") instanceof Boolean b) s.setAutoAssign(b);
        if (body.get("autoCreateProjects") instanceof Boolean b) s.setAutoCreateProjects(b);
        if (body.get("maxAutoTasksPerMeeting") instanceof Number n) s.setMaxAutoTasksPerMeeting(Math.max(0, Math.min(100, n.intValue())));
        if (body.get("meetingRetentionDays") instanceof Number n) {
            if (n.intValue() < 0 || n.intValue() > 3650) throw new UmaException(HttpStatus.BAD_REQUEST, "BAD_AGE", "Choose 0 (keep) to 3650 days.");
            s.setMeetingRetentionDays(n.intValue());
        }
        mongo.save(s);
        store.audit(c.org(), "settings", c.caller().email(), "AUTOMATION_SETTINGS_CHANGED", s.tasksOn() + "/" + s.assignOn() + "/" + s.projectsOn() + "/" + s.maxTasks() + "/keep " + s.retentionDays() + "d");
        return automationSettings(c);
    }

    public Map<String, Object> saveMyPreferences(Ctx c, Map<String, Object> body) {
        UmaUserPrefs p = postMeeting.prefs(c.org(), c.caller().email());
        if (body.get("defaultPlatform") instanceof String d) {
            if (!Set.of("GOOGLE_MEET", "MS_TEAMS").contains(d)) throw new UmaException(HttpStatus.BAD_REQUEST, "BAD_PLATFORM", "Choose Google Meet or Microsoft Teams.");
            p.setDefaultPlatform(d);
        }
        if (body.get("autoTasks") instanceof Boolean b) p.setAutoTasks(b);
        p.setUpdatedAt(Instant.now());
        mongo.save(p);
        return automationSettings(c);
    }

    private void completeIfAllDecided(Ctx c, String id, UmaInsights ins) {
        boolean open = ins.getActions().stream().anyMatch(a -> "PENDING".equals(a.getStatus()) || "FAILED".equals(a.getStatus()))
                || ins.getProjects().stream().anyMatch(p -> "PROPOSED".equals(p.getStatus()));
        UmaMeeting m = store.meeting(c.org(), id).orElse(null);
        if (!open && m != null && m.getStatus() == UmaStatus.REVIEW_READY)
            store.transition(c.org(), id, UmaStatus.COMPLETED, c.caller().email(), "All action items have been reviewed.", "all actions decided");
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
        List<UmaMeeting> due = mongo.find(new Query(new Criteria().orOperator(
                        Criteria.where("recording.fileKey").ne(null), Criteria.where("recording.pieces.fileKey").ne(null))
                .and("recording.deletedAt").is(null).and("transcript.origin").is("STT").and("updatedAt").lt(cutoff)).limit(100), UmaMeeting.class);
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

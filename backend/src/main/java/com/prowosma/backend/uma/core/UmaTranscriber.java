package com.prowosma.backend.uma.core;

import com.prowosma.backend.integration.OpenAiCompatibleSttClient;
import com.prowosma.backend.integration.SpeechToTextClient;
import com.prowosma.backend.integration.SttException;
import com.prowosma.backend.model.MeetingAssistantSettings;
import com.prowosma.backend.repository.MeetingAssistantSettingsRepository;
import com.prowosma.backend.service.FieldEncryptionService;
import com.prowosma.backend.service.FileStorageService;
import com.prowosma.backend.uma.model.UmaMeeting;
import com.prowosma.backend.uma.model.UmaSegment;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.function.IntConsumer;
import java.util.stream.Stream;

/**
 * Turns an uploaded recording into timed transcript lines, one piece at a time, recording progress after every piece so an
 * interrupted run resumes where it stopped. The engine is replaceable: any server speaking the OpenAI transcription API
 * (the self-hosted faster-whisper server in tools/stt-server, OpenAI, Groq, …). Which one:
 * <ol>
 *   <li>the operator's server from {@code app.uma.stt.base-url} (may be on a private address — it is set by whoever runs the server), else</li>
 *   <li>the workspace's speech-to-text setting that an admin saved for the existing assistant (read only).</li>
 * </ol>
 * Speakers are not separated (no diarization): every line is "unknown speaker" rather than a guessed name.
 */
@Component
@Slf4j
public class UmaTranscriber {

    public record Engine(String label, String model, SpeechToTextClient client, SpeechToTextClient.Settings settings) {}

    private final OpenAiCompatibleSttClient workspaceClient;
    private final OpenAiCompatibleSttClient operatorClient;
    private final MeetingAssistantSettingsRepository settingsRepo;
    private final FieldEncryptionService crypto;
    private final FileStorageService files;
    private final UmaStore store;

    @Value("${app.uma.stt.base-url:}") private String operatorUrl = "";
    @Value("${app.uma.stt.api-key:}") private String operatorKey = "";
    @Value("${app.uma.stt.model:}") private String operatorModel = "";
    @Value("${app.uma.stt.language:}") private String operatorLanguage = "";
    @Value("${app.uma.stt.chunk-seconds:600}") private int chunkSeconds = AudioSplitter.DEFAULT_CHUNK_SECONDS;

    public UmaTranscriber(OpenAiCompatibleSttClient workspaceClient, OperatorHttp operatorHttp, MeetingAssistantSettingsRepository settingsRepo,
                          FieldEncryptionService crypto, FileStorageService files, UmaStore store) {
        this.workspaceClient = workspaceClient;
        this.operatorClient = new OpenAiCompatibleSttClient(operatorHttp.stt());
        this.operatorClient.setAllowPrivateHosts(true);
        this.settingsRepo = settingsRepo;
        this.crypto = crypto;
        this.files = files;
        this.store = store;
    }

    /** Test seam: lets tests point the operator engine at a fake. */
    void configureOperator(String url, String model) { this.operatorUrl = url; this.operatorModel = model; }

    /** The engine this workspace would use, or null with no engine configured. */
    public Engine engine(String org) {
        if (operatorUrl != null && !operatorUrl.isBlank())
            return new Engine("Self-hosted (server setting)", blankToNull(operatorModel), operatorClient,
                    new SpeechToTextClient.Settings(operatorUrl.trim(), blankToNull(operatorKey), blankToNull(operatorModel), blankToNull(operatorLanguage)));
        MeetingAssistantSettings s = settingsRepo.findByOrganizationId(org).orElse(null);
        if (s == null || s.getSttBaseUrl() == null || s.getSttBaseUrl().isBlank()) return null;
        String key = s.getSttApiKeyEnc() == null ? null : crypto.decrypt(s.getSttApiKeyEnc());
        return new Engine("Workspace speech-to-text server", blankToNull(s.getSttModel()), workspaceClient,
                new SpeechToTextClient.Settings(s.getSttBaseUrl(), key, s.getSttModel(), s.getSttLanguage()));
    }

    public String notReadyReason(String org) {
        return engine(org) == null
                ? "No speech-to-text server is set up. An admin can add one (a free self-hosted server works) - see the setup guide."
                : null;
    }

    public record Outcome(String language, int segments, String engine, String model, long processingMs) {}

    /**
     * Transcribes the meeting's recording from the first piece not yet done. {@code heartbeat} is called between pieces
     * (keeps the job's lease alive). Throws UmaException with a plain-language reason on failure.
     */
    public Outcome transcribe(UmaMeeting m, IntConsumer heartbeat) {
        String org = m.getOrganizationId();
        Engine engine = engine(org);
        if (engine == null) throw new UmaException(HttpStatus.FAILED_DEPENDENCY, "NO_STT", notReadyReason(org),
                "Set up a speech-to-text server, then press Retry.");
        UmaMeeting.Recording rec = m.getRecording();
        if (rec != null && !rec.getPieces().isEmpty()) return transcribePieces(m, engine, heartbeat);
        if (rec == null || rec.getFileKey() == null)
            throw new UmaException(HttpStatus.GONE, "NO_RECORDING", "The recording is no longer stored.", "Upload the recording again.");

        long started = System.currentTimeMillis();
        Path dir = null;
        try {
            dir = Files.createTempDirectory("uma-");
            Path input = dir.resolve("input" + extension(rec.getFileName()));
            try (InputStream in = files.openStream(rec.getFileKey())) { Files.copy(in, input, StandardCopyOption.REPLACE_EXISTING); }

            boolean canSplit = AudioSplitter.ffmpegAvailable();
            Long duration = canSplit ? AudioSplitter.durationMs(input) : null;
            if (canSplit && duration == null)
                throw new UmaException(HttpStatus.UNPROCESSABLE_CONTENT, "UNREADABLE_AUDIO",
                        "This file doesn't contain audio we can read. It may be damaged or in an unsupported format.",
                        "Export the recording again as MP3, M4A, WAV, MP4 or WebM and upload that.");
            List<Long> starts = canSplit ? AudioSplitter.plan(duration, chunkSeconds) : List.of(0L);
            rec.setDurationMs(duration);
            rec.setChunksTotal(starts.size());

            // Resume: keep lines from finished pieces, drop any half-written lines of the piece that was interrupted.
            int done = Math.min(rec.getChunksDone(), starts.size());
            List<UmaSegment> kept = new ArrayList<>(store.segments(org, m.getId()));
            if (done == 0) { store.replaceSegments(org, m.getId(), List.of()); kept.clear(); }
            else {
                long resumeAt = starts.get(done);
                kept.removeIf(s -> s.getStartMs() != null && s.getStartMs() >= resumeAt);
                store.replaceSegments(org, m.getId(), kept);
            }
            int seq = kept.size();
            String language = m.getTranscript() == null ? null : m.getTranscript().getLanguage();

            for (int i = done; i < starts.size(); i++) {
                heartbeat.accept(i);
                byte[] audio; String mime; String name;
                if (canSplit) {
                    AudioSplitter.Piece p = AudioSplitter.cut(input, i, starts.get(i), chunkSeconds, dir);
                    audio = Files.readAllBytes(p.file()); mime = p.mimeType(); name = p.file().getFileName().toString();
                    Files.deleteIfExists(p.file());
                } else {
                    audio = Files.readAllBytes(input); mime = rec.getMimeType(); name = rec.getFileName();
                }
                SpeechToTextClient.Result r = engine.client().transcribe(engine.settings(), audio, mime, name);
                if (language == null && r.language() != null && !r.language().isBlank()) language = r.language();
                List<UmaSegment> batch = new ArrayList<>();
                for (SpeechToTextClient.Segment s : r.segments()) {
                    String text = s.text() == null ? "" : s.text().strip();
                    if (text.isEmpty()) continue;
                    if (s.noSpeechProb() != null && s.noSpeechProb() > 0.9 && text.length() < 4) continue;   // background noise
                    UmaSegment seg = new UmaSegment();
                    seg.setOrganizationId(org); seg.setMeetingId(m.getId()); seg.setSeq(++seq);
                    seg.setStartMs(starts.get(i) + s.startMs()); seg.setEndMs(starts.get(i) + s.endMs());
                    seg.setText(text);
                    batch.add(seg);
                }
                store.appendSegments(batch);
                rec.setChunksDone(i + 1);
                m.setProgressPercent((int) Math.round(80.0 * (i + 1) / starts.size()));
                store.save(m);
            }
            if (seq == 0)
                throw new UmaException(HttpStatus.UNPROCESSABLE_CONTENT, "NO_SPEECH", "No speech was found in this recording.",
                        "Check that the right file was uploaded and that the audio isn't silent or muted.");
            return new Outcome(language, seq, engine.label(), engine.model(), System.currentTimeMillis() - started);
        } catch (SttException e) {
            String code = "STT_" + e.getKind().name();
            String hint = switch (e.getKind()) {
                case AUTH -> "An admin needs to fix the speech-to-text key, then press Retry.";
                case NOT_FOUND -> "An admin needs to check the speech-to-text address and model, then press Retry.";
                case BAD_INPUT -> "Try a different file format (MP3 or WAV), then upload again.";
                default -> "This usually passes. Press Retry in a few minutes.";
            };
            throw new UmaException(e.isTransient() ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.BAD_GATEWAY, code, e.getMessage(), hint);
        } catch (IOException e) {
            throw new UmaException(HttpStatus.SERVICE_UNAVAILABLE, "AUDIO_IO", "We couldn't read or convert the recording.", "Press Retry. If it fails again, upload the file again.");
        } finally {
            if (dir != null) deleteQuietly(dir);
        }
    }

    /**
     * A meeting recorded in the browser: each short piece of each track (the meeting tab and the recording person's microphone)
     * is transcribed on its own and its result saved, so an interrupted run carries on with the next piece. When all are done they
     * are merged on the meeting clock; the microphone's echo of the meeting is removed (RecordingMerger, shared with the existing assistant).
     */
    private Outcome transcribePieces(UmaMeeting m, Engine engine, IntConsumer heartbeat) {
        String org = m.getOrganizationId();
        long started = System.currentTimeMillis();
        UmaMeeting.Recording rec = m.getRecording();
        List<UmaMeeting.Piece> pieces = new ArrayList<>(rec.getPieces());
        pieces.sort(Comparator.comparingLong(UmaMeeting.Piece::getStartMs).thenComparing(UmaMeeting.Piece::getTrack));
        rec.setChunksTotal(pieces.size());
        String language = m.getTranscript() == null ? null : m.getTranscript().getLanguage();
        int done = 0;
        try {
            for (UmaMeeting.Piece p : pieces) {
                if (p.isTranscribed()) { done++; continue; }
                heartbeat.accept(done);
                if (p.getFileKey() == null) { p.setTranscribed(true); done++; continue; }      // already deleted: nothing to hear
                byte[] audio;
                try (InputStream in = files.openStream(p.getFileKey())) { audio = in.readAllBytes(); }
                String kind = com.prowosma.backend.meetingassistant.RecordingRules.audioKind(audio);
                String ext = kind == null ? "webm" : kind;
                SpeechToTextClient.Result r = engine.client().transcribe(engine.settings(), audio,
                        com.prowosma.backend.meetingassistant.RecordingRules.mimeOf(ext), p.getTrack().toLowerCase() + "-" + p.getSeq() + "." + ext);
                if (language == null && r.language() != null && !r.language().isBlank()) language = r.language();
                p.getPhrases().clear();
                for (SpeechToTextClient.Segment seg : r.segments()) {
                    UmaMeeting.Phrase ph = new UmaMeeting.Phrase();
                    ph.setStartMs(seg.startMs()); ph.setEndMs(seg.endMs()); ph.setText(seg.text()); ph.setNoSpeechProb(seg.noSpeechProb());
                    p.getPhrases().add(ph);
                }
                p.setTranscribed(true);
                done++;
                rec.setPieces(pieces);
                rec.setChunksDone(done);
                m.setProgressPercent((int) Math.round(80.0 * done / pieces.size()));
                store.save(m);
            }
        } catch (SttException e) {
            String code = "STT_" + e.getKind().name();
            throw new UmaException(e.isTransient() ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.BAD_GATEWAY, code, e.getMessage(),
                    e.isTransient() ? "This usually passes. Press Retry in a few minutes." : "An admin needs to check the speech-to-text settings, then press Retry.");
        } catch (IOException e) {
            throw new UmaException(HttpStatus.SERVICE_UNAVAILABLE, "AUDIO_IO", "We couldn't read the recorded audio.", "Press Retry.");
        }

        List<com.prowosma.backend.meetingassistant.RecordingMerger.Piece> merged = new ArrayList<>();
        for (UmaMeeting.Piece p : pieces) {
            List<com.prowosma.backend.meetingassistant.RecordingMerger.Seg> segs = new ArrayList<>();
            for (UmaMeeting.Phrase ph : p.getPhrases())
                segs.add(new com.prowosma.backend.meetingassistant.RecordingMerger.Seg(ph.getStartMs(), ph.getEndMs(), ph.getText(), ph.getNoSpeechProb()));
            merged.add(new com.prowosma.backend.meetingassistant.RecordingMerger.Piece(p.getTrack(), p.getStartMs(), segs));
        }
        String me = rec.getRecorderName() == null || rec.getRecorderName().isBlank() ? com.prowosma.backend.meetingassistant.RecordingMerger.YOU : rec.getRecorderName();
        List<UmaSegment> out = new ArrayList<>();
        int seq = 0;
        long end = 0;
        for (com.prowosma.backend.meetingassistant.RecordingMerger.Line l : com.prowosma.backend.meetingassistant.RecordingMerger.merge(merged)) {
            UmaSegment u = new UmaSegment();
            u.setOrganizationId(org); u.setMeetingId(m.getId()); u.setSeq(++seq);
            u.setStartMs(l.startMs()); u.setEndMs(l.endMs());
            u.setSpeaker(com.prowosma.backend.meetingassistant.RecordingMerger.YOU.equals(l.speaker()) ? me : l.speaker());
            u.setText(l.text());
            out.add(u);
            end = Math.max(end, l.endMs());
        }
        if (out.isEmpty())
            throw new UmaException(HttpStatus.UNPROCESSABLE_CONTENT, "NO_SPEECH", "No speech was heard in this recording.",
                    "Check that you shared the meeting tab with “Share tab audio” ticked, and that your microphone wasn't muted.");
        store.replaceSegments(org, m.getId(), out);
        long dur = pieces.stream().mapToLong(p -> p.getStartMs() + p.getDurationMs()).max().orElse(end);
        rec.setDurationMs(dur);
        store.save(m);
        return new Outcome(language, out.size(), engine.label(), engine.model(), System.currentTimeMillis() - started);
    }

    private static String extension(String name) {
        if (name == null || !name.contains(".")) return ".audio";
        String e = name.substring(name.lastIndexOf('.')).toLowerCase(java.util.Locale.ROOT);
        return e.matches("\\.[a-z0-9]{1,5}") ? e : ".audio";
    }

    private static String blankToNull(String s) { return s == null || s.isBlank() ? null : s.trim(); }

    private static void deleteQuietly(Path dir) {
        try (Stream<Path> walk = Files.walk(dir)) {
            walk.sorted(Comparator.reverseOrder()).forEach(p -> { try { Files.deleteIfExists(p); } catch (IOException ignored) { } });
        } catch (IOException ignored) { }
    }
}

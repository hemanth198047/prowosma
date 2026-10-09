package com.prowosma.backend.service;

import com.prowosma.backend.integration.SpeechToTextClient;
import com.prowosma.backend.integration.SttException;
import com.prowosma.backend.meetingassistant.RecordingMerger;
import com.prowosma.backend.meetingassistant.RecordingRules;
import com.prowosma.backend.meetingassistant.SessionStatus;
import com.prowosma.backend.model.MeetingAssistantSettings;
import com.prowosma.backend.model.MeetingAudioChunk;
import com.prowosma.backend.model.MeetingJob;
import com.prowosma.backend.model.MeetingSession;
import com.prowosma.backend.model.TranscriptSegment;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Turns a meeting's stored audio into a transcript with the speech-to-text server an admin configured, then hands it to the same pipeline an uploaded
 * or Google-imported transcript goes through (summary, minutes, actions). Each audio piece is saved as it finishes, so a retry only redoes what is missing.
 */
@Component
@RequiredArgsConstructor
public class TranscribeRecordingHandler implements MeetingJobHandler {

    public static final String TYPE = "TRANSCRIBE_RECORDING";

    private final MeetingSessionStore store;
    private final MeetingRecordingService recordings;
    private final SpeechToTextClient stt;
    private final MeetingTranscriptService transcripts;
    private final MeetingOutputService outputs;
    private final MeetingJobService jobs;

    @Override
    public String type() { return TYPE; }

    @Override
    public JobOutcome handle(MeetingJob job) {
        final String org = job.getOrganizationId();
        MeetingSession s = store.find(org, job.getSessionId()).orElse(null);
        if (s == null) return JobOutcome.done();
        String state = s.getRecordingState();
        SessionStatus status = SessionStatus.valueOf(s.getStatus());
        // deleted, expired, cancelled, already turned into text, or the meeting got its transcript another way: nothing to do
        if (!("UPLOADED".equals(state) || "TRANSCRIBING".equals(state))) return JobOutcome.done();
        if (status != SessionStatus.AWAITING_TRANSCRIPT && status != SessionStatus.SCHEDULED) return JobOutcome.done();

        MeetingAssistantSettings st = recordings.settings(org);
        String notReady = recordings.transcriptionNotReadyReason(st);
        if (notReady != null)
            return JobOutcome.fail("STT_NOT_CONFIGURED", notReady, "Fix the speech-to-text settings, then press Retry. The recording is kept until " + keptUntil(s) + ".");

        List<MeetingAudioChunk> chunks = recordings.chunks(org, s.getId());
        if (chunks.isEmpty())
            return JobOutcome.fail("AUDIO_MISSING", "The recording is no longer stored (audio is deleted after a set time).",
                    "Record again, or upload the transcript or a recording.");

        recordings.setState(org, s.getId(), "TRANSCRIBING");
        SpeechToTextClient.Settings cfg = recordings.sttSettings(st);
        int total = chunks.size();
        int done = (int) chunks.stream().filter(c -> "DONE".equals(c.getStatus())).count();

        for (MeetingAudioChunk c : chunks) {
            if ("DONE".equals(c.getStatus())) continue;
            jobs.extendLease(job);                                       // a long piece on a slow server must not lose its lease
            try {
                byte[] audio = recordings.audio(c);
                SpeechToTextClient.Result r = stt.transcribe(cfg, audio, RecordingRules.mimeOf(c.getKind()), "part-" + c.getTrack() + "-" + c.getSeq() + "." + c.getKind());
                recordings.markDone(c, r);
            } catch (SttException e) {
                recordings.noteFailure(c, e);
                if (e.isTransient()) {
                    store.recordCheck(org, s.getId(), "RECORDING_RETRY", "The speech-to-text server wasn't available just now (" + e.getMessage()
                            + ") Prowosma will try again automatically.", progress(done, total));
                    return JobOutcome.retryError(Instant.now().plus(backoff(job.getErrorStreak())), "STT_TRANSIENT");
                }
                String code = "STT_" + e.getKind().name();
                String recovery = switch (e.getKind()) {
                    case AUTH, NOT_FOUND -> "Fix the speech-to-text settings, then press Retry. The recording is kept until " + keptUntil(s) + ".";
                    default -> "Press Retry, or upload the transcript instead. The recording is kept until " + keptUntil(s) + ".";
                };
                return JobOutcome.fail(code, "Turning the recording into text failed: " + e.getMessage(), recovery);
            }
            done++;
            store.recordCheck(org, s.getId(), "RECORDING_PROGRESS", "Turning your recording into text: " + done + " of " + total + " parts done.", progress(done, total));
        }

        // every piece has text — put the two tracks together on the meeting's clock
        List<RecordingMerger.Piece> pieces = new ArrayList<>();
        for (MeetingAudioChunk c : recordings.chunks(org, s.getId())) {
            List<RecordingMerger.Seg> segs = new ArrayList<>();
            for (MeetingAudioChunk.Phrase p : c.getPhrases()) segs.add(new RecordingMerger.Seg(p.getStartMs(), p.getEndMs(), p.getText(), p.getNoSpeechProb()));
            pieces.add(new RecordingMerger.Piece(c.getTrack(), c.getStartMs(), segs));
        }
        List<RecordingMerger.Line> lines = RecordingMerger.merge(pieces);
        if (lines.isEmpty())
            return JobOutcome.fail("NO_SPEECH", "No speech was found in the recording. If you shared a meeting tab, check that \"Share tab audio\" was ticked and that people were talking.",
                    "Record again, or upload a transcript. The recording is kept until " + keptUntil(s) + ".");
        if (lines.size() > com.prowosma.backend.meetingassistant.TranscriptParser.MAX_SEGMENTS)
            return JobOutcome.fail("TRANSCRIPT_TOO_LONG", "This recording's transcript is too long to import in one go.", "Split the recording and upload the parts one at a time.");

        String language = chunks.stream().map(MeetingAudioChunk::getLanguage).filter(l -> l != null && !l.isBlank()).findFirst().orElse(null);
        List<TranscriptSegment> segments = new ArrayList<>();
        for (RecordingMerger.Line l : lines) {
            TranscriptSegment seg = new TranscriptSegment();
            seg.setText(l.text());
            seg.setSpeakerLabel(l.speaker());                                 // null (unknown) for an uploaded file
            seg.setStartMs(l.startMs());
            seg.setEndMs(l.endMs());
            seg.setLanguageCode(language);
            seg.setSource("RECORDING");
            segments.add(seg);
        }
        boolean mixed = chunks.stream().allMatch(c -> RecordingRules.TRACK_MIXED.equals(c.getTrack()));
        String note = "Recorded and turned into text by speech recognition, which can make mistakes. "
                + (mixed ? "The speakers can't be told apart in a recording file, so they are shown as unknown." : "Speakers are only told apart as \"You\" and \"Other participants\".");
        String by = job.getRequestedBy() == null ? "system" : job.getRequestedBy();
        MeetingSession saved = transcripts.receive(s, segments, "RECORDING", "RECORDED", note, by, outputs.receivedDetail(org, segments.size()));
        recordings.markTranscribed(org, s.getId());
        store.recordCheck(org, s.getId(), "IMPORTED", "The recording was turned into a transcript (" + segments.size() + " lines).", progress(total, total));
        outputs.startIfEnabled(saved, by);
        jobs.cancelForSession(org, s.getId());                                // a transcript is here; stop any automatic search for another
        return JobOutcome.done();
    }

    private static Duration backoff(int errorStreak) {
        return Duration.ofSeconds(Math.min(600L, 30L << Math.min(Math.max(errorStreak, 0), 5)));
    }

    private static Map<String, Object> progress(int done, int total) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("partsDone", done);
        m.put("partsTotal", total);
        return m;
    }

    private static String keptUntil(MeetingSession s) {
        return s.getAudioExpiresAt() == null ? "its deletion time" : s.getAudioExpiresAt().toString();
    }
}

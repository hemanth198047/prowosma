package com.prowosma.backend.meetingassistant;

import com.prowosma.backend.integration.FirefliesApi;
import com.prowosma.backend.integration.FirefliesException;
import com.prowosma.backend.meetingassistant.FirefliesMatcher.Summary;
import com.prowosma.backend.model.MeetingAssistantSettings;
import com.prowosma.backend.model.MeetingJob;
import com.prowosma.backend.model.MeetingSession;
import com.prowosma.backend.model.TranscriptSegment;
import com.prowosma.backend.service.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;

/** Runs the real Fireflies polling job with in-memory stand-ins for storage and Fireflies — no Spring, no database, no network. */
@DisplayName("Waiting for a Fireflies notetaker's transcript")
class FirefliesFetchHandlerTest {

    private static final String ORG = "org1", SID = "s1", LINK = "https://meet.google.com/abc-defg-hij";

    static class Store extends MeetingSessionStore {
        final Map<String, MeetingSession> sessions = new HashMap<>();
        final List<String> checks = new ArrayList<>();
        Store() { super(null, null); }
        @Override public Optional<MeetingSession> find(String org, String id) { return Optional.ofNullable(sessions.get(id)); }
        @Override public void recordCheck(String org, String id, String code, String message, Map<String, Object> facts) { checks.add(code + "|" + message); }
    }

    static class Transcripts extends MeetingTranscriptService {
        List<TranscriptSegment> received; String source, capture, note;
        Transcripts() { super(null, null, null); }
        @Override public MeetingSession receive(MeetingSession s, List<TranscriptSegment> segs, String source, String capture, String note, String by, String detail) {
            this.received = segs; this.source = source; this.capture = capture; this.note = note; s.setStatus("TRANSCRIPT_RECEIVED"); return s;
        }
    }

    static class Outputs extends MeetingOutputService {
        int started;
        Outputs() { super(null, null, null, null, null, null); }
        @Override public MeetingSession startIfEnabled(MeetingSession s, String by) { started++; return s; }
        @Override public String receivedDetail(String org, int lines) { return lines + " lines"; }
    }

    static class Fireflies extends MeetingFirefliesService {
        final MeetingAssistantSettings settings = new MeetingAssistantSettings();
        List<Summary> recent = new ArrayList<>(); RuntimeException recentFails; Optional<FirefliesApi.Transcript> transcript = Optional.empty(); RuntimeException transcriptFails;
        final Set<String> claimedElsewhere = new HashSet<>(); boolean claimRaceLost; final List<String> claims = new ArrayList<>(); int apiCalls; boolean imported; String notReady;
        Fireflies() { super(null, null, null, null, null, null); settings.setFirefliesEnabled(true); }
        @Override public MeetingAssistantSettings settings(String org) { return settings; }
        @Override public String fetchNotReadyReason(MeetingAssistantSettings st) { return notReady; }
        @Override public String apiKey(MeetingAssistantSettings st) { return "ff-key"; }
        @Override public List<Summary> recentCached(String org, String apiKey) { apiCalls++; if (recentFails != null) throw recentFails; return recent; }
        @Override public Optional<FirefliesApi.Transcript> transcript(String apiKey, String id) { apiCalls++; if (transcriptFails != null) throw transcriptFails; return transcript; }
        @Override public boolean isClaimed(String org, String id) { return claimedElsewhere.contains(id); }
        @Override public boolean claim(String org, String sessionId, String id) { claims.add(id); return !claimRaceLost; }
        @Override public void markImported(String org, String sessionId) { imported = true; store().sessions.get(sessionId).setFirefliesState("IMPORTED"); }
        Store store; Store store() { return store; }
    }

    private Store store; private Fireflies ff; private Transcripts transcripts; private Outputs outputs; private FirefliesTranscriptFetchHandler handler;

    @BeforeEach void setUp() {
        store = new Store(); ff = new Fireflies(); ff.store = store; transcripts = new Transcripts(); outputs = new Outputs();
        handler = new FirefliesTranscriptFetchHandler(store, ff, transcripts, outputs);
        MeetingSession s = new MeetingSession();
        s.setId(SID); s.setOrganizationId(ORG); s.setStatus("AWAITING_TRANSCRIPT"); s.setFirefliesState("SENT"); s.setMeetingUrl(LINK);
        s.setNotetakerSentAt(Instant.now().minus(30, ChronoUnit.MINUTES)); s.setCreatedAt(Instant.now().minus(31, ChronoUnit.MINUTES));
        store.sessions.put(SID, s);
    }

    private MeetingJob job() { MeetingJob j = new MeetingJob(); j.setOrganizationId(ORG); j.setSessionId(SID); j.setRequestedBy("me@corp.com"); return j; }
    private Summary summary(String id, String link, boolean live) { return new Summary(id, "Weekly sync", link, Instant.now().minus(25, ChronoUnit.MINUTES), live); }
    private FirefliesApi.Transcript transcript(boolean live, FirefliesMapper.Sentence... s) { return new FirefliesApi.Transcript("t1", "Weekly sync", LINK, Instant.now(), live, 30.0, List.of(s)); }
    private void minutesAgoSent(int minutes) { store.sessions.get(SID).setNotetakerSentAt(Instant.now().minus(minutes, ChronoUnit.MINUTES)); }

    // ── success ──────────────────────────────────────────────────────────────

    @Test @DisplayName("imports the transcript with Fireflies' real speaker names, through the normal pipeline, and never twice")
    void imports() {
        ff.recent = List.of(summary("other", "https://meet.google.com/zzz-yyyy-xxx", false), summary("t1", LINK + "?authuser=1", false));
        ff.transcript = Optional.of(transcript(false, new FirefliesMapper.Sentence("Priya Sharma", "Welcome everyone.", 1.5, 3.0), new FirefliesMapper.Sentence("Arjun", "Let's begin.", 4.0, 6.0)));
        JobOutcome out = handler.handle(job());
        assertThat(out.kind()).isEqualTo(JobOutcome.Kind.DONE);
        assertThat(transcripts.received).extracting(TranscriptSegment::getSpeakerLabel).containsExactly("Priya Sharma", "Arjun");
        assertThat(transcripts.received.get(0).getStartMs()).isEqualTo(1500L);
        assertThat(transcripts.received.get(0).getSource()).isEqualTo("FIREFLIES");
        assertThat(transcripts.source).isEqualTo("FIREFLIES");
        assertThat(transcripts.capture).isEqualTo("NOTETAKER");
        assertThat(transcripts.note).contains("Speaker names come from Fireflies");
        assertThat(ff.claims).containsExactly("t1");                          // reserved BEFORE importing
        assertThat(ff.imported).isTrue();
        assertThat(outputs.started).isEqualTo(1);
        assertThat(store.checks).anyMatch(c -> c.startsWith("FIREFLIES_IMPORTED|") && c.contains("2 lines"));
        assertThat(handler.handle(job()).kind()).isEqualTo(JobOutcome.Kind.DONE);                  // asked again: nothing more happens
        assertThat(transcripts.received).hasSize(2);
        assertThat(outputs.started).isEqualTo(1);
    }

    @Test @DisplayName("a transcript another meeting already took is not imported here")
    void ignoresClaimedTranscripts() {
        ff.recent = List.of(summary("taken", LINK, false));
        ff.claimedElsewhere.add("taken");
        JobOutcome out = handler.handle(job());
        assertThat(out.kind()).isEqualTo(JobOutcome.Kind.RETRY);
        assertThat(transcripts.received).isNull();
        assertThat(store.checks).anyMatch(c -> c.contains("already imported for another meeting"));
    }

    @Test @DisplayName("if two checks race for one transcript and this one loses, nothing is imported and it looks again shortly")
    void lostRace() {
        ff.recent = List.of(summary("t1", LINK, false));
        ff.transcript = Optional.of(transcript(false, new FirefliesMapper.Sentence("A", "Hello", 1.0, 2.0)));
        ff.claimRaceLost = true;
        JobOutcome out = handler.handle(job());
        assertThat(out.kind()).isEqualTo(JobOutcome.Kind.RETRY);
        assertThat(out.retryAt()).isBetween(Instant.now().plusSeconds(50), Instant.now().plusSeconds(70));
        assertThat(transcripts.received).isNull();
        assertThat(outputs.started).isZero();
    }

    // ── still waiting ────────────────────────────────────────────────────────

    @Test @DisplayName("nothing yet: says what was checked and the most likely cause, and looks again in 5 minutes (15 after two hours)")
    void waiting() {
        ff.recent = List.of(summary("x", "https://meet.google.com/zzz-yyyy-xxx", false));
        JobOutcome out = handler.handle(job());
        assertThat(out.kind()).isEqualTo(JobOutcome.Kind.RETRY);
        assertThat(out.isError()).isFalse();                                       // still waiting is normal, not an error
        assertThat(out.retryAt()).isBetween(Instant.now().plus(Duration.ofSeconds(290)), Instant.now().plus(Duration.ofSeconds(310)));
        assertThat(store.checks).anyMatch(c -> c.startsWith("FIREFLIES_WAITING|") && c.contains("admitted to the meeting by the host") && c.contains("1 most recent Fireflies meeting"));
        minutesAgoSent(150);
        assertThat(handler.handle(job()).retryAt()).isBetween(Instant.now().plus(Duration.ofSeconds(890)), Instant.now().plus(Duration.ofSeconds(910)));
        assertThat(FirefliesTranscriptFetchHandler.nextCheck(Instant.now().minusSeconds(60), Instant.now())).isEqualTo(Duration.ofMinutes(5));
    }

    @Test @DisplayName("after six hours of nothing the meeting says so, and what to do instead")
    void givesUp() {
        minutesAgoSent(60 * 6 + 5);
        JobOutcome out = handler.handle(job());
        assertThat(out.kind()).isEqualTo(JobOutcome.Kind.FAIL);
        assertThat(out.code()).isEqualTo("NOTETAKER_NO_TRANSCRIPT");
        assertThat(out.message()).contains("may not have been admitted");
        assertThat(out.recovery()).contains("Import it from your recent Fireflies meetings").contains("upload a transcript");
    }

    @Test @DisplayName("a notetaker still in the meeting, or a transcript still being processed, is waited for — never imported half-finished")
    void liveAndProcessing() {
        ff.recent = List.of(summary("t1", LINK, true));
        JobOutcome live = handler.handle(job());
        assertThat(live.kind()).isEqualTo(JobOutcome.Kind.RETRY);
        assertThat(store.checks).anyMatch(c -> c.startsWith("FIREFLIES_LIVE|"));
        assertThat(ff.apiCalls).isEqualTo(1);                                      // one Fireflies request, no transcript download yet

        ff.recent = List.of(summary("t1", LINK, false));
        ff.transcript = Optional.empty();                                          // Fireflies: no transcript yet
        assertThat(handler.handle(job()).kind()).isEqualTo(JobOutcome.Kind.RETRY);
        ff.transcript = Optional.of(transcript(false));                            // present but no sentences yet
        assertThat(handler.handle(job()).kind()).isEqualTo(JobOutcome.Kind.RETRY);
        ff.transcript = Optional.of(transcript(true, new FirefliesMapper.Sentence("A", "partial", 1.0, 2.0)));   // still live captions
        assertThat(handler.handle(job()).kind()).isEqualTo(JobOutcome.Kind.RETRY);
        assertThat(store.checks.stream().filter(c -> c.startsWith("FIREFLIES_PROCESSING|")).count()).isEqualTo(3);
        assertThat(transcripts.received).isNull();
        assertThat(ff.claims).isEmpty();
    }

    // ── problems ─────────────────────────────────────────────────────────────

    @Test @DisplayName("a rate limit is NOT a failure: it waits exactly as long as Fireflies asked")
    void rateLimit() {
        Instant resume = Instant.now().plus(Duration.ofMinutes(40));
        ff.recentFails = new FirefliesException(FirefliesException.Kind.RATE_LIMITED, "limit", resume);
        JobOutcome out = handler.handle(job());
        assertThat(out.kind()).isEqualTo(JobOutcome.Kind.RETRY);
        assertThat(out.isError()).isFalse();                                       // waiting as asked must not count towards the "too many errors" limit
        assertThat(out.retryAt()).isEqualTo(resume);
        assertThat(store.checks).anyMatch(c -> c.startsWith("FIREFLIES_RATE_LIMITED|") && c.contains("try again automatically"));
        ff.recentFails = new FirefliesException(FirefliesException.Kind.RATE_LIMITED, "limit", null);
        assertThat(handler.handle(job()).retryAt()).isBetween(Instant.now().plus(Duration.ofSeconds(290)), Instant.now().plus(Duration.ofSeconds(310)));
    }

    @Test @DisplayName("a rejected key or an account problem fails clearly, with who needs to do what")
    void permanentProblems() {
        ff.recentFails = new FirefliesException(FirefliesException.Kind.AUTH, "no");
        JobOutcome auth = handler.handle(job());
        assertThat(auth.kind()).isEqualTo(JobOutcome.Kind.FAIL);
        assertThat(auth.code()).isEqualTo("FIREFLIES_KEY_REJECTED");
        assertThat(auth.recovery()).contains("admin needs to enter a new key");
        ff.recentFails = new FirefliesException(FirefliesException.Kind.PLAN, "Check the plan.");
        JobOutcome plan = handler.handle(job());
        assertThat(plan.code()).isEqualTo("FIREFLIES_PLAN");
        assertThat(store.checks).anyMatch(c -> c.startsWith("FIREFLIES_KEY_REJECTED|")).anyMatch(c -> c.startsWith("FIREFLIES_PLAN|"));
    }

    @Test @DisplayName("Fireflies being down means retrying shortly; a missing transcript just means looking again")
    void temporaryProblems() {
        ff.recentFails = new FirefliesException(FirefliesException.Kind.TRANSIENT, "down");
        JobOutcome t = handler.handle(job());
        assertThat(t.kind()).isEqualTo(JobOutcome.Kind.RETRY);
        assertThat(t.isError()).isTrue();
        assertThat(t.retryAt()).isBetween(Instant.now().plusSeconds(50), Instant.now().plusSeconds(70));
        ff.recentFails = new FirefliesException(FirefliesException.Kind.BAD_RESPONSE, "garbled");
        assertThat(handler.handle(job()).kind()).isEqualTo(JobOutcome.Kind.RETRY);
        ff.recentFails = new FirefliesException(FirefliesException.Kind.NOT_FOUND, "gone");
        assertThat(handler.handle(job()).kind()).isEqualTo(JobOutcome.Kind.RETRY);
    }

    @Test @DisplayName("if the integration has no usable key any more, it says so without contacting Fireflies")
    void notConfigured() {
        ff.notReady = "No Fireflies API key is saved yet.";
        JobOutcome out = handler.handle(job());
        assertThat(out.code()).isEqualTo("FIREFLIES_NOT_CONFIGURED");
        assertThat(out.recovery()).contains("press Retry");
        assertThat(ff.apiCalls).isZero();
    }

    @Test @DisplayName("does nothing if the transcript is already imported, the meeting moved on, or it no longer exists")
    void quietlyStops() {
        for (String state : new String[]{"IMPORTED", null}) {
            store.sessions.get(SID).setFirefliesState(state);
            assertThat(handler.handle(job()).kind()).as("state=" + state).isEqualTo(JobOutcome.Kind.DONE);
        }
        store.sessions.get(SID).setFirefliesState("SENT");
        for (String status : new String[]{"TRANSCRIPT_RECEIVED", "CANCELLED", "FAILED", "PROCESSING"}) {
            store.sessions.get(SID).setStatus(status);
            assertThat(handler.handle(job()).kind()).as("status=" + status).isEqualTo(JobOutcome.Kind.DONE);
        }
        store.sessions.remove(SID);
        assertThat(handler.handle(job()).kind()).isEqualTo(JobOutcome.Kind.DONE);
        assertThat(ff.apiCalls).isZero();
        assertThat(handler.type()).isEqualTo("FETCH_FIREFLIES");
    }
}

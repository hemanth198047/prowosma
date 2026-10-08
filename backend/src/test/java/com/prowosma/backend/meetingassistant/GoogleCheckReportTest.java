package com.prowosma.backend.meetingassistant;

import com.prowosma.backend.meetingassistant.ConferenceSelector.Conference;
import com.prowosma.backend.meetingassistant.ConferenceSelector.Diagnosis;
import com.prowosma.backend.meetingassistant.GoogleCheckReport.Report;
import com.prowosma.backend.meetingassistant.GoogleCheckReport.TranscriptFact;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

@DisplayName("What a waiting meeting says about Google's answer")
class GoogleCheckReportTest {

    private static final Instant NOW = Instant.parse("2026-10-08T12:00:00Z");
    private static Conference conf(String name, int startMinAgo, Integer endMinAgo) {
        return new Conference(name, NOW.minus(startMinAgo, ChronoUnit.MINUTES), endMinAgo == null ? null : NOW.minus(endMinAgo, ChronoUnit.MINUTES));
    }

    // ── which records were considered ────────────────────────────────────────

    @Test @DisplayName("diagnose counts what Google returned and what happened to each record")
    void diagnose() {
        Instant anchor = NOW.minus(10, ChronoUnit.MINUTES);
        List<Conference> records = List.of(conf("a", 30, 5), conf("b", 600, 590), conf("c", 20, 8));
        Diagnosis d = ConferenceSelector.diagnose(records, anchor, true, name -> name.equals("c"));
        assertThat(d.returned()).isEqualTo(3);
        assertThat(d.inWindow()).isEqualTo(2);
        assertThat(d.claimedByOtherMeetings()).isEqualTo(1);
        assertThat(d.outsideWindow()).isEqualTo(1);
        assertThat(d.latestOutsideWindow()).isEqualTo(NOW.minus(600, ChronoUnit.MINUTES));
        Diagnosis none = ConferenceSelector.diagnose(List.of(), anchor, true, n -> false);
        assertThat(none.returned()).isZero();
        assertThat(ConferenceSelector.diagnose(List.of(new Conference("x", null, null)), anchor, false, n -> false).outsideWindow()).isEqualTo(1);   // no start time at all
    }

    // ── no record at Google ──────────────────────────────────────────────────

    @Test @DisplayName("no record at all: says Google has none for the connected account and what to check")
    void noRecordsAtAll() {
        Report r = GoogleCheckReport.noConference(new Diagnosis(0, 0, 0, 0, null, null), "priya@corp.com", NOW);
        assertThat(r.code()).isEqualTo("NO_CONFERENCE_YET");
        assertThat(r.message()).contains("no record of this meeting").contains("priya@corp.com").contains("same Google account that organized").doesNotContain("personal Google account");
        assertThat(r.facts()).containsEntry("recordsReturned", 0).containsEntry("accountType", "WORKSPACE_OR_OTHER");
    }

    @Test @DisplayName("records exist but not from this meeting's time, or all taken by other meetings — each is explained")
    void recordsButNoMatch() {
        Report other = GoogleCheckReport.noConference(new Diagnosis(2, 0, 0, 2, NOW.minus(2000, ChronoUnit.MINUTES), NOW.minus(1500, ChronoUnit.MINUTES)), "a@corp.com", NOW);
        assertThat(other.message()).contains("returned 2 records").contains("none from the time of this meeting").contains("closest one started 25 hours ago");
        Report taken = GoogleCheckReport.noConference(new Diagnosis(1, 1, 1, 0, null, null), "a@corp.com", NOW);
        assertThat(taken.message()).contains("already imported for another meeting");
    }

    @Test @DisplayName("a personal Gmail account gets the plain explanation that Meet transcripts are a Workspace feature")
    void personalAccountHint() {
        for (String a : new String[]{"me@gmail.com", "ME@GMAIL.COM", "x@googlemail.com"}) assertThat(GoogleCheckReport.isPersonalAccount(a)).as(a).isTrue();
        for (String a : new String[]{"me@corp.com", null, "gmail.com.evil@corp.com"}) assertThat(GoogleCheckReport.isPersonalAccount(a)).as(String.valueOf(a)).isFalse();
        Report r = GoogleCheckReport.noConference(new Diagnosis(0, 0, 0, 0, null, null), "me@gmail.com", NOW);
        assertThat(r.message()).contains("personal Google account (me@gmail.com)").contains("Google Workspace feature");
        assertThat(r.facts()).containsEntry("accountType", "PERSONAL");
    }

    // ── still running / transcripts ──────────────────────────────────────────

    @Test @DisplayName("a meeting Google still shows as running: tells people to make sure everyone left")
    void stillRunning() {
        Report r = GoogleCheckReport.inProgress(conf("c", 25, null), "a@corp.com", NOW);
        assertThat(r.code()).isEqualTo("MEETING_IN_PROGRESS");
        assertThat(r.message()).contains("started 25 minutes ago").contains("everyone has left").contains("another tab or device");
    }

    @Test @DisplayName("ended with no transcript: names the real cause — captions and Gemini notes are not transcripts")
    void noTranscript() {
        Report r = GoogleCheckReport.noTranscript(conf("c", 40, 12), NOW, NOW.plus(18, ChronoUnit.MINUTES), "a@corp.com");
        assertThat(r.code()).isEqualTo("NO_TRANSCRIPT_YET");
        assertThat(r.message()).contains("ended 12 minutes ago").contains("Activities → Transcripts → Start transcription")
                .contains("captions does not save anything").contains("Gemini's meeting notes are a separate thing").contains("18 more minutes");
        Report late = GoogleCheckReport.noTranscript(conf("c", 90, 60), NOW, NOW.minus(1, ChronoUnit.MINUTES), "a@corp.com");
        assertThat(late.message()).doesNotContain("keep checking");
    }

    @Test @DisplayName("transcription still running vs file still being prepared")
    void notReady() {
        List<TranscriptFact> running = List.of(new TranscriptFact("STARTED", NOW.minus(30, ChronoUnit.MINUTES), null));
        assertThat(GoogleCheckReport.transcriptNotReady(conf("c", 40, 5), running, "a@corp.com", NOW).message()).contains("still running").contains("Stop transcription");
        List<TranscriptFact> preparing = List.of(new TranscriptFact("ENDED", NOW.minus(30, ChronoUnit.MINUTES), NOW.minus(6, ChronoUnit.MINUTES)));
        Report p = GoogleCheckReport.transcriptNotReady(conf("c", 40, 5), preparing, "a@corp.com", NOW);
        assertThat(p.message()).contains("still preparing the transcript file");
        assertThat(p.facts()).containsEntry("transcriptSessions", 1).containsEntry("transcriptsStillRunning", 0);
    }

    // ── problems and success ─────────────────────────────────────────────────

    @Test @DisplayName("Google problems are explained in words and never expose details")
    void googleProblems() {
        assertThat(GoogleCheckReport.googleProblem("UNAUTHORIZED", "a@corp.com").message()).contains("Reconnect your Google account");
        assertThat(GoogleCheckReport.googleProblem("FORBIDDEN", "a@corp.com").code()).isEqualTo("GOOGLE_ACCESS_DENIED");
        for (String k : new String[]{"RATE_LIMITED", "SERVER", "NETWORK"}) assertThat(GoogleCheckReport.googleProblem(k, null).code()).isEqualTo("GOOGLE_TEMPORARY");
        assertThat(GoogleCheckReport.googleProblem("???", null).code()).isEqualTo("GOOGLE_PROBLEM");
        assertThat(GoogleCheckReport.notConnected(null).message()).contains("isn't connected");
        assertThat(GoogleCheckReport.imported(42, "a@corp.com").message()).contains("42 lines");
    }

    @Test @DisplayName("reports carry only counts, states and times — never tokens or transcript text")
    void factsAreSafe() {
        Report r = GoogleCheckReport.noTranscript(conf("conferenceRecords/secret-name", 40, 12), NOW, NOW.plusSeconds(600), "a@corp.com");
        assertThat(r.facts().toString().toLowerCase()).doesNotContain("conferencerecords/secret-name").doesNotContain("token");
        assertThat(r.facts().keySet()).containsExactlyInAnyOrder("connectedAccount", "accountType", "meetingStarted", "meetingEnded", "transcriptSessions", "willKeepCheckingUntil");
    }
}

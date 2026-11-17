package com.prowosma.backend.uma;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.meetingassistant.NameMatcher;
import com.prowosma.backend.uma.ai.InsightValidator;
import com.prowosma.backend.uma.app.UmaExporter;
import com.prowosma.backend.uma.core.AudioSplitter;
import com.prowosma.backend.uma.core.UmaException;
import com.prowosma.backend.uma.model.*;
import com.prowosma.backend.uma.provider.ProviderRegistry;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.util.*;

import static org.assertj.core.api.Assertions.*;

/** Pure logic of the Universal Meeting Assistant: no database, no network. */
class UmaLogicTest {
    static final ObjectMapper OM = new ObjectMapper();

    // ── state machine ────────────────────────────────────────────────────
    @Test
    void stateMachine_allowsOnlyForwardOrRecoveryMoves() {
        assertThat(UmaStatus.CREATED.canMoveTo(UmaStatus.QUEUED)).isTrue();
        assertThat(UmaStatus.QUEUED.canMoveTo(UmaStatus.TRANSCRIBING)).isTrue();
        assertThat(UmaStatus.TRANSCRIBING.canMoveTo(UmaStatus.ANALYZING)).isTrue();
        assertThat(UmaStatus.ANALYZING.canMoveTo(UmaStatus.REVIEW_READY)).isTrue();
        assertThat(UmaStatus.FAILED.canMoveTo(UmaStatus.QUEUED)).isTrue();
        assertThat(UmaStatus.REVIEW_READY.canMoveTo(UmaStatus.TRANSCRIBING)).isFalse();
        assertThat(UmaStatus.CANCELLED.canMoveTo(UmaStatus.QUEUED)).isFalse();
        assertThat(UmaStatus.COMPLETED.canMoveTo(UmaStatus.CREATED)).isFalse();
        for (UmaStatus s : UmaStatus.values()) assertThat(s.label()).isNotBlank();
    }

    // ── evidence validation ──────────────────────────────────────────────
    static Map<Integer, InsightValidator.Line> lines(String... texts) {
        Map<Integer, InsightValidator.Line> m = new HashMap<>();
        for (int i = 0; i < texts.length; i++) m.put(i + 1, new InsightValidator.Line(i + 1, null, texts[i]));
        return m;
    }

    static final List<NameMatcher.Person> PEOPLE = List.of(
            new NameMatcher.Person("m1", "Ravi Kumar", "ravi@x.com", "MEMBER"),
            new NameMatcher.Person("m2", "Ravi Shah", "rs@x.com", "MEMBER"),
            new NameMatcher.Person("m3", "Jordan Lee", "jordan@x.com", "MEMBER"));

    UmaInsights run(String json, Map<Integer, InsightValidator.Line> l) throws Exception {
        return InsightValidator.validate(OM.readTree(json), l, LocalDate.of(2026, 11, 16), PEOPLE, null, null);
    }

    @Test
    void itemsWithoutRealEvidenceAreDropped() throws Exception {
        UmaInsights r = run("""
                {"summary":"s","decisions":[{"text":"ok","evidence":[1]},{"text":"made up","evidence":[]},{"text":"nowhere","evidence":[7]}],
                 "actions":[{"title":"t","evidence":["x"]}]}""", lines("We agreed to ship."));
        assertThat(r.getDecisions()).extracting(UmaInsights.Decision::getText).containsExactly("ok");
        assertThat(r.getActions()).isEmpty();
        assertThat(r.getDroppedForMissingEvidence()).isEqualTo(3);
    }

    @Test
    void ownersAndDeadlinesAreNeverInvented() throws Exception {
        UmaInsights r = run("""
                {"actions":[
                  {"title":"A","owner":"Jordan Lee","due":"by Wednesday","evidence":[1]},
                  {"title":"B","owner":"Priya","due":"tomorrow","evidence":[2]},
                  {"title":"C","owner":"Ravi","due":null,"evidence":[3]}]}""",
                lines("Jordan Lee will draft the redirect plan by Wednesday.", "Someone should check procurement.", "Ravi can take it."));
        UmaInsights.ActionItem a = r.getActions().get(0), b = r.getActions().get(1), c = r.getActions().get(2);
        assertThat(a.getOwnerState()).isEqualTo("MATCHED");
        assertThat(a.getOwnerMemberId()).isEqualTo("m3");
        assertThat(a.getDueDate()).isEqualTo(LocalDate.of(2026, 11, 18));
        assertThat(b.getOwnerSpoken()).isNull();
        assertThat(b.getOwnerState()).isEqualTo("UNASSIGNED");
        assertThat(b.getDueDate()).isNull();
        assertThat(c.getOwnerState()).as("two Ravis: ambiguous, a person chooses").isIn("AMBIGUOUS", "SUGGESTED");
        assertThat(c.getOwnerMemberId()).isNull();
        assertThat(c.getOwnerCandidates()).hasSizeGreaterThanOrEqualTo(2);
    }

    @Test
    void ownerNamedInTheNextLineIsOnlyASuggestion_andDeadlineInTheDescriptionIsUsedOnlyIfSaid() throws Exception {
        Map<Integer, InsightValidator.Line> l = lines(
                "I can draft the redirect plan for the old blog posts. I will share it by Wednesday.",
                "Perfect. Thank you Jordan.",
                "Next item.",
                "Someone needs to follow up with procurement.",
                "Thanks Ravi.");
        UmaInsights r = run("""
                {"actions":[
                  {"title":"Draft redirect plan","description":"Draft and share it by Wednesday","owner":"Jordan","due":null,"evidence":[1]},
                  {"title":"Follow up with procurement","description":"Follow up by Friday","owner":"Jordan","due":null,"evidence":[4]}]}""", l);
        UmaInsights.ActionItem a = r.getActions().get(0), b = r.getActions().get(1);
        assertThat(a.getOwnerSpoken()).isEqualTo("Jordan");
        assertThat(a.getOwnerState()).as("never auto-assigned from a nearby line").isEqualTo("SUGGESTED");
        assertThat(a.getOwnerMemberId()).isNull();
        assertThat(a.getOwnerCandidates()).extracting(UmaInsights.Candidate::getMemberId).containsExactly("m3");
        assertThat(a.getEvidence()).containsExactly(1, 2);
        assertThat(a.getOwnerNote()).contains("line 2");
        assertThat(a.getDueSpoken()).isEqualTo("by Wednesday");
        assertThat(a.getDueDate()).isEqualTo(LocalDate.of(2026, 11, 18));
        assertThat(b.getOwnerSpoken()).as("'Jordan' is not in or next to line 4").isNull();
        assertThat(b.getDueDate()).as("'by Friday' is not in the cited line").isNull();
    }

    @Test
    void citedLinesMustActuallySupportTheClaim() throws Exception {
        Map<Integer, InsightValidator.Line> l = lines(
                "Morning all.",
                "One blocker: the app store screenshots aren't ready. Design hasn't sent them.",
                "We agreed to ship version 2.4 on the 25th of November.",
                "Let's find out. Thanks everyone.");
        UmaInsights r = run("""
                {"risks":[{"text":"App store screenshots not ready","evidence":[4]}],
                 "decisions":[{"text":"Ship version 2.4 on 25 November","evidence":[3]},
                              {"text":"Budget approved for the new office","evidence":[4]}]}""", l);
        assertThat(r.getRisks().get(0).getEvidence()).as("wrong line replaced by the one that says it").containsExactly(2);
        assertThat(r.getDecisions()).extracting(UmaInsights.Decision::getText).containsExactly("Ship version 2.4 on 25 November");
        assertThat(r.getDroppedForMissingEvidence()).as("the budget claim has no support anywhere").isEqualTo(1);
    }

    @Test
    void idsAreStableAcrossRegeneration_andDecisionsAreKept() throws Exception {
        String json = "{\"actions\":[{\"title\":\"Ship the API\",\"evidence\":[1]}]}";
        Map<Integer, InsightValidator.Line> l = lines("Ship the API this week.");
        UmaInsights first = run(json, l);
        first.getActions().get(0).setStatus("CREATED");
        first.getActions().get(0).setCreatedTaskId("t1");
        UmaInsights second = InsightValidator.validate(OM.readTree(json), l, LocalDate.of(2026, 11, 16), PEOPLE, first, null);
        assertThat(second.getActions().get(0).getId()).isEqualTo(first.getActions().get(0).getId());
        assertThat(second.getActions().get(0).getStatus()).isEqualTo("CREATED");
        assertThat(second.getActions().get(0).getCreatedTaskId()).isEqualTo("t1");
    }

    // ── providers ────────────────────────────────────────────────────────
    @Test
    void providerDetection() {
        ProviderRegistry reg = new ProviderRegistry();
        assertThat(reg.detect("https://meet.google.com/abc-defg-hij").provider().id()).isEqualTo("GOOGLE_MEET");
        assertThat(reg.detect("https://teams.microsoft.com/l/meetup-join/19%3a").provider().id()).isEqualTo("MS_TEAMS");
        assertThat(reg.detect("https://acme.zoom.us/j/123").provider().id()).isEqualTo("ZOOM");
        assertThat(reg.detect("https://acme.webex.com/meet/x").provider().id()).isEqualTo("WEBEX");
        assertThat(reg.detect("https://evilzoom.us.attacker.com/j/1").provider().id()).isEqualTo("OTHER");
        assertThatThrownBy(() -> reg.detect("http://meet.google.com/abc")).isInstanceOf(UmaException.class);
        assertThatThrownBy(() -> reg.detect("javascript:alert(1)")).isInstanceOf(UmaException.class);
        // nothing claims live joining works
        reg.all().forEach(p -> p.capabilities().forEach(c -> {
            if (c.toString().toLowerCase(Locale.ROOT).contains("livejoin")) assertThat(c.toString()).doesNotContain("VERIFIED");
        }));
    }

    // ── operator-only transport ─────────────────────────────────────────
    @Test
    void operatorAddressesAllowHttpButNothingOdd() throws Exception {
        java.lang.reflect.Method check = com.prowosma.backend.uma.core.OperatorHttp.class.getDeclaredMethod("check", String.class);
        check.setAccessible(true);
        assertThat(check.invoke(null, "http://stt:8000/v1/audio/transcriptions").toString()).startsWith("http://stt:8000");
        assertThat(check.invoke(null, "https://models.internal/v1").toString()).startsWith("https://");
        for (String bad : List.of("file:///etc/passwd", "ftp://x/y", "http://user:pw@stt:8000/", "gopher://x", "")) {
            assertThatThrownBy(() -> check.invoke(null, bad)).hasCauseInstanceOf(IllegalArgumentException.class);
        }
    }

    // ── audio splitting ──────────────────────────────────────────────────
    @Test
    void splitterPlan() {
        assertThat(AudioSplitter.plan(0, 600)).containsExactly(0L);
        assertThat(AudioSplitter.plan(83_000, 600)).containsExactly(0L);
        assertThat(AudioSplitter.plan(1_500_000, 600)).containsExactly(0L, 600_000L, 1_200_000L);
    }

    // ── export ───────────────────────────────────────────────────────────
    @Test
    void exportsCarryLineReferences() throws Exception {
        UmaMeeting m = new UmaMeeting();
        m.setId("m1"); m.setTitle("Weekly Sync / Q4!"); m.setMeetingAt(Instant.parse("2026-11-16T09:00:00Z")); m.setTimezone("Asia/Kolkata");
        UmaInsights ins = new UmaInsights();
        ins.setSummary("Launch agreed.");
        UmaInsights.ActionItem a = new UmaInsights.ActionItem();
        a.setId("a1"); a.setTitle("Finish API"); a.setOwnerSpoken("Ravi"); a.setDueDate(LocalDate.of(2026, 11, 20)); a.setEvidence(List.of(2)); a.setStatus("PENDING");
        UmaInsights.ActionItem rej = new UmaInsights.ActionItem();
        rej.setId("a2"); rej.setTitle("Rejected thing"); rej.setStatus("REJECTED");
        ins.setActions(List.of(a, rej));
        UmaSegment s = new UmaSegment(); s.setSeq(2); s.setStartMs(65_000L); s.setText("Ravi will finish the API by Friday.");

        UmaExporter.Export md = UmaExporter.export(m, ins, List.of(s), "md");
        String text = new String(md.bytes(), StandardCharsets.UTF_8);
        assertThat(md.fileName()).isEqualTo("weekly-sync-q4.md");
        assertThat(text).contains("# Weekly Sync / Q4!", "Finish API — owner: Ravi, due: 2026-11-20 [#2]", "#2 1:05 Ravi will finish", "(Asia/Kolkata)");
        assertThat(text).doesNotContain("Rejected thing");

        JsonNode j = OM.readTree(UmaExporter.export(m, ins, List.of(s), "json").bytes());
        assertThat(j.at("/transcript/0/line").asInt()).isEqualTo(2);
        assertThat(UmaExporter.export(m, ins, List.of(s), "docx").bytes()[0]).isEqualTo((byte) 'P');
        assertThatThrownBy(() -> UmaExporter.export(m, ins, List.of(), "exe")).isInstanceOf(UmaException.class);
    }
}

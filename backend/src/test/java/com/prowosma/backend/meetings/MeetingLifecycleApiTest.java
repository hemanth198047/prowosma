package com.prowosma.backend.meetings;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.model.Meeting;
import com.prowosma.backend.repository.MeetingRepository;
import com.prowosma.backend.service.EmailService;
import com.prowosma.backend.tenant.TwoWorkspaceTestBase;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

/**
 * The notes-model meeting feature (/api/meetings), end to end: real HTTP stack, real filters, a real database.
 * Only the outgoing mail server is replaced, so every invitation that would leave the building can be counted.
 */
class MeetingLifecycleApiTest extends TwoWorkspaceTestBase {

    static final String BASE = "/api/meetings";

    @Autowired ObjectMapper om;
    @Autowired MeetingRepository meetings;
    @MockitoBean EmailService email;

    @BeforeEach
    void clean() {
        meetings.deleteAll();
        when(email.sendHtmlEmail(anyString(), any(), anyString(), anyString())).thenReturn(true);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    MvcResult call(MockHttpServletRequestBuilder b, String token, String ws, String json, int expected) throws Exception {
        b.header("Authorization", authHeader(token));
        if (ws != null) b.header("X-Workspace-Id", ws);
        if (json != null) b.contentType(MediaType.APPLICATION_JSON).content(json);
        MvcResult r = mvc.perform(b).andReturn();
        assertThat(r.getResponse().getStatus()).as("%s %s -> %s", b.buildRequest(new org.springframework.mock.web.MockServletContext()).getMethod(),
                b.buildRequest(new org.springframework.mock.web.MockServletContext()).getRequestURI(), r.getResponse().getContentAsString()).isEqualTo(expected);
        return r;
    }

    JsonNode json(MvcResult r) throws Exception { return om.readTree(r.getResponse().getContentAsString()); }

    /** A meeting body whose start is {@code hoursFromNow} away, as the browser sends it (UTC, no offset). */
    String body(String title, int hoursFromNow, String... attendees) throws Exception {
        var m = om.createObjectNode();
        m.put("title", title);
        m.put("meetingDate", LocalDateTime.now().plusHours(hoursFromNow).withNano(0).toString());
        m.put("durationMins", 45);
        m.put("location", "https://meet.example.com/abc");
        var a = m.putArray("attendees");
        for (String x : attendees) a.add(x);
        return om.writeValueAsString(m);
    }

    JsonNode create(String token, String ws, String body) throws Exception { return json(call(post(BASE), token, ws, body, 200)); }

    Set<String> invitedAddresses(int expectedCalls) {
        ArgumentCaptor<String> to = ArgumentCaptor.forClass(String.class);
        verify(email, timeout(5000).times(expectedCalls)).sendHtmlEmail(to.capture(), any(), anyString(), anyString());
        return to.getAllValues().stream().map(String::toLowerCase).collect(Collectors.toSet());
    }

    // ── create ───────────────────────────────────────────────────────────────

    @Test
    void create_setsWorkspaceStatusAndCreatorFromTheServer_notFromWhatTheBrowserSent() throws Exception {
        String evil = "{\"title\":\"Sneaky\",\"workspaceId\":\"" + otherWorkspaceId + "\",\"status\":\"COMPLETED\",\"createdBy\":\"someone@else.com\","
                + "\"meetingDate\":\"" + LocalDateTime.now().plusDays(1).withNano(0) + "\"}";
        JsonNode m = create(memberToken(), workspaceId, evil);
        assertThat(m.get("workspaceId").asText()).isEqualTo(workspaceId);
        assertThat(m.get("status").asText()).isEqualTo("SCHEDULED");
        assertThat(m.get("createdBy").asText()).isEqualTo(memberEmail);
        assertThat(m.get("attendees").isArray()).isTrue();
        assertThat(m.get("actionItems").isArray()).isTrue();
        assertThat(meetings.findById(m.get("id").asText())).get().extracting(Meeting::getWorkspaceId).isEqualTo(workspaceId);
        assertThat(meetings.findByWorkspaceId(otherWorkspaceId, org.springframework.data.domain.Pageable.unpaged()).getContent()).isEmpty();
    }

    @Test
    void create_withNoTitle_orNoDate_isHandledWithoutAServerError() throws Exception {
        MvcResult r = mvc.perform(post(BASE).header("Authorization", authHeader(ownerToken())).header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON).content("{}")).andReturn();
        assertThat(r.getResponse().getStatus()).isLessThan(500);
        r = mvc.perform(post(BASE).header("Authorization", authHeader(ownerToken())).header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"x\",\"meetingDate\":\"not-a-date\"}")).andReturn();
        assertThat(r.getResponse().getStatus()).isBetween(400, 499);
        r = mvc.perform(post(BASE).header("Authorization", authHeader(ownerToken())).header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON).content("not json")).andReturn();
        assertThat(r.getResponse().getStatus()).isBetween(400, 499);
    }

    @Test
    void create_invitesEveryAttendeeExceptTheOrganizer_eachExactlyOnce_caseInsensitive() throws Exception {
        create(ownerToken(), workspaceId, body("Kickoff", 24, "Ann@Company.com", "ann@company.com", " bob@company.com ", ownerEmail, "not-an-email", ""));
        assertThat(invitedAddresses(2)).containsExactlyInAnyOrder("ann@company.com", "bob@company.com");
    }

    @Test
    void create_withCompanyAddressesOnAnyDomain_eachRecipientGetsTheirOwnMessage() throws Exception {
        // the Titan / GoDaddy case: several people on the company's own domain, plus others elsewhere
        create(ownerToken(), workspaceId, body("Review", 5, "a@wilmarcs.services", "b@wilmarcs.services", "c@wilmarcs.services", "d@gmail.com", "e@outlook.com"));
        assertThat(invitedAddresses(5)).containsExactlyInAnyOrder("a@wilmarcs.services", "b@wilmarcs.services", "c@wilmarcs.services", "d@gmail.com", "e@outlook.com");
    }

    @Test
    void create_whenTheMailServerRefusesOne_theMeetingIsStillSaved_andTheOtherInvitesGoOut() throws Exception {
        when(email.sendHtmlEmail(eq("bad@x.com"), any(), anyString(), anyString())).thenReturn(false);
        JsonNode m = create(ownerToken(), workspaceId, body("Resilient", 3, "bad@x.com", "good@x.com"));
        assertThat(meetings.findById(m.get("id").asText())).isPresent();
        assertThat(invitedAddresses(2)).contains("good@x.com");
    }

    @Test
    void create_whenTheMailServerThrows_theMeetingIsStillSaved() throws Exception {
        when(email.sendHtmlEmail(anyString(), any(), anyString(), anyString())).thenThrow(new RuntimeException("smtp down"));
        JsonNode m = create(ownerToken(), workspaceId, body("Smtp down", 3, "a@x.com"));
        assertThat(meetings.findById(m.get("id").asText())).isPresent();
    }

    @Test
    void create_chainsToThePreviousMeetingOfTheWorkspace_neverAnotherWorkspaces() throws Exception {
        JsonNode other = create(otherOwnerToken(), otherWorkspaceId, body("Theirs", -50));
        JsonNode first = create(ownerToken(), workspaceId, body("First", -48));
        JsonNode second = create(ownerToken(), workspaceId, body("Second", -24));
        assertThat(second.path("previousMeetingId").asText()).isEqualTo(first.get("id").asText());
        assertThat(first.path("previousMeetingId").asText("")).isNotEqualTo(other.get("id").asText());
    }

    @Test
    void timezone_isKeptWhenValid_ignoredWhenNot_andPutIntoTheInvitationEmail() throws Exception {
        var ok = om.createObjectNode().put("title", "Zoned").put("meetingDate", "2030-11-30T09:30:00Z").put("timezone", "Asia/Kolkata");
        ok.putArray("attendees").add("a@x.com");
        JsonNode m = create(ownerToken(), workspaceId, om.writeValueAsString(ok));
        assertThat(m.get("timezone").asText()).isEqualTo("Asia/Kolkata");
        ArgumentCaptor<String> html = ArgumentCaptor.forClass(String.class);
        verify(email, timeout(5000)).sendHtmlEmail(eq("a@x.com"), any(), anyString(), html.capture());
        assertThat(html.getValue()).contains("Sat 30 Nov 2030, 15:00 IST (09:30 UTC)".replace("Sat", java.time.LocalDate.of(2030, 11, 30).getDayOfWeek().getDisplayName(java.time.format.TextStyle.SHORT, java.util.Locale.ENGLISH)));
        JsonNode bad = create(ownerToken(), workspaceId, om.writeValueAsString(om.createObjectNode().put("title", "Bad zone").put("meetingDate", "2030-11-30T09:30:00Z").put("timezone", "Mars/Olympus")));
        assertThat(bad.path("timezone").isNull() || bad.path("timezone").isMissingNode()).isTrue();
        String id = m.get("id").asText();
        call(put(BASE + "/" + id), ownerToken(), workspaceId, "{\"timezone\":\"America/New_York\"}", 200);
        assertThat(meetings.findById(id).orElseThrow().getTimezone()).isEqualTo("America/New_York");
        call(put(BASE + "/" + id), ownerToken(), workspaceId, "{\"timezone\":\"nonsense\"}", 200);
        assertThat(meetings.findById(id).orElseThrow().getTimezone()).as("a bad zone never overwrites a good one").isEqualTo("America/New_York");
    }

    // ── read / list / filter ─────────────────────────────────────────────────

    @Test
    void getById_returnsTheMeeting_404ForAnUnknownId() throws Exception {
        JsonNode m = create(ownerToken(), workspaceId, body("Find me", 2));
        assertThat(json(call(get(BASE + "/" + m.get("id").asText()), memberToken(), workspaceId, null, 200)).get("title").asText()).isEqualTo("Find me");
        call(get(BASE + "/does-not-exist"), ownerToken(), workspaceId, null, 404);
    }

    @Test
    void list_isPaged_newestFirst_andOnlyOurWorkspace() throws Exception {
        for (int i = 0; i < 7; i++) create(ownerToken(), workspaceId, body("M" + i, i));
        create(otherOwnerToken(), otherWorkspaceId, body("Theirs", 1));
        JsonNode p0 = json(call(get(BASE + "?page=0&size=5"), ownerToken(), workspaceId, null, 200));
        assertThat(p0.get("data").size()).isEqualTo(5);
        assertThat(p0.get("totalElements").asInt()).isEqualTo(7);
        assertThat(p0.get("data").get(0).get("title").asText()).isEqualTo("M6");
        JsonNode p1 = json(call(get(BASE + "?page=1&size=5"), ownerToken(), workspaceId, null, 200));
        assertThat(p1.get("data").size()).isEqualTo(2);
        List<String> titles = new ArrayList<>();
        p0.get("data").forEach(n -> titles.add(n.get("title").asText()));
        p1.get("data").forEach(n -> titles.add(n.get("title").asText()));
        assertThat(titles).doesNotContain("Theirs").doesNotHaveDuplicates();
    }

    @Test
    void list_searchByTitle_andByStatus() throws Exception {
        create(ownerToken(), workspaceId, body("Quarterly Planning", 1));
        JsonNode done = create(ownerToken(), workspaceId, body("Standup", 2));
        call(post(BASE + "/" + done.get("id").asText() + "/complete"), ownerToken(), workspaceId, null, 200);
        assertThat(json(call(get(BASE + "?q=planning"), ownerToken(), workspaceId, null, 200)).get("data").size()).isEqualTo(1);
        assertThat(json(call(get(BASE + "?q=zzz"), ownerToken(), workspaceId, null, 200)).get("data").size()).isZero();
        assertThat(json(call(get(BASE + "?status=COMPLETED"), ownerToken(), workspaceId, null, 200)).get("data").size()).isEqualTo(1);
        assertThat(json(call(get(BASE + "?status=SCHEDULED"), ownerToken(), workspaceId, null, 200)).get("data").size()).isEqualTo(1);
    }

    @Test
    void list_searchWithRegexCharacters_isTreatedAsPlainText_notAnError() throws Exception {
        create(ownerToken(), workspaceId, body("Budget (Q1) review [draft]", 1));
        for (String q : new String[]{"(", "[draft]", ".*", "Q1)", "\\"}) {
            MvcResult r = mvc.perform(get(BASE).param("q", q).header("Authorization", authHeader(ownerToken())).header("X-Workspace-Id", workspaceId)).andReturn();
            assertThat(r.getResponse().getStatus()).as("q=%s", q).isLessThan(500);
        }
        assertThat(json(call(get(BASE).param("q", "[draft]"), ownerToken(), workspaceId, null, 200)).get("data").size()).isEqualTo(1);
    }

    @Test
    void calendarRange_returnsMeetingsStartingInsideIt_oldestFirst_inUtc() throws Exception {
        LocalDateTime base = LocalDateTime.now().withNano(0).plusDays(3);
        for (int h : new int[]{30, 2, 10}) {
            var n = om.createObjectNode().put("title", "at+" + h).put("meetingDate", base.plusHours(h).toString());
            create(ownerToken(), workspaceId, om.writeValueAsString(n));
        }
        create(ownerToken(), workspaceId, body("outside", 24 * 20));
        String from = base.toString() + "Z", to = base.plusHours(40).toString() + "Z";
        JsonNode r = json(call(get(BASE).param("from", from).param("to", to), memberToken(), workspaceId, null, 200));
        List<String> titles = new ArrayList<>();
        r.get("data").forEach(n -> titles.add(n.get("title").asText()));
        assertThat(titles).containsExactly("at+2", "at+10", "at+30");
        // an offset is honoured: the same instant written in IST finds the same meetings
        String fromIst = base.plusHours(5).plusMinutes(30).toString() + "+05:30", toIst = base.plusHours(45).plusMinutes(30).toString() + "+05:30";
        assertThat(json(call(get(BASE).param("from", fromIst).param("to", toIst), memberToken(), workspaceId, null, 200)).get("data").size()).isEqualTo(3);
    }

    @Test
    void calendarRange_rejectsBadInput_withA400_notA500() throws Exception {
        call(get(BASE).param("from", "garbage").param("to", "2026-01-02T00:00:00Z"), ownerToken(), workspaceId, null, 400);
        call(get(BASE).param("from", "2026-02-01T00:00:00Z").param("to", "2026-01-01T00:00:00Z"), ownerToken(), workspaceId, null, 400);
        call(get(BASE).param("from", "2026-01-01T00:00:00Z").param("to", "2026-06-01T00:00:00Z"), ownerToken(), workspaceId, null, 400);
    }

    @Test
    void calendarRange_neverShowsAnotherWorkspacesMeetings() throws Exception {
        LocalDateTime t = LocalDateTime.now().withNano(0).plusDays(1);
        create(otherOwnerToken(), otherWorkspaceId, om.writeValueAsString(om.createObjectNode().put("title", "Theirs").put("meetingDate", t.toString())));
        JsonNode r = json(call(get(BASE).param("from", t.minusHours(1) + "Z").param("to", t.plusHours(1) + "Z"), ownerToken(), workspaceId, null, 200));
        assertThat(r.get("data").size()).isZero();
    }

    // ── update ───────────────────────────────────────────────────────────────

    @Test
    void update_changesOnlyWhatWasSent_andKeepsTheRest() throws Exception {
        JsonNode m = create(ownerToken(), workspaceId, body("Original", 6, "a@x.com"));
        String id = m.get("id").asText();
        JsonNode u = json(call(put(BASE + "/" + id), ownerToken(), workspaceId, "{\"title\":\"Renamed\",\"agenda\":\"1. Intro\"}", 200));
        assertThat(u.get("title").asText()).isEqualTo("Renamed");
        assertThat(u.get("agenda").asText()).isEqualTo("1. Intro");
        assertThat(u.get("location").asText()).isEqualTo("https://meet.example.com/abc");
        assertThat(u.get("durationMins").asInt()).isEqualTo(45);
        assertThat(u.get("attendees").get(0).asText()).isEqualTo("a@x.com");
        assertThat(u.get("meetingDate").asText()).isEqualTo(m.get("meetingDate").asText());
    }

    @Test
    void update_movesTheMeeting_andRejectsAnUnreadableDate() throws Exception {
        String id = create(ownerToken(), workspaceId, body("Move", 6)).get("id").asText();
        call(put(BASE + "/" + id), ownerToken(), workspaceId, "{\"meetingDate\":\"2030-05-06T07:08:00Z\"}", 200);
        assertThat(meetings.findById(id).orElseThrow().getMeetingDate()).isEqualTo(LocalDateTime.of(2030, 5, 6, 7, 8));
        call(put(BASE + "/" + id), ownerToken(), workspaceId, "{\"meetingDate\":\"2030-05-06T12:38:00+05:30\"}", 200);
        assertThat(meetings.findById(id).orElseThrow().getMeetingDate()).isEqualTo(LocalDateTime.of(2030, 5, 6, 7, 8));
        call(put(BASE + "/" + id), ownerToken(), workspaceId, "{\"meetingDate\":\"tomorrow-ish\"}", 400);
        assertThat(meetings.findById(id).orElseThrow().getMeetingDate()).isEqualTo(LocalDateTime.of(2030, 5, 6, 7, 8));
    }

    @Test
    void update_invitesOnlyThePeopleJustAdded_notEveryoneAgain() throws Exception {
        String id = create(ownerToken(), workspaceId, body("Growing", 6, "a@x.com", "b@x.com")).get("id").asText();
        invitedAddresses(2);
        org.mockito.Mockito.clearInvocations(email);
        call(put(BASE + "/" + id), ownerToken(), workspaceId, "{\"title\":\"Growing\",\"attendees\":[\"a@x.com\",\"b@x.com\",\"C@X.com\"]}", 200);
        assertThat(invitedAddresses(1)).containsExactly("c@x.com");
        org.mockito.Mockito.clearInvocations(email);
        call(put(BASE + "/" + id), ownerToken(), workspaceId, "{\"title\":\"Just a title change\"}", 200);
        Thread.sleep(400);
        verify(email, never()).sendHtmlEmail(anyString(), any(), anyString(), anyString());
    }

    @Test
    void update_unknownMeeting_is404() throws Exception {
        call(put(BASE + "/nope"), ownerToken(), workspaceId, "{\"title\":\"x\"}", 404);
    }

    @Test
    void update_discussionsMerge_andNeverWipeWhatWasAlreadyAttached() throws Exception {
        String id = create(ownerToken(), workspaceId, body("Multi", 6)).get("id").asText();
        call(post(BASE + "/" + id + "/projects"), ownerToken(), workspaceId, "{\"projectId\":\"p1\",\"statusSnapshot\":\"ON_TRACK\"}", 200);
        call(put(BASE + "/" + id), ownerToken(), workspaceId, "{\"projectDiscussions\":[{\"projectId\":\"p1\",\"discussionNotes\":\"went well\"},{\"projectId\":\"p2\",\"quickUpdate\":\"PROGRESS\"},{\"projectId\":\"\"}]}", 200);
        Meeting m = meetings.findById(id).orElseThrow();
        assertThat(m.getProjectDiscussions()).hasSize(2);
        var p1 = m.getProjectDiscussions().stream().filter(d -> "p1".equals(d.getProjectId())).findFirst().orElseThrow();
        assertThat(p1.getStatusSnapshot()).isEqualTo("ON_TRACK");
        assertThat(p1.getDiscussionNotes()).isEqualTo("went well");
    }

    @Test
    void projects_requireAProjectId() throws Exception {
        String id = create(ownerToken(), workspaceId, body("P", 6)).get("id").asText();
        call(post(BASE + "/" + id + "/projects"), ownerToken(), workspaceId, "{}", 400);
        call(post(BASE + "/" + id + "/projects"), ownerToken(), workspaceId, "{\"projectId\":\" \"}", 400);
    }

    // ── action items ─────────────────────────────────────────────────────────

    @Test
    void actionItems_addToggleAndToggleBack() throws Exception {
        String id = create(ownerToken(), workspaceId, body("Actions", 6)).get("id").asText();
        JsonNode m = json(call(post(BASE + "/" + id + "/action-items"), memberToken(), workspaceId, "{\"title\":\"Send deck\",\"dueDate\":\"2030-01-02\"}", 200));
        assertThat(m.get("actionItems").size()).isEqualTo(1);
        JsonNode item = m.get("actionItems").get(0);
        assertThat(item.get("assignee").asText()).isEqualTo(memberEmail);   // defaults to the person adding it
        assertThat(item.get("done").asBoolean()).isFalse();
        String itemId = item.get("id").asText();
        assertThat(json(call(patch(BASE + "/" + id + "/action-items/" + itemId + "/toggle"), ownerToken(), workspaceId, null, 200)).get("actionItems").get(0).get("done").asBoolean()).isTrue();
        assertThat(json(call(patch(BASE + "/" + id + "/action-items/" + itemId + "/toggle"), ownerToken(), workspaceId, null, 200)).get("actionItems").get(0).get("done").asBoolean()).isFalse();
        call(post(BASE + "/nope/action-items"), ownerToken(), workspaceId, "{\"title\":\"x\"}", 404);
    }

    // ── complete / delete ────────────────────────────────────────────────────

    @Test
    void complete_marksTheMeetingDone_andItStaysDone() throws Exception {
        String id = create(ownerToken(), workspaceId, body("Finish", -1)).get("id").asText();
        assertThat(json(call(post(BASE + "/" + id + "/complete"), ownerToken(), workspaceId, null, 200)).get("status").asText()).isEqualTo("COMPLETED");
        assertThat(meetings.findById(id).orElseThrow().getStatus()).isEqualTo("COMPLETED");
        call(post(BASE + "/nope/complete"), ownerToken(), workspaceId, null, 404);
    }

    @Test
    void delete_removesTheMeeting_andItNoLongerAppearsAnywhere() throws Exception {
        String id = create(ownerToken(), workspaceId, body("Bye", 6)).get("id").asText();
        call(delete(BASE + "/" + id), ownerToken(), workspaceId, null, 200);
        call(get(BASE + "/" + id), ownerToken(), workspaceId, null, 404);
        assertThat(json(call(get(BASE), ownerToken(), workspaceId, null, 200)).get("data").size()).isZero();
    }

    // ── isolation between workspaces ─────────────────────────────────────────

    @Test
    void anotherWorkspace_cannotReadChangeCompleteOrDeleteOurMeeting() throws Exception {
        String id = create(ownerToken(), workspaceId, body("Private", 6, "a@x.com")).get("id").asText();
        String t = otherOwnerToken();
        int[] bad = {403, 404};
        for (MockHttpServletRequestBuilder b : List.of(get(BASE + "/" + id), get(BASE + "/" + id + "/summary"), get(BASE + "/" + id + "/continuity"),
                get(BASE + "/" + id + "/whats-changed"))) {
            MvcResult r = mvc.perform(b.header("Authorization", authHeader(t)).header("X-Workspace-Id", otherWorkspaceId)).andReturn();
            assertThat(r.getResponse().getStatus()).as(r.getRequest().getRequestURI()).isIn(403, 404);
            assertThat(r.getResponse().getContentAsString()).doesNotContain("Private");
        }
        for (MockHttpServletRequestBuilder b : List.of(put(BASE + "/" + id).contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"Hacked\"}"),
                post(BASE + "/" + id + "/complete"), post(BASE + "/" + id + "/action-items").contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"x\"}"),
                post(BASE + "/" + id + "/projects").contentType(MediaType.APPLICATION_JSON).content("{\"projectId\":\"p\"}"),
                post(BASE + "/" + id + "/resend-invites"), delete(BASE + "/" + id))) {
            MvcResult r = mvc.perform(b.header("Authorization", authHeader(t)).header("X-Workspace-Id", otherWorkspaceId)).andReturn();
            assertThat(r.getResponse().getStatus()).as(r.getRequest().getMethod() + " " + r.getRequest().getRequestURI()).isIn(403, 404);
        }
        Meeting after = meetings.findById(id).orElseThrow();
        assertThat(after.getTitle()).isEqualTo("Private");
        assertThat(after.getStatus()).isEqualTo("SCHEDULED");
        assertThat(after.getActionItems()).isEmpty();
    }

    @Test
    void aPersonCannotAimAtOurWorkspaceByLyingInTheHeader() throws Exception {
        create(ownerToken(), workspaceId, body("Ours", 6));
        MvcResult r = mvc.perform(get(BASE).header("Authorization", authHeader(otherOwnerToken())).header("X-Workspace-Id", workspaceId)).andReturn();
        assertThat(r.getResponse().getStatus()).isIn(401, 403);
        assertThat(r.getResponse().getContentAsString()).doesNotContain("Ours");
    }

    @Test
    void withoutALogin_nothingIsAvailable() throws Exception {
        int s = mvc.perform(get(BASE).header("X-Workspace-Id", workspaceId)).andReturn().getResponse().getStatus();
        assertThat(s).isIn(401, 403);
        s = mvc.perform(post(BASE).header("X-Workspace-Id", workspaceId).contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"x\"}")).andReturn().getResponse().getStatus();
        assertThat(s).isIn(401, 403);
    }

    // ── resend ───────────────────────────────────────────────────────────────

    @Test
    void resend_theOrganizerAndAdminsMay_otherMembersMayNot_andItIsRateLimited() throws Exception {
        String id = create(memberToken(), workspaceId, body("Resend", 6, "a@x.com", "b@x.com")).get("id").asText();
        invitedAddresses(2);
        org.mockito.Mockito.clearInvocations(email);

        // a different plain member: refused
        com.prowosma.backend.model.User other = new com.prowosma.backend.model.User();
        other.setEmail("colleague@test.com"); other.setName("Colleague"); other.setPassword(passwordEncoder.encode("pass")); other.setRole("USER");
        userRepository.save(other);
        com.prowosma.backend.model.TeamMember tm = new com.prowosma.backend.model.TeamMember();
        tm.setOrganizationId(workspaceId); tm.setEmail("colleague@test.com"); tm.setName("Colleague"); tm.setRole("MEMBER");
        teamMemberRepository.save(tm);
        call(post(BASE + "/" + id + "/resend-invites"), jwtUtil.generateToken("colleague@test.com"), workspaceId, null, 403);

        // the organizer: allowed, everyone gets it
        JsonNode r = json(call(post(BASE + "/" + id + "/resend-invites"), memberToken(), workspaceId, null, 200));
        assertThat(r.get("sent").size()).isEqualTo(2);
        assertThat(r.get("failed").size()).isZero();
        // straight away again: slow down
        call(post(BASE + "/" + id + "/resend-invites"), memberToken(), workspaceId, null, 429);
        // an admin is not held to "creator only", but the minute still applies
        call(post(BASE + "/" + id + "/resend-invites"), adminToken(), workspaceId, null, 429);

        // after the minute, an admin can, and can pick one person
        Meeting m = meetings.findById(id).orElseThrow();
        m.setInvitesResentAt(LocalDateTime.now().minusMinutes(2));
        meetings.save(m);
        org.mockito.Mockito.clearInvocations(email);
        JsonNode picked = json(call(post(BASE + "/" + id + "/resend-invites"), adminToken(), workspaceId, "{\"emails\":[\"b@x.com\",\"stranger@x.com\"]}", 200));
        assertThat(picked.get("sent")).hasSize(1);
        assertThat(picked.get("sent").get(0).asText()).isEqualTo("b@x.com");
    }

    @Test
    void resend_reportsWhoTheMailServerRefused() throws Exception {
        String id = create(ownerToken(), workspaceId, body("Partial", 6, "good@x.com", "bad@x.com")).get("id").asText();
        invitedAddresses(2);
        when(email.sendHtmlEmail(eq("bad@x.com"), any(), anyString(), anyString())).thenReturn(false);
        JsonNode r = json(call(post(BASE + "/" + id + "/resend-invites"), ownerToken(), workspaceId, null, 200));
        assertThat(r.get("sent").get(0).asText()).isEqualTo("good@x.com");
        assertThat(r.get("failed").get(0).asText()).isEqualTo("bad@x.com");
    }

    @Test
    void resend_isRefusedForFinishedMeetings_andForOnesWithNobodyToInvite() throws Exception {
        String solo = create(ownerToken(), workspaceId, body("Solo", 6, ownerEmail)).get("id").asText();
        call(post(BASE + "/" + solo + "/resend-invites"), ownerToken(), workspaceId, null, 400);
        String done = create(ownerToken(), workspaceId, body("Done", 6, "a@x.com")).get("id").asText();
        call(post(BASE + "/" + done + "/complete"), ownerToken(), workspaceId, null, 200);
        call(post(BASE + "/" + done + "/resend-invites"), ownerToken(), workspaceId, null, 409);
        call(post(BASE + "/missing/resend-invites"), ownerToken(), workspaceId, null, 404);
    }

    @Test
    void resend_atMostThirtyPeopleAtATime() throws Exception {
        String[] many = new String[31];
        for (int i = 0; i < 31; i++) many[i] = "p" + i + "@x.com";
        String id = create(ownerToken(), workspaceId, body("Crowd", 6, many)).get("id").asText();
        call(post(BASE + "/" + id + "/resend-invites"), ownerToken(), workspaceId, null, 400);
    }

    // ── availability, prepare, trends ────────────────────────────────────────

    @Test
    void availability_showsWhenSomeoneIsBusy_timesOnly_andCanExcludeTheMeetingBeingEdited() throws Exception {
        LocalDateTime start = LocalDateTime.now().withNano(0).plusDays(2);
        String body = om.writeValueAsString(om.createObjectNode().put("title", "Secret board talk").put("meetingDate", start.toString()).put("durationMins", 60)
                .set("attendees", om.createArrayNode().add("busy@x.com")));
        String id = create(ownerToken(), workspaceId, body).get("id").asText();
        String from = start.minusHours(2) + "Z", to = start.plusHours(3) + "Z";
        MvcResult r = call(get(BASE + "/availability").param("emails", "busy@x.com", "free@x.com").param("from", from).param("to", to), ownerToken(), workspaceId, null, 200);
        assertThat(r.getResponse().getContentAsString()).doesNotContain("Secret board talk");
        JsonNode a = json(r);
        JsonNode busy = null, free = null;
        for (JsonNode n : a) { if ("busy@x.com".equalsIgnoreCase(n.path("email").asText())) busy = n; if ("free@x.com".equalsIgnoreCase(n.path("email").asText())) free = n; }
        assertThat(busy).isNotNull();
        assertThat(busy.toString()).contains(start.toLocalDate().toString());
        assertThat(free == null || free.path("busy").size() == 0).isTrue();
        MvcResult excl = call(get(BASE + "/availability").param("emails", "busy@x.com").param("from", from).param("to", to).param("excludeId", id), ownerToken(), workspaceId, null, 200);
        for (JsonNode n : json(excl)) assertThat(n.path("busy").size()).isZero();
    }

    @Test
    void availability_neverLeaksAnotherWorkspacesCalendar() throws Exception {
        LocalDateTime start = LocalDateTime.now().withNano(0).plusDays(2);
        create(otherOwnerToken(), otherWorkspaceId, om.writeValueAsString(om.createObjectNode().put("title", "Theirs").put("meetingDate", start.toString()).put("durationMins", 60)
                .set("attendees", om.createArrayNode().add("busy@x.com"))));
        MvcResult r = call(get(BASE + "/availability").param("emails", "busy@x.com").param("from", start.minusHours(1) + "Z").param("to", start.plusHours(3) + "Z"),
                ownerToken(), workspaceId, null, 200);
        for (JsonNode n : json(r)) assertThat(n.path("busy").size()).isZero();
    }

    @Test
    void prepare_summary_trends_andProjectHistory_respondForAnEmptyAndAFilledWorkspace() throws Exception {
        call(get(BASE + "/prepare"), ownerToken(), workspaceId, null, 200);
        call(get(BASE + "/trends"), ownerToken(), workspaceId, null, 200);
        call(get(BASE + "/project/p1"), ownerToken(), workspaceId, null, 200);
        String id = create(ownerToken(), workspaceId, body("Filled", -2)).get("id").asText();
        call(post(BASE + "/" + id + "/projects"), ownerToken(), workspaceId, "{\"projectId\":\"p1\",\"discussionNotes\":\"hi\"}", 200);
        call(get(BASE + "/" + id + "/summary"), ownerToken(), workspaceId, null, 200);
        call(get(BASE + "/" + id + "/continuity"), ownerToken(), workspaceId, null, 200);
        call(get(BASE + "/" + id + "/whats-changed"), ownerToken(), workspaceId, null, 200);
        assertThat(json(call(get(BASE + "/project/p1"), ownerToken(), workspaceId, null, 200)).get("data").size()).isEqualTo(1);
        assertThat(json(call(get(BASE + "/trends?days=7"), ownerToken(), workspaceId, null, 200)).size()).isGreaterThan(0);
    }
}

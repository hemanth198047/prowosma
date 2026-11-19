package com.prowosma.backend.alerts;

import com.prowosma.backend.ProwosmaTestBase;
import com.prowosma.backend.attendance.app.AttendanceService;
import com.prowosma.backend.model.Task;
import com.prowosma.backend.model.TeamMember;
import com.prowosma.backend.service.DesktopAlerts;
import com.prowosma.backend.service.PersonalAlertService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.time.*;
import java.util.List;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.assertj.core.api.Assertions.assertThat;

/** What gets a desktop/phone notification, and that each one is sent once. The push itself is mocked. */
@TestPropertySource(properties = {"app.alerts.jobs-enabled=false", "app.attendance.jobs-enabled=false", "app.uma.jobs-enabled=false", "app.meeting-assistant.jobs-enabled=false"})
class DesktopAlertsTest extends ProwosmaTestBase {
    @MockitoBean PersonalAlertService alerts;
    @Autowired DesktopAlerts desktop;
    @Autowired AttendanceService attendance;

    String memberId;

    @BeforeEach
    void setUp() {
        mongoTemplate.remove(new Query(), "alerts_sent");
        mongoTemplate.remove(new Query(), Task.class);
        memberId = teamMemberRepository.findByOrganizationId(workspaceId).stream().filter(t -> memberEmail.equals(t.getEmail())).map(TeamMember::getId).findFirst().orElseThrow();
        reset(alerts);
    }

    MockHttpServletRequestBuilder as(MockHttpServletRequestBuilder b, String token) {
        return b.header("Authorization", authHeader(token)).header("X-Workspace-Id", workspaceId).contentType(MediaType.APPLICATION_JSON);
    }

    String task(String json) throws Exception {
        var r = mvc.perform(as(post("/api/tasks"), ownerToken()).content(json)).andReturn();
        assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isIn(200, 201);
        return com.jayway.jsonpath.JsonPath.read(r.getResponse().getContentAsString(), "$.id");
    }

    @Test
    void assigningSomeoneTellsThemOnce_andNotWhenNothingChangedForThem() throws Exception {
        String id = task("{\"title\":\"Colour grade reel\",\"assigneeIds\":[\"" + memberId + "\"]}");
        verify(alerts, times(1)).tell(eq(memberEmail), eq("New task for you"), eq("Colour grade reel"), contains(id));

        // editing something else: not told again
        Task t = mongoTemplate.findById(id, Task.class);
        t.setDescription("v2"); mongoTemplate.save(t);
        verifyNoMoreInteractions(alerts);
    }

    @Test
    void anExistingAssigneeIsntToldWhenTheTaskIsLaterSaved() {
        Task t = new Task(); t.setOrganizationId(workspaceId); t.setTitle("Old task"); t.setAssigneeIds(List.of(memberId));
        mongoTemplate.getCollection("tasks").drop();
        // written without the save events, as if it existed before this feature
        org.bson.Document d = new org.bson.Document("organizationId", workspaceId).append("title", "Old task").append("assigneeIds", List.of(memberId)).append("status", "TODO");
        mongoTemplate.getCollection(mongoTemplate.getCollectionName(Task.class)).insertOne(d);
        Task old = mongoTemplate.findAll(Task.class).get(0);
        old.setStatus("IN_PROGRESS"); mongoTemplate.save(old);
        verify(alerts, never()).tell(any(), any(), any(), any());
    }

    @Test
    void dueWithinTheHourAndOverdue_eachOnce() {
        LocalDateTime now = LocalDateTime.of(2026, 11, 19, 9, 0);
        Task soon = new Task(); soon.setOrganizationId(workspaceId); soon.setTitle("Deliver teaser"); soon.setAssigneeIds(List.of(memberId)); soon.setDueDate(now.plusMinutes(40));
        Task late = new Task(); late.setOrganizationId(workspaceId); late.setTitle("Send invoice"); late.setAssigneeIds(List.of(memberId)); late.setDueDate(now.minusHours(2));
        Task ancient = new Task(); ancient.setOrganizationId(workspaceId); ancient.setTitle("Ancient"); ancient.setAssigneeIds(List.of(memberId)); ancient.setDueDate(now.minusDays(30));
        Task done = new Task(); done.setOrganizationId(workspaceId); done.setTitle("Done one"); done.setStatus("DONE"); done.setAssigneeIds(List.of(memberId)); done.setDueDate(now.plusMinutes(10));
        for (Task t : List.of(soon, late, ancient, done)) mongoTemplate.save(t);
        reset(alerts);                                                             // ignore the "assigned" alerts from saving them

        Instant at = now.toInstant(ZoneOffset.UTC);
        desktop.sweepAt(at);
        desktop.sweepAt(at.plusSeconds(120));
        verify(alerts, times(1)).tell(eq(memberEmail), eq("Due within the hour"), eq("Deliver teaser"), any());
        verify(alerts, times(1)).tell(eq(memberEmail), eq("Overdue"), eq("Send invoice"), any());
        verify(alerts, never()).tell(any(), any(), eq("Ancient"), any());
        verify(alerts, never()).tell(any(), any(), eq("Done one"), any());
    }

    @Test
    void attendance_notClockedInAfterTheStart_isNudgedOnce_onlyWhenAttendanceIsOn() throws Exception {
        ZoneId zone = attendance.zone(workspaceId);
        // Thursday 19 Nov 2026, 10:30 local: the built-in shift starts at 10:00 with 15 minutes' grace
        Instant at = LocalDateTime.of(2026, 11, 19, 10, 30).atZone(zone).toInstant();
        desktop.sweepAt(at);
        verify(alerts, never()).tell(any(), eq("You haven't clocked in"), any(), any());     // feature off

        mvc.perform(as(post("/api/admin/features"), ownerToken()).content("{\"key\":\"attendance\",\"enabled\":true}")).andReturn();
        desktop.sweepAt(at);
        desktop.sweepAt(at.plusSeconds(120));
        verify(alerts, times(1)).tell(eq(memberEmail), eq("You haven't clocked in"), contains("10:00"), eq("/attendance"));
        // before the start + grace: nobody is nudged on another day
        reset(alerts);
        desktop.sweepAt(LocalDateTime.of(2026, 11, 20, 10, 5).atZone(zone).toInstant());
        verify(alerts, never()).tell(any(), eq("You haven't clocked in"), any(), any());
    }

    @Test
    void mentionsAndPrivateMessagesTellTheOtherPerson() throws Exception {
        String id = task("{\"title\":\"Edit wedding film\"}");
        reset(alerts);
        mvc.perform(as(post("/api/tasks/" + id + "/comments"), ownerToken())
                .content("{\"text\":\"@member@test.com can you check the audio?\",\"mentions\":[\"member@test.com\",\"stranger@else.com\"]}")).andReturn();
        verify(alerts, times(1)).tell(eq(memberEmail), contains("mentioned you"), contains("check the audio"), contains(id));
        verify(alerts, never()).tell(eq("stranger@else.com"), any(), any(), any());

        String dm = com.jayway.jsonpath.JsonPath.read(mvc.perform(as(post("/api/channels/dm"), ownerToken()).content("{\"email\":\"member@test.com\"}"))
                .andReturn().getResponse().getContentAsString(), "$.id");
        mvc.perform(as(post("/api/channels/" + dm + "/messages"), ownerToken()).content("{\"content\":\"Call me when free\"}")).andReturn();
        verify(alerts, times(1)).tell(eq(memberEmail), any(), eq("Call me when free"), eq("/channels"));
        verify(alerts, never()).tell(eq(ownerEmail), any(), eq("Call me when free"), any());
    }
}

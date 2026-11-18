package com.prowosma.backend.attendance;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.attendance.app.AttendanceService;
import com.prowosma.backend.attendance.model.AttendanceLog;
import com.prowosma.backend.model.Project;
import com.prowosma.backend.model.TeamMember;
import com.prowosma.backend.model.User;
import com.prowosma.backend.tenant.TwoWorkspaceTestBase;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.time.*;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

/** Attendance end to end through the HTTP API with an embedded database. The workspace's time zone is UTC. */
@TestPropertySource(properties = {"app.attendance.jobs-enabled=false", "app.uma.jobs-enabled=false", "app.meeting-assistant.jobs-enabled=false"})
class AttendanceApiTest extends TwoWorkspaceTestBase {
    static final String BASE = "/api/attendance";

    @Autowired ObjectMapper om;
    @Autowired AttendanceService service;

    final String managerEmail = "manager@test.com", viewerEmail = "viewer@test.com";
    String projectId;

    @BeforeEach
    void reset() {
        for (String c : new String[]{"attendance_logs", "attendance_shifts", "attendance_call_times", "attendance_requests", "attendance_settings", "workspace_configs"})
            mongoTemplate.remove(new Query(), c);
        TeamMember manager = member(managerEmail, "Mona Manager", "MEMBER");
        TeamMember me = teamMemberRepository.findAllByEmailAndOrganizationId(memberEmail, workspaceId).get(0);
        me.setManagerId(manager.getId());
        teamMemberRepository.save(me);
        member(viewerEmail, "Vic Viewer", "VIEWER");
        Project p = new Project();
        p.setOrganizationId(workspaceId); p.setName("Ad shoot");
        projectId = mongoTemplate.save(p).getId();
    }

    TeamMember member(String email, String name, String role) {
        User u = new User();
        u.setEmail(email); u.setName(name); u.setPassword(passwordEncoder.encode("pass")); u.setRole("USER");
        userRepository.save(u);
        TeamMember tm = new TeamMember();
        tm.setOrganizationId(workspaceId); tm.setEmail(email); tm.setName(name); tm.setRole(role);
        return teamMemberRepository.save(tm);
    }

    String token(String email) { return jwtUtil.generateToken(email); }

    MockHttpServletRequestBuilder as(MockHttpServletRequestBuilder b, String token) { return as(b, token, workspaceId); }

    MockHttpServletRequestBuilder as(MockHttpServletRequestBuilder b, String token, String ws) {
        return b.header("Authorization", authHeader(token)).header("X-Workspace-Id", ws).contentType(MediaType.APPLICATION_JSON);
    }

    MvcResult call(MockHttpServletRequestBuilder b, String token, String body, int expect) throws Exception {
        if (body != null) b = b.content(body);
        MvcResult r = mvc.perform(as(b, token)).andReturn();
        assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(expect);
        return r;
    }

    JsonNode json(MvcResult r) throws Exception { return om.readTree(r.getResponse().getContentAsString()); }

    void enable() throws Exception {
        call(post("/api/admin/features"), ownerToken(), "{\"key\":\"attendance\",\"enabled\":true}", 200);
    }

    void settings(String patch) throws Exception {
        JsonNode s = json(call(get(BASE + "/settings"), ownerToken(), null, 200)).get("settings");
        com.fasterxml.jackson.databind.node.ObjectNode o = (com.fasterxml.jackson.databind.node.ObjectNode) s;
        o.setAll((com.fasterxml.jackson.databind.node.ObjectNode) om.readTree(patch));
        call(put(BASE + "/settings"), ownerToken(), o.toString(), 200);
    }

    LocalDate today() { return LocalDate.now(ZoneOffset.UTC); }

    /** The latest past date (before today) that is a Monday-Friday. */
    LocalDate pastWeekday(int skip) {
        LocalDate d = today().minusDays(1);
        int seen = 0;
        while (true) {
            if (d.getDayOfWeek() != DayOfWeek.SATURDAY && d.getDayOfWeek() != DayOfWeek.SUNDAY && seen++ == skip) return d;
            d = d.minusDays(1);
        }
    }

    AttendanceLog storedLog(String email, LocalDate d) {
        return mongoTemplate.findOne(new Query(Criteria.where("organizationId").is(workspaceId).and("email").is(email).and("date").is(d.toString())), AttendanceLog.class);
    }

    // ── flag ────────────────────────────────────────────────────────────

    @Test
    void offByDefault_everythingButStatusIsHidden_andNothingIsStored() throws Exception {
        assertThat(json(call(get(BASE + "/status"), memberToken(), null, 200)).get("enabled").asBoolean()).isFalse();
        JsonNode refused = json(call(post(BASE + "/me/clock-in"), memberToken(), "{\"workMode\":\"REMOTE\"}", 404));
        assertThat(refused.get("code").asText()).isEqualTo("FEATURE_DISABLED");
        call(get(BASE + "/floor"), ownerToken(), null, 404);
        assertThat(mongoTemplate.count(new Query(), "attendance_logs")).isZero();
        assertThat(json(call(get("/api/dashboard/summary"), ownerToken(), null, 200)).has("onlineCount")).isFalse();
    }

    // ── clocking ────────────────────────────────────────────────────────

    @Test
    void clockInAsksWhereYouWork_capturesIpAndRoundedLocation_andLinksTheProject() throws Exception {
        enable();
        assertThat(json(call(post(BASE + "/me/clock-in"), memberToken(), "{}", 400)).get("code").asText()).isEqualTo("WORK_MODE_NEEDED");
        JsonNode me = json(call(post(BASE + "/me/clock-in").header("X-Forwarded-For", "203.0.113.7, 10.0.0.1"), memberToken(),
                "{\"workMode\":\"ON_LOCATION\",\"projectId\":\"" + projectId + "\",\"lat\":19.0760123456,\"lng\":72.8777654321,\"accuracy\":12.7}", 200));
        assertThat(me.get("state").asText()).isEqualTo("WORKING");
        JsonNode log = me.get("log");
        assertThat(log.get("workMode").asText()).isEqualTo("ON_LOCATION");
        assertThat(log.get("projectName").asText()).isEqualTo("Ad shoot");
        JsonNode s = log.at("/sessions/0");
        assertThat(s.get("inIp").asText()).isEqualTo("203.0.113.7");
        assertThat(s.at("/inGeo/lat").asDouble()).isEqualTo(19.07601);
        assertThat(s.at("/inGeo/accuracy").asDouble()).isEqualTo(13.0);

        assertThat(json(call(post(BASE + "/me/clock-in"), memberToken(), "{\"workMode\":\"REMOTE\"}", 409)).get("code").asText()).isEqualTo("ALREADY_CLOCKED_IN");
        // another workspace's project can't be linked
        call(post(BASE + "/me/clock-out"), memberToken(), "{}", 200);
        String otherProject = mongoTemplate.save(project(otherWorkspaceId)).getId();
        assertThat(json(call(post(BASE + "/me/clock-in"), memberToken(), "{\"workMode\":\"REMOTE\",\"projectId\":\"" + otherProject + "\"}", 400))
                .get("code").asText()).isEqualTo("BAD_PROJECT");
    }

    Project project(String org) {
        Project p = new Project();
        p.setOrganizationId(org); p.setName("Elsewhere");
        return p;
    }

    @Test
    void breaksPauseTheClock_andASecondClockInTheSameDayAddsASession() throws Exception {
        enable();
        call(post(BASE + "/me/clock-in"), memberToken(), "{\"workMode\":\"IN_OFFICE\"}", 200);
        call(post(BASE + "/me/break/end"), memberToken(), "{}", 409);
        JsonNode onBreak = json(call(post(BASE + "/me/break/start"), memberToken(), "{\"type\":\"LUNCH\"}", 200));
        assertThat(onBreak.get("state").asText()).isEqualTo("ON_BREAK");
        call(post(BASE + "/me/break/start"), memberToken(), "{\"type\":\"TEA\"}", 409);
        assertThat(json(call(post(BASE + "/me/break/end"), memberToken(), "{}", 200)).get("state").asText()).isEqualTo("WORKING");
        call(post(BASE + "/me/break/start"), memberToken(), "{\"type\":\"TEA\"}", 200);
        JsonNode out = json(call(post(BASE + "/me/clock-out"), memberToken(), "{}", 200));    // clocking out ends the break too
        assertThat(out.get("state").asText()).isEqualTo("OFF");
        assertThat(out.at("/log/breaks/1/end").isNull()).isFalse();
        call(post(BASE + "/me/clock-out"), memberToken(), "{}", 409);
        call(post(BASE + "/me/clock-in"), memberToken(), "{\"workMode\":\"REMOTE\"}", 200);
        AttendanceLog log = storedLog(memberEmail, today());
        assertThat(log.getSessions()).hasSize(2);
        assertThat(log.getWorkMode()).isEqualTo("REMOTE");
        assertThat(mongoTemplate.count(new Query(), "attendance_logs")).isEqualTo(1);
    }

    @Test
    void idlePause_backdatesAnAutomaticBreak_whichCanBeCountedAsWork() throws Exception {
        enable();
        call(post(BASE + "/me/clock-in"), memberToken(), "{\"workMode\":\"REMOTE\"}", 200);
        // "remind" (the default) only asks; nothing is recorded
        assertThat(json(call(post(BASE + "/me/idle"), memberToken(), "{\"since\":\"" + Instant.now().minusSeconds(60) + "\"}", 200))
                .get("state").asText()).isEqualTo("WORKING");
        settings("{\"idleAction\":\"PAUSE\"}");
        // back-dated to the clock-in at the earliest, never before
        JsonNode paused = json(call(post(BASE + "/me/idle"), memberToken(), "{\"since\":\"" + Instant.now().minusSeconds(3600) + "\"}", 200));
        assertThat(paused.get("state").asText()).isEqualTo("ON_BREAK");
        JsonNode b = paused.at("/log/breaks/0");
        assertThat(b.get("type").asText()).isEqualTo("IDLE");
        assertThat(b.get("auto").asBoolean()).isTrue();
        assertThat(Instant.parse(b.get("start").asText())).isAfterOrEqualTo(Instant.parse(paused.at("/log/sessions/0/in").asText()));
        JsonNode back = json(call(post(BASE + "/me/break/end"), memberToken(), "{\"countAsWork\":true}", 200));
        assertThat(back.get("state").asText()).isEqualTo("WORKING");
        assertThat(back.at("/log/breaks").size()).isZero();
    }

    @Test
    void viewersCanClockThemselves_butNotChangeRules() throws Exception {
        enable();
        call(post(BASE + "/me/clock-in"), token(viewerEmail), "{\"workMode\":\"REMOTE\"}", 200);
        call(put(BASE + "/settings"), token(viewerEmail), "{}", 403);
    }

    @Test
    void membersCantSeeTheFloor_changeRules_orExport() throws Exception {
        enable();
        call(get(BASE + "/floor"), memberToken(), null, 403);
        call(put(BASE + "/settings"), memberToken(), "{\"locationMode\":\"OFF\",\"idleAction\":\"REMIND\",\"overtimeAfterMinutes\":540,\"autoClockOutHours\":16}", 403);
        call(post(BASE + "/shifts"), memberToken(), "{\"name\":\"x\",\"start\":\"09:00\",\"end\":\"18:00\",\"days\":[\"MON\"]}", 403);
        call(get(BASE + "/report/export"), memberToken(), null, 403);
        // a member's report is only themselves
        call(post(BASE + "/me/clock-in"), token(managerEmail), "{\"workMode\":\"REMOTE\"}", 200);
        JsonNode rows = json(call(get(BASE + "/report?from=" + today() + "&to=" + today()), memberToken(), null, 200));
        for (JsonNode r : rows) assertThat(r.get("email").asText()).isEqualTo(memberEmail);
    }

    @Test
    void hrListedPeopleGetAdminRights() throws Exception {
        enable();
        settings("{\"hrEmails\":[\"" + managerEmail.toUpperCase() + "\"]}");
        call(get(BASE + "/floor"), token(managerEmail), null, 200);
        call(get(BASE + "/report/export"), token(managerEmail), null, 200);
    }

    @Test
    void floorShowsWhoIsIn_andTheDashboardOnlineNumberIsPeopleClockedIn() throws Exception {
        enable();
        // every day a working day, starting at midnight with no grace: anyone not in yet is late
        call(post(BASE + "/shifts"), ownerToken(), "{\"name\":\"All week\",\"start\":\"00:00\",\"end\":\"23:59\",\"graceMinutes\":0,\"days\":"
                + "[\"MON\",\"TUE\",\"WED\",\"THU\",\"FRI\",\"SAT\",\"SUN\"],\"defaultShift\":true}", 201);
        call(post(BASE + "/me/clock-in"), memberToken(), "{\"workMode\":\"IN_OFFICE\"}", 200);
        call(post(BASE + "/me/clock-in"), token(managerEmail), "{\"workMode\":\"REMOTE\"}", 200);
        call(post(BASE + "/me/break/start"), token(managerEmail), "{\"type\":\"TEA\"}", 200);
        JsonNode floor = json(call(get(BASE + "/floor"), adminToken(), null, 200));
        assertThat(floor.at("/counts/WORKING").asInt()).isEqualTo(1);
        assertThat(floor.at("/counts/ON_BREAK").asInt()).isEqualTo(1);
        String adminStatus = null;
        for (JsonNode p : floor.get("people")) if (p.get("email").asText().equals(adminEmail)) adminStatus = p.get("status").asText();
        assertThat(adminStatus).isEqualTo("LATE_NOT_IN");
        assertThat(floor.at("/people/0/email").asText()).isEqualTo(memberEmail);        // working people first
        assertThat(json(call(get("/api/dashboard/summary"), ownerToken(), null, 200)).get("onlineCount").asInt()).isEqualTo(2);
    }

    @Test
    void aCallTimeReplacesTheShiftStartForItsCrew() throws Exception {
        enable();
        call(post(BASE + "/shifts"), ownerToken(), "{\"name\":\"All week\",\"start\":\"00:00\",\"end\":\"23:59\",\"graceMinutes\":0,\"days\":"
                + "[\"MON\",\"TUE\",\"WED\",\"THU\",\"FRI\",\"SAT\",\"SUN\"],\"defaultShift\":true}", 201);
        call(post(BASE + "/me/clock-in"), memberToken(), "{\"workMode\":\"ON_LOCATION\"}", 200);
        AttendanceLog before = storedLog(memberEmail, today());
        boolean lateBefore = before.isLate();
        // a call time later today: not late
        JsonNode ct = json(call(post(BASE + "/call-times"), ownerToken(), "{\"projectId\":\"" + projectId + "\",\"date\":\"" + today()
                + "\",\"callTime\":\"23:59\",\"bufferMinutes\":0,\"location\":\"Film City\",\"crew\":[\"" + memberEmail + "\"]}", 201));
        AttendanceLog after = storedLog(memberEmail, today());
        assertThat(after.getCallTimeId()).isEqualTo(ct.get("id").asText());
        assertThat(after.isLate()).isFalse();
        assertThat(json(call(get(BASE + "/me/call-times"), memberToken(), null, 200)).size()).isEqualTo(1);
        assertThat(json(call(get(BASE + "/me/call-times"), token(managerEmail), null, 200)).size()).isZero();
        call(delete(BASE + "/call-times/" + ct.get("id").asText()), ownerToken(), null, 204);
        assertThat(storedLog(memberEmail, today()).isLate()).isEqualTo(lateBefore);
    }

    // ── corrections ─────────────────────────────────────────────────────

    @Test
    void aMissedPunchIsCorrectedOnlyAfterTheManagerApproves() throws Exception {
        enable();
        LocalDate d = pastWeekday(0);
        call(post(BASE + "/me/corrections"), memberToken(), "{\"date\":\"" + d + "\",\"reason\":\"forgot\"}", 400);
        call(post(BASE + "/me/corrections"), memberToken(), "{\"date\":\"" + today().plusDays(1) + "\",\"clockIn\":\"10:00\",\"reason\":\"x\"}", 400);
        JsonNode req = json(call(post(BASE + "/me/corrections"), memberToken(),
                "{\"date\":\"" + d + "\",\"clockIn\":\"10:00\",\"clockOut\":\"19:30\",\"reason\":\"Phone died on set\"}", 201));
        assertThat(req.get("approverEmail").asText()).isEqualTo(managerEmail);
        assertThat(storedLog(memberEmail, d)).isNull();
        String id = req.get("id").asText();

        call(post(BASE + "/approvals/requests/" + id), memberToken(), "{\"approve\":true}", 403);          // not their own
        call(post(BASE + "/approvals/requests/" + id), token(viewerEmail), "{\"approve\":true}", 403);     // not their report
        call(post(BASE + "/approvals/requests/" + id), otherOwnerToken(), "{\"approve\":true}", 403);      // another workspace: not a member
        JsonNode inbox = json(call(get(BASE + "/approvals"), token(managerEmail), null, 200));
        assertThat(inbox.get("requests").size()).isEqualTo(1);
        assertThat(json(call(get(BASE + "/approvals"), token(viewerEmail), null, 200)).get("requests").size()).isZero();

        call(post(BASE + "/approvals/requests/" + id), token(managerEmail), "{\"approve\":true,\"note\":\"ok\"}", 200);
        AttendanceLog log = storedLog(memberEmail, d);
        assertThat(log.getSessions()).hasSize(1);
        assertThat(log.getSessions().get(0).getSource()).isEqualTo("REGULARIZED");
        assertThat(log.getWorkedMinutes()).isEqualTo(570);
        assertThat(log.getOvertimeMinutes()).isEqualTo(30);
        call(post(BASE + "/approvals/requests/" + id), token(managerEmail), "{\"approve\":true}", 409);
    }

    @Test
    void aForgottenClockOutIsClosedAutomatically_andFlagged() throws Exception {
        enable();
        call(post(BASE + "/me/clock-in"), memberToken(), "{\"workMode\":\"REMOTE\"}", 200);
        AttendanceLog log = storedLog(memberEmail, today());
        log.getSessions().get(0).setIn(Instant.now().minus(Duration.ofHours(20)));
        log.setExpectedEnd(null);
        mongoTemplate.save(log);
        assertThat(service.autoClose(Instant.now())).isEqualTo(1);
        AttendanceLog closed = storedLog(memberEmail, today());
        assertThat(closed.getState()).isEqualTo("OFF");
        assertThat(closed.isAutoClosed()).isTrue();
        assertThat(closed.getSessions().get(0).getSource()).isEqualTo("AUTO_CLOSED");
        assertThat(closed.getWorkedMinutes()).isEqualTo(16 * 60);
    }

    // ── leave, absence, overtime, comp-off ──────────────────────────────

    @Test
    void approvedLeaveIsNotANoShow_butAnUnexplainedMissedDayIs() throws Exception {
        enable();
        LocalDate leaveDay = pastWeekday(0), missed = pastWeekday(1);
        JsonNode leave = json(call(post(BASE + "/me/leave"), memberToken(),
                "{\"fromDate\":\"" + leaveDay + "\",\"toDate\":\"" + leaveDay + "\",\"leaveType\":\"SICK\",\"reason\":\"Fever\"}", 201));
        assertThat(leave.get("days").asDouble()).isEqualTo(1.0);
        call(post(BASE + "/me/leave"), memberToken(), "{\"fromDate\":\"" + leaveDay + "\",\"leaveType\":\"CASUAL\"}", 409);   // overlaps
        call(post(BASE + "/approvals/requests/" + leave.get("id").asText()), adminToken(), "{\"approve\":true}", 200);

        JsonNode rows = json(call(get(BASE + "/report?from=" + missed + "&to=" + leaveDay + "&email=" + memberEmail), adminToken(), null, 200));
        String leaveStatus = null, missedStatus = null;
        for (JsonNode r : rows) {
            if (r.get("date").asText().equals(leaveDay.toString())) leaveStatus = r.get("status").asText();
            if (r.get("date").asText().equals(missed.toString())) missedStatus = r.get("status").asText();
        }
        assertThat(leaveStatus).isEqualTo("LEAVE");
        assertThat(missedStatus).isEqualTo("ABSENT");

        JsonNode cal = json(call(get(BASE + "/calendar?from=" + leaveDay + "&to=" + leaveDay), token(viewerEmail), null, 200));
        assertThat(cal.at("/leave/0/name").asText()).isEqualTo("Test Member");
        assertThat(cal.at("/leave/0").has("reason")).isFalse();                          // reasons stay private
        JsonNode bal = json(call(get(BASE + "/me/balances"), memberToken(), null, 200));
        assertThat(bal.at("/SICK/used").asDouble()).isEqualTo(1.0);
        assertThat(bal.at("/SICK/left").asDouble()).isEqualTo(11.0);
    }

    @Test
    void leaveOverTheQuotaIsRefused_andWeekendsArentCounted() throws Exception {
        enable();
        settings("{\"leaveQuota\":{\"CASUAL\":2,\"SICK\":12,\"EARNED\":15}}");
        LocalDate mon = today().with(java.time.temporal.TemporalAdjusters.next(DayOfWeek.MONDAY));
        if (mon.getYear() != today().getYear()) return;                                  // the quota is per year; skip the last week of the year
        JsonNode week = json(call(post(BASE + "/me/leave"), memberToken(),
                "{\"fromDate\":\"" + mon.minusDays(2) + "\",\"toDate\":\"" + mon.plusDays(1) + "\",\"leaveType\":\"UNPAID\"}", 201));
        assertThat(week.get("days").asDouble()).isEqualTo(2.0);                          // Sat, Sun, Mon, Tue -> 2 working days
        JsonNode refused = json(call(post(BASE + "/me/leave"), memberToken(),
                "{\"fromDate\":\"" + mon.plusDays(7) + "\",\"toDate\":\"" + mon.plusDays(9) + "\",\"leaveType\":\"CASUAL\"}", 409));
        assertThat(refused.get("code").asText()).isEqualTo("NOT_ENOUGH_BALANCE");
        JsonNode half = json(call(post(BASE + "/me/leave"), memberToken(),
                "{\"fromDate\":\"" + mon.plusDays(7) + "\",\"leaveType\":\"CASUAL\",\"halfDay\":true}", 201));
        assertThat(half.get("days").asDouble()).isEqualTo(0.5);
        call(post(BASE + "/me/requests/" + half.get("id").asText() + "/cancel"), memberToken(), "{}", 200);
        call(post(BASE + "/me/requests/" + half.get("id").asText() + "/cancel"), memberToken(), "{}", 409);
    }

    @Test
    void approvedSundayOvertimeEarnsCompOff_whichCanBeTakenAsLeave() throws Exception {
        enable();
        LocalDate sunday = today().with(java.time.temporal.TemporalAdjusters.previous(DayOfWeek.SUNDAY));
        AttendanceLog l = new AttendanceLog();
        l.setOrganizationId(workspaceId); l.setEmail(memberEmail); l.setName("Test Member"); l.setDate(sunday.toString());
        l.setDayType("WEEKEND"); l.setState("OFF");
        AttendanceLog.Session s = new AttendanceLog.Session();
        s.setIn(sunday.atTime(11, 0).toInstant(ZoneOffset.UTC)); s.setOut(sunday.atTime(18, 0).toInstant(ZoneOffset.UTC));
        l.getSessions().add(s);
        String logId = mongoTemplate.save(l).getId();

        JsonNode claimed = json(call(post(BASE + "/me/logs/" + logId + "/overtime"), memberToken(), "{\"note\":\"Shoot overran\"}", 200));
        assertThat(claimed.get("overtimeStatus").asText()).isEqualTo("PENDING");
        assertThat(claimed.get("overtimeMinutes").asLong()).isEqualTo(420);
        call(post(BASE + "/me/logs/" + logId + "/overtime"), memberToken(), "{}", 409);
        call(post(BASE + "/me/logs/" + logId + "/overtime"), token(managerEmail), "{}", 404);          // not theirs
        assertThat(json(call(get(BASE + "/approvals"), token(managerEmail), null, 200)).get("overtime").size()).isEqualTo(1);
        JsonNode approved = json(call(post(BASE + "/approvals/overtime/" + logId), token(managerEmail), "{\"approve\":true}", 200));
        assertThat(approved.get("compOffEarned").asDouble()).isEqualTo(1.0);

        assertThat(json(call(get(BASE + "/me/balances"), memberToken(), null, 200)).at("/COMP_OFF/left").asDouble()).isEqualTo(1.0);
        LocalDate next = pastWeekday(0);
        call(post(BASE + "/me/leave"), memberToken(), "{\"fromDate\":\"" + next + "\",\"leaveType\":\"COMP_OFF\"}", 201);
        assertThat(json(call(post(BASE + "/me/leave"), memberToken(), "{\"fromDate\":\"" + pastWeekday(1) + "\",\"leaveType\":\"COMP_OFF\"}", 409))
                .get("code").asText()).isEqualTo("NOT_ENOUGH_BALANCE");
    }

    // ── export, isolation ───────────────────────────────────────────────

    @Test
    void payrollExport_csvNeutralisesFormulas_andExcelIsARealWorkbook() throws Exception {
        enable();
        TeamMember me = teamMemberRepository.findAllByEmailAndOrganizationId(memberEmail, workspaceId).get(0);
        me.setName("=HYPERLINK(\"x\")");
        teamMemberRepository.save(me);
        call(post(BASE + "/me/clock-in"), memberToken(), "{\"workMode\":\"IN_OFFICE\"}", 200);
        MvcResult csv = call(get(BASE + "/report/export?from=" + today() + "&to=" + today()), ownerToken(), null, 200);
        String body = csv.getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        assertThat(body).contains("Date,Name,Email").contains(memberEmail).contains("\"'=HYPERLINK(\"\"x\"\")\"");
        assertThat(csv.getResponse().getHeader("Content-Disposition")).contains(".csv");
        MvcResult xlsx = call(get(BASE + "/report/export?from=" + today() + "&to=" + today() + "&format=xlsx"), ownerToken(), null, 200);
        byte[] bytes = xlsx.getResponse().getContentAsByteArray();
        assertThat(new String(bytes, 0, 2)).isEqualTo("PK");
        try (var wb = new org.apache.poi.xssf.usermodel.XSSFWorkbook(new java.io.ByteArrayInputStream(bytes))) {
            assertThat(wb.getSheetAt(0).getRow(0).getCell(0).getStringCellValue()).isEqualTo("Date");
            assertThat(wb.getSheetAt(0).getLastRowNum()).isGreaterThanOrEqualTo(1);
        }
    }

    @Test
    void anotherWorkspaceSeesNothing() throws Exception {
        enable();
        call(post(BASE + "/me/clock-in"), memberToken(), "{\"workMode\":\"REMOTE\"}", 200);
        // the other workspace has the flag off: hidden
        MvcResult r = mvc.perform(as(get(BASE + "/floor"), otherOwnerToken(), otherWorkspaceId)).andReturn();
        assertThat(r.getResponse().getStatus()).isEqualTo(404);
        mvc.perform(as(post("/api/admin/features"), otherOwnerToken(), otherWorkspaceId).content("{\"key\":\"attendance\",\"enabled\":true}")).andReturn();
        JsonNode floor = json(mvc.perform(as(get(BASE + "/floor"), otherOwnerToken(), otherWorkspaceId)).andReturn());
        for (JsonNode p : floor.get("people")) assertThat(p.get("email").asText()).isNotEqualTo(memberEmail);
        assertThat(floor.at("/counts/WORKING").asInt()).isZero();
        String logId = storedLog(memberEmail, today()).getId();
        MvcResult claim = mvc.perform(as(post(BASE + "/approvals/overtime/" + logId), otherOwnerToken(), otherWorkspaceId).content("{\"approve\":true}")).andReturn();
        assertThat(claim.getResponse().getStatus()).isEqualTo(404);
    }

    @Test
    void settingsAreValidated() throws Exception {
        enable();
        JsonNode bad = json(mvc.perform(as(put(BASE + "/settings"), ownerToken()).content("{\"timezone\":\"Mars/Base\",\"locationMode\":\"OFF\",\"idleAction\":\"REMIND\"}")).andReturn());
        assertThat(bad.get("code").asText()).isEqualTo("BAD_TIMEZONE");
        settings("{\"timezone\":\"Asia/Kolkata\"}");
        assertThat(json(call(get(BASE + "/me"), memberToken(), null, 200)).get("timezone").asText()).isEqualTo("Asia/Kolkata");
        call(post(BASE + "/shifts"), ownerToken(), "{\"name\":\"Bad\",\"start\":\"9am\",\"end\":\"18:00\",\"days\":[\"MON\"]}", 400);
        // a person is on one shift only
        String a = json(call(post(BASE + "/shifts"), ownerToken(), "{\"name\":\"A\",\"start\":\"09:00\",\"end\":\"18:00\",\"days\":[\"MON\"],\"members\":[\"" + memberEmail + "\"]}", 201)).get("id").asText();
        call(post(BASE + "/shifts"), ownerToken(), "{\"name\":\"B\",\"start\":\"10:00\",\"end\":\"19:00\",\"days\":[\"MON\"],\"members\":[\"" + memberEmail + "\"]}", 201);
        JsonNode shifts = json(call(get(BASE + "/settings"), ownerToken(), null, 200)).get("shifts");
        for (JsonNode s : shifts) if (s.get("id").asText().equals(a)) assertThat(s.get("members").size()).isZero();
        assertThat(json(call(get(BASE + "/me"), memberToken(), null, 200)).at("/shift/name").asText()).isEqualTo("B");
    }

}

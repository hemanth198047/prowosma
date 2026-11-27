package com.prowosma.backend.attendance;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.model.TeamMember;
import com.prowosma.backend.model.User;
import com.prowosma.backend.model.UserGroup;
import com.prowosma.backend.tenant.TwoWorkspaceTestBase;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

/** The attendance details report: filters, and reports across several workspaces with each workspace's own rules. */
class AttendanceReportFiltersTest extends TwoWorkspaceTestBase {
    static final String BASE = "/api/attendance";

    @Autowired ObjectMapper om;

    final String designerEmail = "designer@test.com", editorEmail = "editor@test.com", leadEmail = "lead@test.com";

    @BeforeEach
    void seed() throws Exception {
        for (String c : new String[]{"attendance_logs", "attendance_shifts", "attendance_call_times", "attendance_requests", "attendance_settings",
                "workspace_configs", "user_groups"})
            mongoTemplate.remove(new Query(), c);
        TeamMember lead = member(workspaceId, leadEmail, "Lena Lead", "MEMBER", "Post-production, Colour");
        TeamMember designer = member(workspaceId, designerEmail, "Dev Designer", "MEMBER", "Design");
        designer.setManagerId(lead.getId());
        teamMemberRepository.save(designer);
        TeamMember editor = member(workspaceId, editorEmail, "Eli Editor", "MEMBER", null);
        editor.setManagerId(lead.getId());
        teamMemberRepository.save(editor);
        UserGroup dept = new UserGroup();                                    // a department group (Access control)
        dept.setOrganizationId(workspaceId); dept.setName("Editing"); dept.setType("DEPARTMENT");
        dept.setMemberEmails(new ArrayList<>(List.of(editorEmail)));
        mongoTemplate.save(dept);
        // the owner of the first workspace is an ADMIN in the other one too; the plain member is in the other one as a MEMBER
        member(otherWorkspaceId, ownerEmail, "Owner", "ADMIN", null);
        member(otherWorkspaceId, memberEmail, "Member", "MEMBER", null);
        member(otherWorkspaceId, "camera@test.com", "Cam Operator", "MEMBER", "Camera");
        call(post("/api/admin/features"), ownerToken(), workspaceId, "{\"key\":\"attendance\",\"enabled\":true}", 200);
        call(post("/api/admin/features"), otherOwnerToken(), otherWorkspaceId, "{\"key\":\"attendance\",\"enabled\":true}", 200);
        call(post(BASE + "/me/clock-in"), token(designerEmail), workspaceId, "{\"workMode\":\"REMOTE\"}", 200);
        call(post(BASE + "/me/clock-in"), token(editorEmail), workspaceId, "{\"workMode\":\"IN_OFFICE\"}", 200);
        call(post(BASE + "/me/clock-in"), token("camera@test.com"), otherWorkspaceId, "{\"workMode\":\"ON_LOCATION\"}", 200);
    }

    TeamMember member(String org, String email, String name, String role, String department) {
        if (userRepository.findByEmail(email).isEmpty()) {
            User u = new User();
            u.setEmail(email); u.setName(name); u.setPassword(passwordEncoder.encode("pass")); u.setRole("USER");
            userRepository.save(u);
        }
        TeamMember tm = new TeamMember();
        tm.setOrganizationId(org); tm.setEmail(email); tm.setName(name); tm.setRole(role); tm.setDepartment(department);
        return teamMemberRepository.save(tm);
    }

    String token(String email) { return jwtUtil.generateToken(email); }

    MvcResult call(MockHttpServletRequestBuilder b, String token, String ws, String body, int expect) throws Exception {
        b = b.header("Authorization", authHeader(token)).header("X-Workspace-Id", ws).contentType(MediaType.APPLICATION_JSON);
        if (body != null) b = b.content(body);
        MvcResult r = mvc.perform(b).andReturn();
        assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(expect);
        return r;
    }

    JsonNode report(String token, String ws, String query) throws Exception {
        String today = LocalDate.now(ZoneOffset.UTC).toString();
        return om.readTree(call(get(BASE + "/report?from=" + today + "&to=" + today + query), token, ws, null, 200).getResponse().getContentAsString());
    }

    static Set<String> emails(JsonNode rows) {
        Set<String> out = new HashSet<>();
        rows.forEach(r -> out.add(r.get("email").asText()));
        return out;
    }

    @Test
    void rowsCarryWorkspaceDepartmentsAndManager() throws Exception {
        JsonNode rows = report(ownerToken(), workspaceId, "");
        JsonNode designer = null, editor = null;
        for (JsonNode r : rows) {
            if (r.get("email").asText().equals(designerEmail)) designer = r;
            if (r.get("email").asText().equals(editorEmail)) editor = r;
        }
        assertThat(designer.get("workspace").asText()).isEqualTo(workspaceRepository.findById(workspaceId).orElseThrow().getName());
        assertThat(designer.get("workspaceId").asText()).isEqualTo(workspaceId);
        assertThat(designer.get("managerName").asText()).isEqualTo("Lena Lead");
        assertThat(designer.get("departments").get(0).asText()).isEqualTo("Design");
        assertThat(editor.get("departments").get(0).asText()).isEqualTo("Editing");         // from the department group
        assertThat(editor.get("workMode").asText()).isEqualTo("IN_OFFICE");
    }

    @Test
    void filtersByDepartmentPersonManagerWorkModeAndSearch() throws Exception {
        assertThat(emails(report(ownerToken(), workspaceId, "&department=Design"))).containsExactly(designerEmail);
        assertThat(emails(report(ownerToken(), workspaceId, "&department=Editing&department=Design"))).containsExactlyInAnyOrder(designerEmail, editorEmail);
        // a department name with a comma is one value, never split
        assertThat(emails(report(ownerToken(), workspaceId, "&department=Post-production, Colour"))).containsExactly(leadEmail);
        assertThat(emails(report(ownerToken(), workspaceId, "&person=" + editorEmail.toUpperCase()))).containsExactly(editorEmail);
        assertThat(emails(report(ownerToken(), workspaceId, "&manager=" + leadEmail))).containsExactlyInAnyOrder(designerEmail, editorEmail);
        assertThat(emails(report(ownerToken(), workspaceId, "&workMode=REMOTE"))).containsExactly(designerEmail);
        assertThat(emails(report(ownerToken(), workspaceId, "&q=eli"))).containsExactly(editorEmail);
        // the old single-person parameter still works
        assertThat(emails(report(ownerToken(), workspaceId, "&email=" + designerEmail))).containsExactly(designerEmail);
    }

    @Test
    void filtersByStatus() throws Exception {
        JsonNode all = report(ownerToken(), workspaceId, "");
        String designerStatus = null;
        for (JsonNode r : all) if (r.get("email").asText().equals(designerEmail)) designerStatus = r.get("status").asText();
        JsonNode only = report(ownerToken(), workspaceId, "&status=" + designerStatus);
        assertThat(emails(only)).contains(designerEmail);
        only.forEach(r -> assertThat(r.get("status").asText()).isEqualTo(only.get(0).get("status").asText()));
    }

    @Test
    void severalWorkspaces_eachWithItsOwnRules() throws Exception {
        // the owner is an admin in both: everyone from both workspaces
        JsonNode both = report(ownerToken(), workspaceId, "&workspace=" + workspaceId + "&workspace=" + otherWorkspaceId);
        assertThat(emails(both)).contains(designerEmail, editorEmail, "camera@test.com");
        Set<String> wsIds = new HashSet<>();
        both.forEach(r -> wsIds.add(r.get("workspaceId").asText()));
        assertThat(wsIds).containsExactlyInAnyOrder(workspaceId, otherWorkspaceId);
        assertThat(emails(report(ownerToken(), workspaceId, "&workspace=" + otherWorkspaceId + "&department=Camera"))).containsExactly("camera@test.com");

        // a plain member there sees only themselves in that workspace
        JsonNode mine = report(memberToken(), workspaceId, "&workspace=" + otherWorkspaceId);
        assertThat(emails(mine)).containsExactly(memberEmail);
        // and can't export it (not admin / HR there)
        call(get(BASE + "/report/export?workspace=" + otherWorkspaceId), memberToken(), workspaceId, null, 403);
        // the owner can export both
        String csv = call(get(BASE + "/report/export?workspace=" + workspaceId + "&workspace=" + otherWorkspaceId), ownerToken(), workspaceId, null, 200)
                .getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        assertThat(csv).contains("Date,Name,Email,Workspace,Department,Manager,Status").contains("Other Workspace").contains("Lena Lead");
    }

    @Test
    void workspacesTheyArentIn_areRefused_andAttendanceCantBeSwitchedOff() throws Exception {
        // a person who isn't a member of the other workspace
        call(get(BASE + "/report?workspace=" + otherWorkspaceId), token(designerEmail), workspaceId, null, 403);
        // attendance is part of every workspace now: an old "off" flag is ignored, so the report is still available
        call(post("/api/admin/features"), otherOwnerToken(), otherWorkspaceId, "{\"key\":\"attendance\",\"enabled\":false}", 200);
        call(get(BASE + "/report?workspace=" + otherWorkspaceId), ownerToken(), workspaceId, null, 200);
    }

    @Test
    void optionsOfferOnlyWhatThePersonMaySee() throws Exception {
        JsonNode o = om.readTree(call(get(BASE + "/report/options"), ownerToken(), workspaceId, null, 200).getResponse().getContentAsString());
        Set<String> ws = new HashSet<>();
        o.get("workspaces").forEach(w -> ws.add(w.get("id").asText()));
        assertThat(ws).containsExactlyInAnyOrder(workspaceId, otherWorkspaceId);
        List<String> deps = new ArrayList<>();
        o.get("departments").forEach(d -> deps.add(d.asText()));
        assertThat(deps).contains("Design", "Editing", "Post-production, Colour").doesNotContain("Camera");   // only the chosen workspace
        assertThat(o.get("managers").get(0).get("name").asText()).isEqualTo("Lena Lead");
        assertThat(o.get("statuses").size()).isGreaterThan(5);

        JsonNode both = om.readTree(call(get(BASE + "/report/options?workspace=" + workspaceId + "&workspace=" + otherWorkspaceId), ownerToken(), workspaceId, null, 200)
                .getResponse().getContentAsString());
        List<String> deps2 = new ArrayList<>();
        both.get("departments").forEach(d -> deps2.add(d.asText()));
        assertThat(deps2).contains("Camera", "Design");

        // a plain member: only themselves, and no departments of other people
        JsonNode m = om.readTree(call(get(BASE + "/report/options"), token(designerEmail), workspaceId, null, 200).getResponse().getContentAsString());
        assertThat(m.get("people").size()).isEqualTo(1);
        assertThat(m.get("people").get(0).get("email").asText()).isEqualTo(designerEmail);
        assertThat(m.get("departments").toString()).doesNotContain("Editing");
        assertThat(m.get("workspaces").get(0).get("seesEveryone").asBoolean()).isFalse();
    }
}

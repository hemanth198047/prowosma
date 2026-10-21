package com.prowosma.backend.access;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;

import static com.prowosma.backend.access.AccessConstants.*;
import static org.junit.jupiter.api.Assertions.*;

/** Pure rule tests — no Spring, no database. Names mirror the roles in a typical production company. */
class AccessScopeTest {

    private static final Set<String> CREATIVE = Set.of("dept-creative");
    private static final Set<String> POST = Set.of("dept-post");
    private static final Set<String> SALES = Set.of("dept-sales");

    private static AccessScope deptMember(String email, String id, Set<String> depts) {
        return AccessScope.of(email, id, MODE_DEPARTMENTS, depts, false, Set.of(CAP_CREATE_TASK), "Department Member");
    }
    private static AccessScope deptAdmin(String email, String id, Set<String> depts) {
        return AccessScope.of(email, id, MODE_DEPARTMENTS, depts, true,
                Set.of(CAP_CREATE_PROJECT, CAP_CREATE_TASK, CAP_ALLOCATE_TASKS), "Department Admin");
    }
    private static AccessScope assignedOnly(String email, String id) {
        return AccessScope.of(email, id, MODE_ASSIGNED, Set.of("dept-post"), false, Set.of(), "Assigned Work Only");
    }
    private static ProjectFacts project(String vis, Set<String> depts, List<String> involved, String creator) {
        return ProjectFacts.of("p1", vis, depts, involved, creator);
    }

    @Test void unrestrictedSeesAndManagesEverything() {
        AccessScope s = AccessScope.unrestricted();
        ProjectFacts p = project(VIS_MEMBERS, Set.of(), List.of(), "x@x.com");
        assertFalse(s.isRestricted());
        assertTrue(s.canSeeProject(p, false));
        assertTrue(s.canManageProject(p));
        assertTrue(s.canSeeTask(TaskFacts.of("p1", null, null, "x@x.com"), p));
        assertTrue(s.has(CAP_VIEW_FINANCIALS));
    }

    @Test void modeAllProfileIsUnrestricted() {
        AccessScope s = AccessScope.of("a@x.com", "m1", MODE_ALL, Set.of(), false, Set.of(), "Everything");
        assertFalse(s.isRestricted());
        assertTrue(s.canSeeProject(project(VIS_MEMBERS, Set.of(), List.of(), "z@x.com"), false));
    }

    @Test void departmentProjectIsVisibleOnlyToThatDepartment() {
        ProjectFacts p = project(VIS_DEPARTMENTS, CREATIVE, List.of(), "ansad@x.com");
        assertTrue(deptMember("kashyap@x.com", "m2", CREATIVE).canSeeProject(p, false));
        assertFalse(deptMember("suman@x.com", "m3", SALES).canSeeProject(p, false));
        assertFalse(assignedOnly("hafeez@x.com", "m4").canSeeProject(p, false));
    }

    @Test void namedPeopleSeeAProjectOutsideTheirDepartment() {
        ProjectFacts p = project(VIS_DEPARTMENTS, CREATIVE, List.of("Deepak@X.com"), "ansad@x.com");
        AccessScope deepak = deptAdmin("deepak@x.com", "m5", SALES);
        assertTrue(deepak.canSeeProject(p, false));          // named, case-insensitively
        assertFalse(deepak.canManageProject(p));             // named is not the same as managing it
        assertTrue(deepak.canEditProject(p));
    }

    @Test void membersOnlyProjectIsHiddenFromItsOwnDepartment() {
        ProjectFacts p = project(VIS_MEMBERS, CREATIVE, List.of("kashyap@x.com"), "ansad@x.com");
        assertTrue(deptMember("kashyap@x.com", "m2", CREATIVE).canSeeProject(p, false));
        assertFalse(deptMember("other@x.com", "m6", CREATIVE).canSeeProject(p, false));
    }

    @Test void workspaceProjectIsVisibleToDepartmentScopeButNotAssignedOnly() {
        ProjectFacts p = project(VIS_WORKSPACE, Set.of(), List.of(), "k@x.com");
        assertTrue(deptMember("a@x.com", "m1", SALES).canSeeProject(p, false));
        assertFalse(assignedOnly("e@x.com", "m7").canSeeProject(p, false));
    }

    @Test void assignedWorkMakesItsProjectVisibleButNotSiblingTasks() {
        ProjectFacts p = project(VIS_MEMBERS, CREATIVE, List.of(), "ansad@x.com");
        AccessScope editor = assignedOnly("hafeez@x.com", "m4");
        TaskFacts mine = TaskFacts.of("p1", List.of("m4"), null, "ansad@x.com");
        TaskFacts other = TaskFacts.of("p1", List.of("m9"), null, "ansad@x.com");
        assertTrue(editor.canSeeProject(p, true));
        assertTrue(editor.canSeeTask(mine, p));
        assertFalse(editor.canSeeTask(other, p));
    }

    @Test void watcherAndCreatorLinksCount() {
        AccessScope editor = assignedOnly("hafeez@x.com", "m4");
        assertTrue(editor.canSeeTask(TaskFacts.of(null, null, List.of("HAFEEZ@x.com"), "z@x.com"), null));
        assertTrue(editor.canSeeTask(TaskFacts.of(null, null, null, "hafeez@x.com"), null));
        assertFalse(editor.canSeeTask(TaskFacts.of(null, null, null, "z@x.com"), null));
    }

    @Test void taskWithoutProjectIsHiddenUnlessPersonallyLinked() {
        AccessScope member = deptMember("a@x.com", "m1", SALES);
        assertFalse(member.canSeeTask(TaskFacts.of(null, List.of("m9"), null, "z@x.com"), null));
        assertTrue(member.canSeeTask(TaskFacts.of(null, List.of("m1"), null, "z@x.com"), null));
    }

    @Test void departmentMemberSeesAllTasksOfAVisibleProject() {
        ProjectFacts p = project(VIS_DEPARTMENTS, CREATIVE, List.of(), "ansad@x.com");
        AccessScope m = deptMember("kashyap@x.com", "m2", CREATIVE);
        assertTrue(m.canSeeTask(TaskFacts.of("p1", List.of("m9"), null, "z@x.com"), p));
    }

    @Test void onlyDepartmentAdminOfOwningDepartmentOrCreatorManages() {
        ProjectFacts p = project(VIS_DEPARTMENTS, CREATIVE, List.of(), "creator@x.com");
        assertTrue(deptAdmin("ansad@x.com", "m8", CREATIVE).canManageProject(p));
        assertFalse(deptAdmin("deepak@x.com", "m5", SALES).canManageProject(p));
        assertFalse(deptMember("kashyap@x.com", "m2", CREATIVE).canManageProject(p));
        assertTrue(deptMember("creator@x.com", "m10", CREATIVE).canManageProject(p));
    }

    @Test void departmentAdminFlagIsIgnoredOutsideDepartmentMode() {
        AccessScope s = AccessScope.of("a@x.com", "m1", MODE_ASSIGNED, CREATIVE, true, Set.of(), "weird");
        assertFalse(s.isDepartmentAdmin());
    }

    @Test void restrictedCallersCannotShareWorkspaceWideAndOnlyAttachOwnDepartments() {
        AccessScope m = deptAdmin("ansad@x.com", "m8", CREATIVE);
        assertFalse(m.mayUseVisibility(VIS_WORKSPACE));
        assertTrue(m.mayUseVisibility(VIS_DEPARTMENTS));
        assertEquals(CREATIVE, m.attachableDepartments(Set.of("dept-creative", "dept-sales")));
        assertTrue(AccessScope.unrestricted().mayUseVisibility(VIS_WORKSPACE));
    }

    @Test void unknownVisibilityAndUnknownModeFailClosed() {
        ProjectFacts weird = ProjectFacts.of("p", "SOMETHING_ELSE", CREATIVE, List.of(), "z@x.com");
        assertEquals(VIS_MEMBERS, weird.visibility());
        assertFalse(deptMember("kashyap@x.com", "m2", CREATIVE).canSeeProject(weird, false));
        AccessScope unknownMode = AccessScope.of("a@x.com", "m1", "NOPE", CREATIVE, true, Set.of(CAP_CREATE_TASK), "x");
        assertEquals(MODE_ASSIGNED, unknownMode.mode());
        assertTrue(unknownMode.isRestricted());
    }

    @Test void nullAndBlankVisibilityMeansLegacyWorkspace() {
        assertEquals(VIS_WORKSPACE, normalizeVisibility(null));
        assertEquals(VIS_WORKSPACE, normalizeVisibility("  "));
        assertNull(normalizeVisibility("nonsense"));
        assertEquals(VIS_DEPARTMENTS, normalizeVisibility("departments"));
    }

    @Test void capabilitiesAreOnlyCheckedForRestrictedCallers() {
        AccessScope editor = assignedOnly("e@x.com", "m7");
        assertFalse(editor.has(CAP_CREATE_TASK));
        assertTrue(AccessScope.unrestricted().has(CAP_CREATE_TASK));
        assertTrue(deptAdmin("a@x.com", "m1", SALES).has(CAP_ALLOCATE_TASKS));
    }

    @Test void gateIsDefaultDenyForRestrictedCallers() {
        AccessScope editor = assignedOnly("e@x.com", "m7");
        assertTrue(AccessGatePolicy.isAllowed("/api/tasks", "GET", editor));
        assertTrue(AccessGatePolicy.isAllowed("/api/tasks/abc/comments", "POST", editor));
        assertTrue(AccessGatePolicy.isAllowed("/api/projects/abc", "GET", editor));
        assertTrue(AccessGatePolicy.isAllowed("/api/team", "GET", editor));
        assertTrue(AccessGatePolicy.isAllowed("/api/access/me", "GET", editor));
        assertTrue(AccessGatePolicy.isAllowed("/api/access/options", "GET", editor));
        assertFalse(AccessGatePolicy.isAllowed("/api/admin/access/settings", "GET", editor));
        assertFalse(AccessGatePolicy.isAllowed("/api/admin/access/org-setup", "POST", editor));
        assertFalse(AccessGatePolicy.isAllowed("/api/team", "POST", editor));
        assertTrue(AccessGatePolicy.isAllowed("/api/workspaces", "GET", editor));
        assertFalse(AccessGatePolicy.isAllowed("/api/workspaces/w1/members", "GET", editor));
        for (String p : List.of("/api/dashboard/summary", "/api/search/global", "/api/reports/x", "/api/analytics",
                "/api/activity-logs", "/api/notifications", "/api/gantt", "/api/docs", "/api/meeting-assistant/sessions",
                "/api/ai/chat", "/api/goals", "/api/kpis", "/api/user-groups", "/api/import", "/api/time/x", "/api/tasksX")) {
            assertFalse(AccessGatePolicy.isAllowed(p, "GET", editor), p);
        }
    }

    @Test void gateRefusesAmbiguousPathsAndFinancialsWithoutCapability() {
        AccessScope editor = assignedOnly("e@x.com", "m7");
        assertFalse(AccessGatePolicy.isAllowed("/api/tasks/../dashboard/summary", "GET", editor));
        assertFalse(AccessGatePolicy.isAllowed("/api/tasks;x/1", "GET", editor));
        assertFalse(AccessGatePolicy.isAllowed("/api/tasks//1", "GET", editor));
        assertFalse(AccessGatePolicy.isAllowed("/api/tasks/%2e%2e/dashboard", "GET", editor));
        assertFalse(AccessGatePolicy.isAllowed("/api/projects/p1/expenses", "POST", editor));
        assertFalse(AccessGatePolicy.isAllowed("/api/projects/p1/roi", "GET", editor));
        assertFalse(AccessGatePolicy.isAllowed("/api/projects/roi/portfolio", "GET", editor));
        AccessScope finance = AccessScope.of("f@x.com", "m11", MODE_DEPARTMENTS, SALES, false, Set.of(CAP_VIEW_FINANCIALS), "Finance");
        assertTrue(AccessGatePolicy.isAllowed("/api/projects/p1/roi", "GET", finance));
    }

    @Test void gateNeverAffectsUnrestrictedCallersOrNonApiPaths() {
        assertTrue(AccessGatePolicy.isAllowed("/api/dashboard/summary", "GET", AccessScope.unrestricted()));
        assertTrue(AccessGatePolicy.isAllowed("/ws/info", "GET", assignedOnly("e@x.com", "m7")));
    }
}

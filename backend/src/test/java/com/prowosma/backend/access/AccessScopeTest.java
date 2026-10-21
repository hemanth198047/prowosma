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
        for (String p : List.of("/api/dashboard/sprints", "/api/dashboard/meeting-pulse",
                "/api/meeting-assistant/sessions", "/api/kpis", "/api/user-groups", "/api/import", "/api/import-export", "/api/tasksX",
                "/api/push/subscribe", "/api/meetings", "/api/meeting-action-items", "/api/roi", "/api/scenarios", "/api/automations",
                "/api/integrations", "/api/bpm", "/api/deployments", "/api/expertise", "/api/api-keys", "/api/webhooks", "/api/billing",
                "/api/security/sessions/all", "/api/admin/access/settings", "/api/reminders/send-now", "/api/dlp", "/api/risk",
                "/api/searchX", "/api/ganttX", "/api/time/invoices", "/api/time/invoices/generate", "/api/workspaces/w1/stats",
                "/api/workspace/roles", "/api/goalsX", "/api/aiX", "/api/reportsX", "/api/analyticsX")) {
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

    private static AccessScope withMeetingCap() {
        return AccessScope.of("k@x.com", "m2", MODE_DEPARTMENTS, CREATIVE, false, Set.of(CAP_CREATE_TASK, CAP_USE_MEETING_ASSISTANT), "Department Member");
    }

    @Test void phaseTwoAreasAreOpenToRestrictedCallers() {
        AccessScope editor = assignedOnly("e@x.com", "m7");
        assertTrue(AccessGatePolicy.isAllowed("/api/dashboard/summary", "GET", editor));
        assertTrue(AccessGatePolicy.isAllowed("/api/notifications", "GET", editor));
        assertTrue(AccessGatePolicy.isAllowed("/api/notifications/inbox", "GET", editor));
        assertTrue(AccessGatePolicy.isAllowed("/api/notifications/n1/read", "PATCH", editor));
        assertTrue(AccessGatePolicy.isAllowed("/api/search", "GET", editor));
        assertTrue(AccessGatePolicy.isAllowed("/api/search/global", "GET", editor));
        assertTrue(AccessGatePolicy.isAllowed("/api/gantt", "GET", editor));
        assertTrue(AccessGatePolicy.isAllowed("/api/gantt/conflicts", "GET", editor));
        assertTrue(AccessGatePolicy.isAllowed("/api/gantt/tasks/t1/dates", "PATCH", editor));
        assertTrue(AccessGatePolicy.isAllowed("/api/activity-logs", "GET", editor));
        assertTrue(AccessGatePolicy.isAllowed("/api/activity-logs/entity/task/t1", "GET", editor));
        assertTrue(AccessGatePolicy.isAllowed("/api/docs", "GET", editor));
        assertTrue(AccessGatePolicy.isAllowed("/api/docs/d1/access", "PUT", editor));
        assertTrue(AccessGatePolicy.isAllowed("/api/docs/d1/versions", "GET", editor));
        assertFalse(AccessGatePolicy.isAllowed("/api/docsX", "GET", editor));
    }

    @Test void workspaceWideOperationsInsideThoseAreasStayClosed() {
        AccessScope editor = assignedOnly("e@x.com", "m7");
        assertFalse(AccessGatePolicy.isAllowed("/api/gantt/shift", "POST", editor));
        assertFalse(AccessGatePolicy.isAllowed("/api/gantt", "PATCH", editor));
        assertFalse(AccessGatePolicy.isAllowed("/api/gantt/tasks/t1/dates", "PUT", editor));
        assertFalse(AccessGatePolicy.isAllowed("/api/notifications/announce", "POST", editor));
        assertFalse(AccessGatePolicy.isAllowed("/api/activity-logs/export/csv", "GET", editor));
        assertFalse(AccessGatePolicy.isAllowed("/api/activity-logs/verify-integrity", "GET", editor));
        assertFalse(AccessGatePolicy.isAllowed("/api/activity-logs/summary", "GET", editor));
        assertFalse(AccessGatePolicy.isAllowed("/api/dashboard/summary", "POST", editor));
        assertFalse(AccessGatePolicy.isAllowed("/api/search", "DELETE", editor));
    }

    @Test void meetingAssistantNeedsTheCapabilityAndNeverExposesTheCompanyFirefliesAccount() {
        AccessScope without = deptMember("k@x.com", "m2", CREATIVE);
        AccessScope with = withMeetingCap();
        assertFalse(AccessGatePolicy.isAllowed("/api/meeting-assistant/sessions", "GET", without));
        assertTrue(AccessGatePolicy.isAllowed("/api/meeting-assistant/sessions", "GET", with));
        assertTrue(AccessGatePolicy.isAllowed("/api/meeting-assistant/fireflies/notetaker", "POST", with));
        assertTrue(AccessGatePolicy.isAllowed("/api/meeting-assistant/sessions/s1/create", "POST", with));
        assertFalse(AccessGatePolicy.isAllowed("/api/meeting-assistant/fireflies/recent", "GET", with));
        assertFalse(AccessGatePolicy.isAllowed("/api/meeting-assistant/fireflies/import", "POST", with));
        assertFalse(AccessGatePolicy.isAllowed("/api/admin/meeting-assistant/settings", "GET", with));
        assertFalse(AccessGatePolicy.isAllowed("/api/meeting-assistantX", "GET", with));
        assertTrue(AccessGatePolicy.isAllowed("/api/meeting-assistant/fireflies/recent", "GET", AccessScope.unrestricted()));
    }

    // ── documents ───────────────────────────────────────────────────────────────

    private static DocFacts doc(String audience, Set<String> depts, List<String> shared, String creator) {
        return DocFacts.of(creator, audience, depts, shared);
    }
    private static AccessScope kashyap(String docMode) { return deptMember("kashyap@x.com", "m2", CREATIVE).withDocMode(docMode); }
    private static AccessScope suman(String docMode) { return deptMember("suman@x.com", "m3", SALES).withDocMode(docMode); }

    @Test void creatorAlwaysSeesAndManagesTheirDoc() {
        DocFacts d = doc(AUD_PRIVATE, Set.of(), List.of(), "Kashyap@X.com");
        for (String mode : ALL_DOC_MODES) {
            assertTrue(kashyap(mode).canSeeDoc(d));
            assertTrue(kashyap(mode).canManageDoc(d));
            assertTrue(kashyap(mode).canEditDoc(d));
        }
    }

    @Test void departmentDocIsVisibleToItsDepartmentWhenDepartmentsAreOn() {
        DocFacts d = doc(AUD_DEPARTMENTS, CREATIVE, List.of(), "ansad@x.com");
        assertTrue(kashyap(DOC_MODE_DEPARTMENTS).canSeeDoc(d));
        assertTrue(kashyap(DOC_MODE_BOTH).canSeeDoc(d));
        assertFalse(kashyap(DOC_MODE_PRIVATE_SHARED).canSeeDoc(d));     // departments switched off by the setting
        assertFalse(suman(DOC_MODE_BOTH).canSeeDoc(d));                 // another department
    }

    @Test void sharingIsHonouredOnlyWhenSharingIsOn() {
        DocFacts d = doc(AUD_PRIVATE, Set.of(), List.of("Suman@x.com"), "kashyap@x.com");
        assertTrue(suman(DOC_MODE_PRIVATE_SHARED).canSeeDoc(d));
        assertTrue(suman(DOC_MODE_BOTH).canSeeDoc(d));
        assertFalse(suman(DOC_MODE_DEPARTMENTS).canSeeDoc(d));          // "departments only": no per-person sharing
        assertFalse(suman(DOC_MODE_BOTH).canManageDoc(d));              // shared is not managing
        assertTrue(suman(DOC_MODE_BOTH).canEditDoc(d));
    }

    @Test void aPrivateDocIsHiddenFromItsOwnDepartment() {
        DocFacts d = doc(AUD_PRIVATE, CREATIVE, List.of(), "ansad@x.com");
        assertFalse(kashyap(DOC_MODE_BOTH).canSeeDoc(d));
    }

    @Test void legacyDocsWithNoAudienceAreHiddenExceptFromCreatorAndSharedPeople() {
        DocFacts legacy = doc(null, Set.of(), List.of(), "ansad@x.com");
        assertFalse(kashyap(DOC_MODE_BOTH).canSeeDoc(legacy));
        assertFalse(AccessScope.of("e@x.com", "m7", MODE_ASSIGNED, POST, false, Set.of(), "x").canSeeDoc(legacy));
        assertTrue(AccessScope.unrestricted().canSeeDoc(legacy));
        assertTrue(kashyap(DOC_MODE_BOTH).canSeeDoc(doc(null, Set.of(), List.of("kashyap@x.com"), "ansad@x.com")));
    }

    @Test void unknownAudienceMatchesNothing() {
        DocFacts weird = doc("EVERYONE", CREATIVE, List.of(), "ansad@x.com");
        assertFalse(kashyap(DOC_MODE_BOTH).canSeeDoc(weird));
    }

    @Test void workspaceWideDocIsSeenByAllButEditedOnlyByItsOwner() {
        DocFacts d = doc(AUD_WORKSPACE, Set.of(), List.of(), "ansad@x.com");
        assertTrue(suman(DOC_MODE_BOTH).canSeeDoc(d));
        assertTrue(assignedOnly("e@x.com", "m7").withDocMode(DOC_MODE_BOTH).canSeeDoc(d));
        assertFalse(suman(DOC_MODE_BOTH).canEditDoc(d));
        assertTrue(deptMember("ansad@x.com", "m8", CREATIVE).canEditDoc(d));
    }

    @Test void departmentAdminManagesTheirDepartmentsDocsOnlyWhenDepartmentsAreOn() {
        DocFacts d = doc(AUD_DEPARTMENTS, CREATIVE, List.of(), "kashyap@x.com");
        AccessScope ansad = deptAdmin("ansad@x.com", "m8", CREATIVE);
        assertTrue(ansad.withDocMode(DOC_MODE_BOTH).canManageDoc(d));
        assertFalse(ansad.withDocMode(DOC_MODE_PRIVATE_SHARED).canManageDoc(d));
        assertFalse(deptAdmin("deepak@x.com", "m5", SALES).withDocMode(DOC_MODE_BOTH).canManageDoc(d));
    }

    @Test void whichAudiencesAPersonMayChoose() {
        assertTrue(kashyap(DOC_MODE_BOTH).mayUseAudience(AUD_DEPARTMENTS));
        assertTrue(kashyap(DOC_MODE_BOTH).mayUseAudience(AUD_PRIVATE));
        assertFalse(kashyap(DOC_MODE_BOTH).mayUseAudience(AUD_WORKSPACE));
        assertFalse(kashyap(DOC_MODE_PRIVATE_SHARED).mayUseAudience(AUD_DEPARTMENTS));
        assertTrue(AccessScope.unrestricted().mayUseAudience(AUD_WORKSPACE));
        assertFalse(kashyap(DOC_MODE_DEPARTMENTS).sharingEnabled());
        assertTrue(kashyap(DOC_MODE_BOTH).sharingEnabled());
    }

    @Test void unrestrictedPeopleSeeEveryDocWhateverTheSetting() {
        DocFacts d = doc(AUD_PRIVATE, Set.of(), List.of(), "x@x.com");
        assertTrue(AccessScope.unrestricted().withDocMode(DOC_MODE_PRIVATE_SHARED).canSeeDoc(d));
        assertTrue(AccessScope.of("a@x.com", "m1", MODE_ALL, Set.of(), false, Set.of(), "All").canSeeDoc(d));
    }

    @Test void docModeFallsBackToBothAndAudienceIsNormalised() {
        assertEquals(DOC_MODE_BOTH, normalizeDocMode(null));
        assertEquals(DOC_MODE_BOTH, normalizeDocMode("nonsense"));
        assertEquals(DOC_MODE_DEPARTMENTS, normalizeDocMode("departments"));
        assertNull(normalizeAudience(null));
        assertEquals("PRIVATE", normalizeAudience("private"));
        assertEquals("?", normalizeAudience("public"));
        assertTrue(isValidAudience("workspace"));
        assertFalse(isValidAudience("public"));
    }

    // ── linked records ──────────────────────────────────────────────────────────

    @Test void aLinkedRecordIsSeenByItsMakerOrThroughAVisibleProject() {
        AccessScope k = kashyap(DOC_MODE_BOTH);
        assertTrue(k.canSeeLinked(java.util.Arrays.asList(null, "KASHYAP@x.com"), false));   // made by them, case-insensitive
        assertTrue(k.canSeeLinked(List.of("someone@x.com"), true));                          // belongs to a project they can see
        assertFalse(k.canSeeLinked(List.of("someone@x.com"), false));                        // neither
        assertFalse(k.canSeeLinked(java.util.Arrays.asList((String) null), false));
        assertFalse(k.canSeeLinked(null, false));
        assertTrue(AccessScope.unrestricted().canSeeLinked(List.of(), false));
    }

    @Test void planningIsACapabilityNotAGivenForAnyRestrictedProfile() {
        assertFalse(kashyap(DOC_MODE_BOTH).has(CAP_MANAGE_PLANNING));
        AccessScope planner = AccessScope.of("a@x.com", "m1", MODE_DEPARTMENTS, CREATIVE, false, Set.of(CAP_MANAGE_PLANNING), "Planner");
        assertTrue(planner.has(CAP_MANAGE_PLANNING));
        assertTrue(ALL_CAPABILITIES.contains(CAP_MANAGE_PLANNING));
    }

    @Test void planningAndReportingAreasAreOpenForReadingToRestrictedCallers() {
        AccessScope editor = assignedOnly("e@x.com", "m7");
        for (String p : List.of("/api/goals", "/api/goals/g1", "/api/sprints", "/api/sprints/s1/tasks", "/api/epics", "/api/releases",
                "/api/raid", "/api/changes", "/api/decisions", "/api/channels", "/api/channels/c1/messages", "/api/initiatives",
                "/api/programmes", "/api/standup", "/api/sops", "/api/reports/summary", "/api/analytics", "/api/ai/intelligence/risks",
                "/api/ai/chat", "/api/time/report")) {
            assertTrue(AccessGatePolicy.isAllowed(p, "GET", editor), p);
        }
    }

    @Test void changingPlanningRecordsNeedsThePlanningCapability() {
        AccessScope without = assignedOnly("e@x.com", "m7");
        AccessScope planner = AccessScope.of("a@x.com", "m1", MODE_DEPARTMENTS, CREATIVE, true,
                Set.of(CAP_MANAGE_PLANNING), "Planner");
        for (String p : List.of("/api/goals", "/api/sprints/s1", "/api/epics/e1", "/api/releases", "/api/raid", "/api/changes/c1",
                "/api/decisions", "/api/initiatives", "/api/programmes/p1/milestones", "/api/sops/s1/publish")) {
            assertFalse(AccessGatePolicy.isAllowed(p, "POST", without), p);
            assertFalse(AccessGatePolicy.isAllowed(p, "DELETE", without), p);
            assertTrue(AccessGatePolicy.isAllowed(p, "POST", planner), p);
        }
        // chat, stand-up entries and AI helpers are not planning records
        assertTrue(AccessGatePolicy.isAllowed("/api/channels/c1/messages", "POST", without));
        assertTrue(AccessGatePolicy.isAllowed("/api/standup", "POST", without));
        assertTrue(AccessGatePolicy.isAllowed("/api/ai/chat", "POST", without));
    }
}

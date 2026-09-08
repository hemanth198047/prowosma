package com.prowosma.backend.meetings;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.ProwosmaTestBase;
import com.prowosma.backend.model.*;
import com.prowosma.backend.repository.*;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Meeting Continuity / Daily Project Pulse — carry-forward correctness,
 * previous-meeting chaining, and what's-changed diffing.
 *
 * T1  First meeting in a workspace has no previousMeetingId
 * T2  Second meeting links previousMeetingId to the first
 * T3  A backfilled (earlier-dated) meeting links to its chronological
 *     predecessor, not creation order
 * T4  Carry-forward includes OPEN/IN_PROGRESS action items, excludes
 *     COMPLETED/DISMISSED
 * T5  A DEFERRED item with a future date is excluded from carry-forward;
 *     one with a past (or no) deferredUntil is included
 * T6  Repeated carry-forward count is derived from meetingIds, not a
 *     separate counter
 * T7  Carrying an existing action item into a new meeting appends the
 *     meeting id without duplicating and attaches the reference to that
 *     meeting's project discussion
 * T8  Completing an action item removes it from carry-forward in a
 *     subsequently opened meeting
 * T9  What's-changed reports hasPrevious=false when there's no prior
 *     meeting
 * T10 What's-changed reports an item completed after the previous
 *     meeting's date
 * T11 Meeting summary reports new action items sourced in that meeting
 *     and a correct carry-forward-to-next count
 * T12 A blocker (RaidEntry) created via a meeting gets sourceMeetingId
 *     set and appears in carry-forward while OPEN; disappears once
 *     resolved
 * T13 A decision created via a meeting appears in pending decisions
 *     while OPEN; disappears once no longer OPEN
 * T14 Carry-forward is workspace-scoped — another workspace's open items
 *     never leak in
 * T15 GET /meetings/prepare works without any meeting existing yet
 * T16 GET /meetings/{id}/continuity scopes results to that meeting's
 *     already-selected projects only
 */
@DisplayName("Meeting Continuity — carry-forward, chaining, and what's-changed")
class MeetingContinuityTest extends ProwosmaTestBase {

    @Autowired private MeetingRepository meetingRepository;
    @Autowired private MeetingActionItemRepository actionItemRepository;
    @Autowired private RaidRepository raidRepository;
    @Autowired private DecisionRepository decisionRepository;
    @Autowired private ProjectRepository projectRepository;
    @Autowired private ObjectMapper objectMapper;

    private String createProject(String name) {
        Project p = new Project();
        p.setName(name);
        p.setOrganizationId(workspaceId);
        return projectRepository.save(p).getId();
    }

    private String createMeeting(String title, LocalDateTime date) throws Exception {
        Meeting m = new Meeting();
        m.setTitle(title);
        m.setMeetingDate(date);
        String resp = mvc.perform(post("/api/meetings")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(m)))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(resp).get("id").asText();
    }

    private MeetingActionItem saveActionItem(String meetingId, String status, LocalDateTime dueDate,
                                              LocalDateTime deferredUntil, List<String> meetingIds) {
        MeetingActionItem item = new MeetingActionItem();
        item.setOrganizationId(workspaceId);
        item.setTitle("Test action");
        item.setStatus(status);
        item.setDueDate(dueDate);
        item.setDeferredUntil(deferredUntil);
        item.setSourceMeetingId(meetingId);
        item.setMeetingIds(meetingIds);
        return actionItemRepository.save(item);
    }

    // ── Previous-meeting chaining ────────────────────────────────────

    @Test
    @DisplayName("T1: First meeting has no previousMeetingId")
    void firstMeeting_hasNoPrevious() throws Exception {
        String id = createMeeting("Monday Morning Standup", LocalDateTime.now());
        Meeting saved = meetingRepository.findById(id).orElseThrow();
        assertThat(saved.getPreviousMeetingId()).isNull();
    }

    @Test
    @DisplayName("T2: Second meeting links previousMeetingId to the first")
    void secondMeeting_linksToFirst() throws Exception {
        String first  = createMeeting("Monday Morning Standup", LocalDateTime.now().minusHours(8));
        String second = createMeeting("Monday Evening Sync", LocalDateTime.now());

        Meeting saved = meetingRepository.findById(second).orElseThrow();
        assertThat(saved.getPreviousMeetingId()).isEqualTo(first);
    }

    @Test
    @DisplayName("T3: Backfilled meeting links by date, not creation order")
    void outOfOrderMeeting_linksByDateNotCreationOrder() throws Exception {
        String first = createMeeting("Day 1", LocalDateTime.now().minusDays(2));
        createMeeting("Day 3", LocalDateTime.now()); // created before the backfill below

        // Backfilled meeting dated *between* Day 1 and Day 3, but created last
        String second = createMeeting("Day 2 (backfilled)", LocalDateTime.now().minusDays(1));

        Meeting savedSecond = meetingRepository.findById(second).orElseThrow();
        assertThat(savedSecond.getPreviousMeetingId()).isEqualTo(first);
    }

    // ── Carry-forward correctness ─────────────────────────────────────

    @Test
    @DisplayName("T4: Carry-forward includes open items, excludes completed/dismissed")
    void carryForward_excludesCompletedAndDismissed() throws Exception {
        String meetingId = createMeeting("Standup", LocalDateTime.now());
        MeetingActionItem open      = saveActionItem(meetingId, "OPEN", null, null, List.of(meetingId));
        MeetingActionItem completed = saveActionItem(meetingId, "COMPLETED", null, null, List.of(meetingId));
        MeetingActionItem dismissed = saveActionItem(meetingId, "DISMISSED", null, null, List.of(meetingId));

        String resp = mvc.perform(get("/api/meetings/prepare")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();

        JsonNode ids = objectMapper.readTree(resp).get("actionItems");
        List<String> returnedIds = objectMapper.convertValue(ids, List.class).stream()
                .map(m -> ((java.util.Map<?, ?>) m).get("id").toString()).toList();

        assertThat(returnedIds).contains(open.getId());
        assertThat(returnedIds).doesNotContain(completed.getId(), dismissed.getId());
    }

    @Test
    @DisplayName("T5: Future-deferred item excluded; past/no-date deferred item included")
    void carryForward_respectsDeferredUntil() throws Exception {
        String meetingId = createMeeting("Standup", LocalDateTime.now());
        MeetingActionItem futureDeferred = saveActionItem(meetingId, "DEFERRED",
                null, LocalDateTime.now().plusDays(3), List.of(meetingId));
        MeetingActionItem dueDeferred = saveActionItem(meetingId, "DEFERRED",
                null, LocalDateTime.now().minusHours(1), List.of(meetingId));

        String resp = mvc.perform(get("/api/meetings/prepare")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
            .andReturn().getResponse().getContentAsString();

        JsonNode ids = objectMapper.readTree(resp).get("actionItems");
        List<String> returnedIds = objectMapper.convertValue(ids, List.class).stream()
                .map(m -> ((java.util.Map<?, ?>) m).get("id").toString()).toList();

        assertThat(returnedIds).doesNotContain(futureDeferred.getId());
        assertThat(returnedIds).contains(dueDeferred.getId());
    }

    @Test
    @DisplayName("T6: Repeated carry-forward count derives from meetingIds")
    void repeatedCarryForward_derivedFromMeetingIds() throws Exception {
        String m1 = createMeeting("Meeting 1", LocalDateTime.now().minusDays(3));
        String m2 = createMeeting("Meeting 2", LocalDateTime.now().minusDays(2));
        String m3 = createMeeting("Meeting 3", LocalDateTime.now().minusDays(1));
        String m4 = createMeeting("Meeting 4", LocalDateTime.now());

        // Carried into 4 meetings total → carry-forward count = 3
        MeetingActionItem item = saveActionItem(m1, "OPEN", null, null, List.of(m1, m2, m3, m4));

        String resp = mvc.perform(get("/api/meetings/prepare")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
            .andReturn().getResponse().getContentAsString();

        JsonNode counts = objectMapper.readTree(resp).get("counts");
        assertThat(counts.get("repeatedCarryForward").asInt()).isGreaterThanOrEqualTo(1);

        MeetingActionItem reloaded = actionItemRepository.findById(item.getId()).orElseThrow();
        assertThat(reloaded.getMeetingIds()).hasSize(4);
    }

    // ── Carrying items into a new meeting via the live endpoint ───────

    @Test
    @DisplayName("T7: Carrying an existing action item into a meeting appends it once, not duplicated")
    void carryActionItem_appendsMeetingIdOnce() throws Exception {
        String projectId = createProject("Project Alpha");
        String firstMeeting  = createMeeting("Monday Morning", LocalDateTime.now().minusHours(8));
        String secondMeeting = createMeeting("Monday Evening", LocalDateTime.now());

        MeetingActionItem item = saveActionItem(firstMeeting, "OPEN", null, null, List.of(firstMeeting));

        mvc.perform(post("/api/meetings/{id}/projects/{pid}/action-items/{aid}/carry",
                    secondMeeting, projectId, item.getId())
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
            .andExpect(status().isOk());

        MeetingActionItem reloaded = actionItemRepository.findById(item.getId()).orElseThrow();
        assertThat(reloaded.getMeetingIds()).containsExactly(firstMeeting, secondMeeting);

        Meeting meeting = meetingRepository.findById(secondMeeting).orElseThrow();
        assertThat(meeting.getProjectDiscussions()).anySatisfy(pd -> {
            assertThat(pd.getProjectId()).isEqualTo(projectId);
            assertThat(pd.getActionItemIds()).contains(item.getId());
        });

        // Carrying it in again should not duplicate the meeting id
        mvc.perform(post("/api/meetings/{id}/projects/{pid}/action-items/{aid}/carry",
                    secondMeeting, projectId, item.getId())
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
            .andExpect(status().isOk());
        MeetingActionItem reloadedAgain = actionItemRepository.findById(item.getId()).orElseThrow();
        assertThat(reloadedAgain.getMeetingIds()).containsExactly(firstMeeting, secondMeeting);
    }

    @Test
    @DisplayName("T8: Completing an item removes it from carry-forward")
    void completingItem_removesFromCarryForward() throws Exception {
        String meetingId = createMeeting("Standup", LocalDateTime.now());
        MeetingActionItem item = saveActionItem(meetingId, "OPEN", null, null, List.of(meetingId));

        mvc.perform(post("/api/meeting-action-items/{id}/complete", item.getId())
                .param("meetingId", meetingId)
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
            .andExpect(status().isOk());

        MeetingActionItem reloaded = actionItemRepository.findById(item.getId()).orElseThrow();
        assertThat(reloaded.getStatus()).isEqualTo("COMPLETED");
        assertThat(reloaded.getCompletedAt()).isNotNull();

        String resp = mvc.perform(get("/api/meetings/prepare")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
            .andReturn().getResponse().getContentAsString();
        JsonNode ids = objectMapper.readTree(resp).get("actionItems");
        List<String> returnedIds = objectMapper.convertValue(ids, List.class).stream()
                .map(m -> ((java.util.Map<?, ?>) m).get("id").toString()).toList();
        assertThat(returnedIds).doesNotContain(item.getId());
    }

    // ── What's Changed ─────────────────────────────────────────────

    @Test
    @DisplayName("T9: What's-changed reports hasPrevious=false with no prior meeting")
    void whatsChanged_noPrevious() throws Exception {
        String meetingId = createMeeting("Only Meeting", LocalDateTime.now());

        String resp = mvc.perform(get("/api/meetings/{id}/whats-changed", meetingId)
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();

        assertThat(objectMapper.readTree(resp).get("hasPrevious").asBoolean()).isFalse();
    }

    @Test
    @DisplayName("T10: What's-changed reports an item completed after the previous meeting")
    void whatsChanged_reportsCompletedItem() throws Exception {
        String first  = createMeeting("Monday Morning", LocalDateTime.now().minusHours(8));
        String second = createMeeting("Monday Evening", LocalDateTime.now());

        MeetingActionItem item = saveActionItem(first, "COMPLETED", null, null, List.of(first));
        item.setCompletedAt(LocalDateTime.now().minusHours(2)); // after "first", before "second"
        actionItemRepository.save(item);

        String resp = mvc.perform(get("/api/meetings/{id}/whats-changed", second)
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
            .andReturn().getResponse().getContentAsString();

        JsonNode json = objectMapper.readTree(resp);
        assertThat(json.get("hasPrevious").asBoolean()).isTrue();
        JsonNode completed = json.get("completedActionItems");
        List<String> completedIds = objectMapper.convertValue(completed, List.class).stream()
                .map(m -> ((java.util.Map<?, ?>) m).get("id").toString()).toList();
        assertThat(completedIds).contains(item.getId());
    }

    // ── Meeting summary ────────────────────────────────────────────

    @Test
    @DisplayName("T11: Meeting summary reports new action items and carry-forward-to-next count")
    void meetingSummary_reportsNewItemsAndCarryForwardCount() throws Exception {
        String projectId = createProject("Project Beta");
        String meetingId = createMeeting("Standup", LocalDateTime.now());

        String resp = mvc.perform(post("/api/meetings/{id}/projects/{pid}/action-items", meetingId, projectId)
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Follow up with infra\",\"owner\":\"" + memberEmail + "\"}"))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();
        String newItemId = objectMapper.readTree(resp).get("id").asText();

        String summaryResp = mvc.perform(get("/api/meetings/{id}/summary", meetingId)
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();

        JsonNode summary = objectMapper.readTree(summaryResp);
        List<String> newIds = objectMapper.convertValue(summary.get("newActionItems"), List.class).stream()
                .map(m -> ((java.util.Map<?, ?>) m).get("id").toString()).toList();
        assertThat(newIds).contains(newItemId);
        assertThat(summary.get("carryForwardToNext").asInt()).isGreaterThanOrEqualTo(1);
    }

    // ── Blockers & decisions via the meeting endpoints ────────────────

    @Test
    @DisplayName("T12: Blocker created via a meeting is linked and disappears from carry-forward once resolved")
    void blocker_linkedToMeetingAndResolvable() throws Exception {
        String projectId = createProject("Project Gamma");
        String meetingId = createMeeting("Standup", LocalDateTime.now());

        String resp = mvc.perform(post("/api/meetings/{id}/projects/{pid}/blockers", meetingId, projectId)
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Waiting on prod credentials\",\"owner\":\"" + memberEmail + "\"}"))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();
        JsonNode created = objectMapper.readTree(resp);
        String raidId = created.get("id").asText();
        assertThat(created.get("sourceMeetingId").asText()).isEqualTo(meetingId);

        String prepResp = mvc.perform(get("/api/meetings/prepare")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
            .andReturn().getResponse().getContentAsString();
        List<String> blockerIds = objectMapper.convertValue(objectMapper.readTree(prepResp).get("blockers"), List.class)
                .stream().map(m -> ((java.util.Map<?, ?>) m).get("id").toString()).toList();
        assertThat(blockerIds).contains(raidId);

        // Resolve it directly (as the existing RAID board would)
        RaidEntry entry = raidRepository.findById(raidId).orElseThrow();
        entry.setStatus("CLOSED");
        raidRepository.save(entry);

        String prepResp2 = mvc.perform(get("/api/meetings/prepare")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
            .andReturn().getResponse().getContentAsString();
        List<String> blockerIds2 = objectMapper.convertValue(objectMapper.readTree(prepResp2).get("blockers"), List.class)
                .stream().map(m -> ((java.util.Map<?, ?>) m).get("id").toString()).toList();
        assertThat(blockerIds2).doesNotContain(raidId);
    }

    @Test
    @DisplayName("T13: Decision created via a meeting appears while OPEN, disappears once decided")
    void decision_pendingWhileOpen() throws Exception {
        String projectId = createProject("Project Delta");
        String meetingId = createMeeting("Standup", LocalDateTime.now());

        String resp = mvc.perform(post("/api/meetings/{id}/projects/{pid}/decisions", meetingId, projectId)
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Should we delay the release?\"}"))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();
        String decisionId = objectMapper.readTree(resp).get("id").asText();

        String prepResp = mvc.perform(get("/api/meetings/prepare")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
            .andReturn().getResponse().getContentAsString();
        List<String> decisionIds = objectMapper.convertValue(objectMapper.readTree(prepResp).get("decisions"), List.class)
                .stream().map(m -> ((java.util.Map<?, ?>) m).get("id").toString()).toList();
        assertThat(decisionIds).contains(decisionId);

        // Decide it via the existing Decisions endpoint
        mvc.perform(put("/api/decisions/{id}", decisionId)
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"DECIDED\"}"))
            .andExpect(status().isOk());

        String prepResp2 = mvc.perform(get("/api/meetings/prepare")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
            .andReturn().getResponse().getContentAsString();
        List<String> decisionIds2 = objectMapper.convertValue(objectMapper.readTree(prepResp2).get("decisions"), List.class)
                .stream().map(m -> ((java.util.Map<?, ?>) m).get("id").toString()).toList();
        assertThat(decisionIds2).doesNotContain(decisionId);
    }

    // ── Isolation & bootstrap ──────────────────────────────────────

    @Test
    @DisplayName("T14: Carry-forward is workspace-scoped")
    void carryForward_scopedToWorkspace() throws Exception {
        MeetingActionItem otherWorkspaceItem = new MeetingActionItem();
        otherWorkspaceItem.setOrganizationId("other-workspace-id");
        otherWorkspaceItem.setTitle("Belongs to a different tenant");
        otherWorkspaceItem.setStatus("OPEN");
        actionItemRepository.save(otherWorkspaceItem);

        String resp = mvc.perform(get("/api/meetings/prepare")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
            .andReturn().getResponse().getContentAsString();

        List<String> ids = objectMapper.convertValue(objectMapper.readTree(resp).get("actionItems"), List.class)
                .stream().map(m -> ((java.util.Map<?, ?>) m).get("id").toString()).toList();
        assertThat(ids).doesNotContain(otherWorkspaceItem.getId());
    }

    @Test
    @DisplayName("T15: /meetings/prepare works with no meetings created yet")
    void prepare_worksWithNoMeetings() throws Exception {
        mvc.perform(get("/api/meetings/prepare")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
            .andExpect(status().isOk());
    }

    @Test
    @DisplayName("T16: /meetings/{id}/continuity scopes results to that meeting's selected projects")
    void continuity_scopedToMeetingProjects() throws Exception {
        String projectA = createProject("Project A");
        String projectB = createProject("Project B");
        String meetingId = createMeeting("Standup", LocalDateTime.now());

        // Discuss only Project A in this meeting
        mvc.perform(post("/api/meetings/{id}/projects", meetingId)
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"projectId\":\"" + projectA + "\",\"statusSnapshot\":\"IN_PROGRESS\"}"))
            .andExpect(status().isOk());

        // Open items on both projects
        MeetingActionItem itemA = new MeetingActionItem();
        itemA.setOrganizationId(workspaceId); itemA.setTitle("A item"); itemA.setStatus("OPEN");
        itemA.setProjectIds(List.of(projectA));
        actionItemRepository.save(itemA);

        MeetingActionItem itemB = new MeetingActionItem();
        itemB.setOrganizationId(workspaceId); itemB.setTitle("B item"); itemB.setStatus("OPEN");
        itemB.setProjectIds(List.of(projectB));
        actionItemRepository.save(itemB);

        String resp = mvc.perform(get("/api/meetings/{id}/continuity", meetingId)
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();

        List<String> ids = objectMapper.convertValue(objectMapper.readTree(resp).get("actionItems"), List.class)
                .stream().map(m -> ((java.util.Map<?, ?>) m).get("id").toString()).toList();
        assertThat(ids).contains(itemA.getId());
        assertThat(ids).doesNotContain(itemB.getId());
    }

    // ── Day-to-day trends ────────────────────────────────────────────

    @Test
    @DisplayName("T17: Trends returns exactly the requested number of days, oldest first")
    void trends_returnsRequestedDayCount() throws Exception {
        String resp = mvc.perform(get("/api/meetings/trends").param("days", "7")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();

        JsonNode days = objectMapper.readTree(resp);
        assertThat(days.isArray()).isTrue();
        assertThat(days.size()).isEqualTo(7);
        // Oldest day first, today last
        String firstDate = days.get(0).get("date").asText();
        String lastDate  = days.get(6).get("date").asText();
        assertThat(firstDate.compareTo(lastDate)).isLessThan(0);
    }

    @Test
    @DisplayName("T18: Trends counts an action item as created on its creation day and completed on its completion day")
    void trends_countsCreatedAndCompletedOnCorrectDays() throws Exception {
        MeetingActionItem item = new MeetingActionItem();
        item.setOrganizationId(workspaceId);
        item.setTitle("Trend test item");
        item.setStatus("COMPLETED");
        item.setCreatedAt(LocalDateTime.now().minusDays(3));
        item.setCompletedAt(LocalDateTime.now().minusDays(1));
        actionItemRepository.save(item);

        String resp = mvc.perform(get("/api/meetings/trends").param("days", "7")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
            .andReturn().getResponse().getContentAsString();

        JsonNode days = objectMapper.readTree(resp);
        String createdDay   = LocalDateTime.now().minusDays(3).toLocalDate().toString();
        String completedDay = LocalDateTime.now().minusDays(1).toLocalDate().toString();

        boolean foundCreated = false, foundCompleted = false;
        for (JsonNode d : days) {
            if (d.get("date").asText().equals(createdDay)) {
                assertThat(d.get("actionsCreated").asInt()).isGreaterThanOrEqualTo(1);
                foundCreated = true;
            }
            if (d.get("date").asText().equals(completedDay)) {
                assertThat(d.get("actionsCompleted").asInt()).isGreaterThanOrEqualTo(1);
                foundCompleted = true;
            }
        }
        assertThat(foundCreated).isTrue();
        assertThat(foundCompleted).isTrue();
    }

    @Test
    @DisplayName("T19: Trends reflects an open item in the cumulative open count until its completion day")
    void trends_openBurnupReflectsResolution() throws Exception {
        MeetingActionItem item = new MeetingActionItem();
        item.setOrganizationId(workspaceId);
        item.setTitle("Burnup test item");
        item.setStatus("COMPLETED");
        item.setCreatedAt(LocalDateTime.now().minusDays(5));
        item.setCompletedAt(LocalDateTime.now().minusDays(2));
        actionItemRepository.save(item);

        String resp = mvc.perform(get("/api/meetings/trends").param("days", "7")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
            .andReturn().getResponse().getContentAsString();

        JsonNode days = objectMapper.readTree(resp);
        String dayStillOpen = LocalDateTime.now().minusDays(3).toLocalDate().toString();   // before completion
        String dayResolved  = LocalDateTime.now().minusDays(1).toLocalDate().toString();   // after completion

        int openBeforeCompletion = -1, openAfterCompletion = -1;
        for (JsonNode d : days) {
            if (d.get("date").asText().equals(dayStillOpen)) openBeforeCompletion = d.get("openActionItemsEndOfDay").asInt();
            if (d.get("date").asText().equals(dayResolved))  openAfterCompletion  = d.get("openActionItemsEndOfDay").asInt();
        }
        assertThat(openBeforeCompletion).isGreaterThanOrEqualTo(1);
        assertThat(openAfterCompletion).isLessThan(openBeforeCompletion);
    }
}

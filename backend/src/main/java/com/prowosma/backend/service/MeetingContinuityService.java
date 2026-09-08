package com.prowosma.backend.service;

import com.prowosma.backend.model.Decision;
import com.prowosma.backend.model.Meeting;
import com.prowosma.backend.model.MeetingActionItem;
import com.prowosma.backend.model.RaidEntry;
import com.prowosma.backend.repository.DecisionRepository;
import com.prowosma.backend.repository.MeetingRepository;
import com.prowosma.backend.repository.RaidRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.*;

/**
 * Computes Meeting Continuity views on demand, by querying the live state
 * of MeetingActionItem / RaidEntry / Decision records — never by copying
 * or snapshotting them into a meeting. This is what makes "no duplicate
 * records" and "the system always understands the latest known state"
 * true by construction: an item resolved outside any meeting (e.g. on the
 * RAID board) is reflected automatically the next time a meeting opens.
 */
@Service
@RequiredArgsConstructor
public class MeetingContinuityService {

    private static final List<String> RAID_OPEN_STATUSES = List.of("OPEN", "IN_PROGRESS");
    private static final int REPEATED_CARRY_FORWARD_THRESHOLD = 3;

    private final MeetingRepository meetingRepository;
    private final MeetingActionItemService meetingActionItemService;
    private final RaidRepository raidRepository;
    private final DecisionRepository decisionRepository;
    private final ActivityLogService activityLogService;

    // ── Carry-forward context (used both to "prepare" and to "open" a meeting) ──

    public Map<String, Object> getCarryForward(String orgId, List<String> projectIds) {
        List<String> scopedProjects = (projectIds == null || projectIds.isEmpty()) ? null : projectIds;

        List<MeetingActionItem> actionItems = meetingActionItemService.getCarryForwardCandidates(orgId, scopedProjects);

        List<RaidEntry> raidEntries = scopedProjects == null
                ? raidRepository.findByOrganizationIdAndStatusIn(orgId, RAID_OPEN_STATUSES)
                : raidRepository.findByOrganizationIdAndProjectIdInAndStatusIn(orgId, scopedProjects, RAID_OPEN_STATUSES);
        List<RaidEntry> blockers = raidEntries.stream().filter(r -> "ISSUE".equals(r.getType())).toList();
        List<RaidEntry> risks    = raidEntries.stream().filter(r -> "RISK".equals(r.getType())).toList();
        List<RaidEntry> other    = raidEntries.stream()
                .filter(r -> !"ISSUE".equals(r.getType()) && !"RISK".equals(r.getType())).toList();

        List<Decision> pendingDecisions = scopedProjects == null
                ? decisionRepository.findByOrganizationIdAndStatus(orgId, "OPEN")
                : decisionRepository.findByOrganizationIdAndStatusAndLinkedProjectIdsIn(orgId, "OPEN", scopedProjects);

        List<Map<String, Object>> atRiskProjects = findAtRiskProjectSnapshots(orgId, scopedProjects);

        LocalDateTime now = LocalDateTime.now();
        long overdue = actionItems.stream()
                .filter(i -> i.getDueDate() != null && i.getDueDate().isBefore(now)
                        && !"COMPLETED".equals(i.getStatus()) && !"DISMISSED".equals(i.getStatus()))
                .count();
        long repeated = actionItems.stream()
                .filter(i -> meetingActionItemService.carryForwardCount(i) >= REPEATED_CARRY_FORWARD_THRESHOLD)
                .count();

        Map<String, Object> counts = new LinkedHashMap<>();
        counts.put("openActionItems", actionItems.size());
        counts.put("overdueActionItems", overdue);
        counts.put("activeBlockers", blockers.size());
        counts.put("activeRisks", risks.size());
        counts.put("pendingDecisions", pendingDecisions.size());
        counts.put("repeatedCarryForward", repeated);
        counts.put("atRiskProjects", atRiskProjects.size());

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("actionItems", actionItems);
        result.put("blockers", blockers);
        result.put("risks", risks);
        result.put("otherRaidEntries", other);
        result.put("decisions", pendingDecisions);
        result.put("atRiskProjects", atRiskProjects);
        result.put("counts", counts);
        return result;
    }

    /**
     * For each project of interest, finds the most recent meeting that
     * discussed it and reports its snapshot if that snapshot is AT_RISK or
     * BLOCKED. Uses the indexed "latest meeting per project" lookup rather
     * than scanning full meeting history.
     */
    private List<Map<String, Object>> findAtRiskProjectSnapshots(String orgId, List<String> projectIds) {
        if (projectIds == null || projectIds.isEmpty()) return List.of();

        List<Map<String, Object>> results = new ArrayList<>();
        for (String projectId : projectIds) {
            meetingRepository.findTopByWorkspaceIdAndProjectDiscussions_ProjectIdOrderByMeetingDateDesc(orgId, projectId)
                    .flatMap(m -> m.getProjectDiscussions().stream()
                            .filter(pd -> projectId.equals(pd.getProjectId()))
                            .max(Comparator.comparing(Meeting.ProjectDiscussion::getUpdatedAt)))
                    .filter(pd -> "AT_RISK".equals(pd.getStatusSnapshot()) || "BLOCKED".equals(pd.getStatusSnapshot()))
                    .ifPresent(pd -> {
                        Map<String, Object> snap = new LinkedHashMap<>();
                        snap.put("projectId", projectId);
                        snap.put("statusSnapshot", pd.getStatusSnapshot());
                        snap.put("discussionNotes", pd.getDiscussionNotes());
                        results.add(snap);
                    });
        }
        return results;
    }

    // ── "Since Last Meeting" / What Changed ──────────────────────────

    public Map<String, Object> getWhatsChanged(String meetingId) {
        Meeting meeting = meetingRepository.findById(meetingId)
                .orElseThrow(() -> new IllegalArgumentException("Meeting not found: " + meetingId));

        Map<String, Object> result = new LinkedHashMap<>();
        if (meeting.getPreviousMeetingId() == null) {
            result.put("hasPrevious", false);
            return result;
        }

        Meeting previous = meetingRepository.findById(meeting.getPreviousMeetingId()).orElse(null);
        if (previous == null) {
            result.put("hasPrevious", false);
            return result;
        }

        String orgId = meeting.getWorkspaceId();
        LocalDateTime since = previous.getMeetingDate() != null ? previous.getMeetingDate() : previous.getCreatedAt();
        LocalDateTime until = meeting.getMeetingDate() != null ? meeting.getMeetingDate() : LocalDateTime.now();

        List<MeetingActionItem> allItems = meetingActionItemService.getAll(orgId);
        List<MeetingActionItem> completedSince = allItems.stream()
                .filter(i -> "COMPLETED".equals(i.getStatus()) && i.getCompletedAt() != null
                        && i.getCompletedAt().isAfter(since))
                .toList();
        List<MeetingActionItem> newSince = allItems.stream()
                .filter(i -> i.getCreatedAt() != null && i.getCreatedAt().isAfter(since) && i.getCreatedAt().isBefore(until.plusSeconds(1)))
                .toList();

        List<RaidEntry> allRaid = raidRepository.findByOrganizationId(orgId);
        List<RaidEntry> newBlockersSince = allRaid.stream()
                .filter(r -> r.getCreatedAt() != null && r.getCreatedAt().isAfter(since))
                .toList();
        List<RaidEntry> resolvedBlockersSince = allRaid.stream()
                .filter(r -> ("CLOSED".equals(r.getStatus()) || "MITIGATED".equals(r.getStatus()))
                        && r.getUpdatedAt() != null && r.getUpdatedAt().isAfter(since))
                .toList();

        List<Decision> newDecisionsSince = decisionRepository.findByOrganizationIdOrderByCreatedAtDesc(orgId).stream()
                .filter(d -> d.getCreatedAt() != null && d.getCreatedAt().isAfter(since))
                .toList();

        List<Map<String, Object>> projectStatusChanges = diffProjectStatuses(previous, meeting);

        result.put("hasPrevious", true);
        result.put("previousMeetingId", previous.getId());
        result.put("previousMeetingDate", previous.getMeetingDate());
        result.put("completedActionItems", completedSince);
        result.put("newActionItems", newSince);
        result.put("newBlockers", newBlockersSince);
        result.put("resolvedBlockers", resolvedBlockersSince);
        result.put("newDecisions", newDecisionsSince);
        result.put("projectStatusChanges", projectStatusChanges);
        return result;
    }

    private List<Map<String, Object>> diffProjectStatuses(Meeting previous, Meeting current) {
        // Built with a plain loop rather than Collectors.toMap(...,mergeFn): that
        // overload calls Map.merge() for every element (not just conflicts), and
        // merge() throws NPE on a null value — statusSnapshot is an optional
        // field, so a previous discussion without one would crash this method.
        Map<String, String> previousStatusByProject = new HashMap<>();
        for (Meeting.ProjectDiscussion pd : previous.getProjectDiscussions()) {
            if (pd.getStatusSnapshot() != null) previousStatusByProject.put(pd.getProjectId(), pd.getStatusSnapshot());
        }

        List<Map<String, Object>> changes = new ArrayList<>();
        for (Meeting.ProjectDiscussion pd : current.getProjectDiscussions()) {
            String prevStatus = previousStatusByProject.get(pd.getProjectId());
            if (prevStatus != null && pd.getStatusSnapshot() != null && !prevStatus.equals(pd.getStatusSnapshot())) {
                Map<String, Object> change = new LinkedHashMap<>();
                change.put("projectId", pd.getProjectId());
                change.put("from", prevStatus);
                change.put("to", pd.getStatusSnapshot());
                changes.add(change);
            }
        }
        return changes;
    }

    // ── End-of-meeting summary ────────────────────────────────────────

    public Map<String, Object> getMeetingSummary(String meetingId) {
        Meeting meeting = meetingRepository.findById(meetingId)
                .orElseThrow(() -> new IllegalArgumentException("Meeting not found: " + meetingId));

        List<String> actionItemIds = meeting.getProjectDiscussions().stream()
                .flatMap(pd -> pd.getActionItemIds().stream()).distinct().toList();
        List<String> blockerIds = meeting.getProjectDiscussions().stream()
                .flatMap(pd -> pd.getBlockerIds().stream()).distinct().toList();
        List<String> decisionIds = meeting.getProjectDiscussions().stream()
                .flatMap(pd -> pd.getDecisionIds().stream()).distinct().toList();
        List<String> projectsDiscussed = meeting.getProjectDiscussions().stream()
                .map(Meeting.ProjectDiscussion::getProjectId).distinct().toList();

        List<MeetingActionItem> referencedItems = meetingActionItemService.getByIds(actionItemIds);
        List<MeetingActionItem> completed = referencedItems.stream()
                .filter(i -> "COMPLETED".equals(i.getStatus())).toList();
        List<MeetingActionItem> stillPending = referencedItems.stream()
                .filter(i -> List.of("OPEN", "IN_PROGRESS", "DEFERRED").contains(i.getStatus())).toList();
        List<MeetingActionItem> newActionItems = referencedItems.stream()
                .filter(i -> meetingId.equals(i.getSourceMeetingId())).toList();

        List<RaidEntry> blockers = blockerIds.isEmpty() ? List.of() : raidRepository.findAllById(blockerIds);
        List<Decision> decisions = decisionIds.isEmpty() ? List.of() : decisionRepository.findAllById(decisionIds);

        Map<String, Object> carryForward = getCarryForward(meeting.getWorkspaceId(), projectsDiscussed);

        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("meetingId", meetingId);
        summary.put("projectsDiscussed", projectsDiscussed);
        summary.put("completed", completed);
        summary.put("stillPending", stillPending);
        summary.put("newActionItems", newActionItems);
        summary.put("blockers", blockers);
        summary.put("decisions", decisions);
        summary.put("carryForwardToNext", ((Map<?, ?>) carryForward.get("counts")).get("openActionItems"));
        return summary;
    }

    // ── Meeting-linkage helpers (called when a blocker/decision is added to,
    // or referenced again from, a meeting) ────────────────────────────────

    public RaidEntry linkRaidToMeeting(String raidId, String meetingId, boolean isNewInThisMeeting, String performedBy) {
        RaidEntry entry = raidRepository.findById(raidId)
                .orElseThrow(() -> new IllegalArgumentException("RAID entry not found: " + raidId));
        if (isNewInThisMeeting && entry.getSourceMeetingId() == null) entry.setSourceMeetingId(meetingId);
        entry.setLastMeetingId(meetingId);
        entry.setUpdatedAt(LocalDateTime.now());
        RaidEntry saved = raidRepository.save(entry);
        activityLogService.log(entry.getType() != null && entry.getType().equals("RISK") ? "risk" : "blocker",
                saved.getId(), saved.getTitle(), "MEETING_LINKED", null, meetingId, performedBy);
        return saved;
    }

    public Decision linkDecisionToMeeting(String decisionId, String meetingId, boolean isNewInThisMeeting, String performedBy) {
        Decision decision = decisionRepository.findById(decisionId)
                .orElseThrow(() -> new IllegalArgumentException("Decision not found: " + decisionId));
        if (isNewInThisMeeting && decision.getSourceMeetingId() == null) decision.setSourceMeetingId(meetingId);
        decision.setUpdatedAt(LocalDateTime.now());
        Decision saved = decisionRepository.save(decision);
        activityLogService.log("decision", saved.getId(), saved.getTitle(),
                "MEETING_LINKED", null, meetingId, performedBy);
        return saved;
    }

    // ── Day-to-day trends ──────────────────────────────────────────────
    // Derived entirely from existing timestamps (createdAt/completedAt/
    // updatedAt) on the same records everything else in this service reads
    // — no new storage, no daily snapshots to keep in sync or go stale.

    public List<Map<String, Object>> getTrends(String orgId, int days) {
        int clampedDays = Math.max(1, Math.min(days, 90));
        LocalDateTime todayStart = LocalDateTime.now().toLocalDate().atStartOfDay();
        LocalDateTime rangeStart = todayStart.minusDays(clampedDays - 1L);

        List<MeetingActionItem> allItems = meetingActionItemService.getAll(orgId);
        List<RaidEntry> allRaid = raidRepository.findByOrganizationId(orgId);
        List<Decision> allDecisions = decisionRepository.findByOrganizationIdOrderByCreatedAtDesc(orgId);
        List<Meeting> allMeetings = meetingRepository.findByWorkspaceIdOrderByMeetingDateDesc(orgId);

        List<Map<String, Object>> series = new ArrayList<>();
        for (int i = 0; i < clampedDays; i++) {
            LocalDateTime dayStart = rangeStart.plusDays(i);
            LocalDateTime dayEnd = dayStart.plusDays(1);

            long meetingsHeld = allMeetings.stream()
                    .filter(m -> m.getMeetingDate() != null
                            && !m.getMeetingDate().isBefore(dayStart) && m.getMeetingDate().isBefore(dayEnd))
                    .count();

            long actionsCreated = allItems.stream()
                    .filter(a -> a.getCreatedAt() != null
                            && !a.getCreatedAt().isBefore(dayStart) && a.getCreatedAt().isBefore(dayEnd))
                    .count();
            long actionsCompleted = allItems.stream()
                    .filter(a -> "COMPLETED".equals(a.getStatus()) && a.getCompletedAt() != null
                            && !a.getCompletedAt().isBefore(dayStart) && a.getCompletedAt().isBefore(dayEnd))
                    .count();
            // Cumulative open count as of end-of-day — a burnup-style line.
            // DISMISSED items have no dedicated "dismissed at" timestamp, so
            // updatedAt is used as a reasonable proxy for when they left the
            // open pool (same approximation, not a new field to maintain).
            long openEndOfDay = allItems.stream()
                    .filter(a -> a.getCreatedAt() != null && a.getCreatedAt().isBefore(dayEnd))
                    .filter(a -> {
                        boolean resolvedByEndOfDay =
                                ("COMPLETED".equals(a.getStatus()) && a.getCompletedAt() != null && a.getCompletedAt().isBefore(dayEnd))
                             || ("DISMISSED".equals(a.getStatus()) && a.getUpdatedAt() != null && a.getUpdatedAt().isBefore(dayEnd));
                        return !resolvedByEndOfDay;
                    })
                    .count();

            long blockersOpened = allRaid.stream()
                    .filter(r -> "ISSUE".equals(r.getType()) && r.getCreatedAt() != null
                            && !r.getCreatedAt().isBefore(dayStart) && r.getCreatedAt().isBefore(dayEnd))
                    .count();
            long blockersResolved = allRaid.stream()
                    .filter(r -> "ISSUE".equals(r.getType())
                            && ("CLOSED".equals(r.getStatus()) || "MITIGATED".equals(r.getStatus()))
                            && r.getUpdatedAt() != null
                            && !r.getUpdatedAt().isBefore(dayStart) && r.getUpdatedAt().isBefore(dayEnd))
                    .count();
            long activeBlockersEndOfDay = allRaid.stream()
                    .filter(r -> "ISSUE".equals(r.getType()) && r.getCreatedAt() != null && r.getCreatedAt().isBefore(dayEnd))
                    .filter(r -> {
                        boolean resolvedByEndOfDay = ("CLOSED".equals(r.getStatus()) || "MITIGATED".equals(r.getStatus()))
                                && r.getUpdatedAt() != null && r.getUpdatedAt().isBefore(dayEnd);
                        return !resolvedByEndOfDay;
                    })
                    .count();

            long decisionsMade = allDecisions.stream()
                    .filter(d -> d.getCreatedAt() != null
                            && !d.getCreatedAt().isBefore(dayStart) && d.getCreatedAt().isBefore(dayEnd))
                    .count();

            // Distinct projects flagged AT_RISK/BLOCKED in meetings held that day.
            long atRiskProjectsFlagged = allMeetings.stream()
                    .filter(m -> m.getMeetingDate() != null
                            && !m.getMeetingDate().isBefore(dayStart) && m.getMeetingDate().isBefore(dayEnd))
                    .flatMap(m -> m.getProjectDiscussions().stream())
                    .filter(pd -> "AT_RISK".equals(pd.getStatusSnapshot()) || "BLOCKED".equals(pd.getStatusSnapshot()))
                    .map(Meeting.ProjectDiscussion::getProjectId)
                    .distinct()
                    .count();

            Map<String, Object> day = new LinkedHashMap<>();
            day.put("date", dayStart.toLocalDate().toString());
            day.put("meetingsHeld", meetingsHeld);
            day.put("actionsCreated", actionsCreated);
            day.put("actionsCompleted", actionsCompleted);
            day.put("openActionItemsEndOfDay", openEndOfDay);
            day.put("blockersOpened", blockersOpened);
            day.put("blockersResolved", blockersResolved);
            day.put("activeBlockersEndOfDay", activeBlockersEndOfDay);
            day.put("decisionsMade", decisionsMade);
            day.put("atRiskProjectsFlagged", atRiskProjectsFlagged);
            series.add(day);
        }
        return series;
    }
}

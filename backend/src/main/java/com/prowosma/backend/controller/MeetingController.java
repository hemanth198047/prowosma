package com.prowosma.backend.controller;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.Meeting;
import com.prowosma.backend.model.Meeting.ActionItem;
import com.prowosma.backend.model.MeetingActionItem;
import com.prowosma.backend.model.RaidEntry;
import com.prowosma.backend.model.Decision;
import com.prowosma.backend.repository.MeetingRepository;
import io.swagger.v3.oas.annotations.tags.Tag;
import com.prowosma.backend.util.PagedResponse;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

import java.time.LocalDateTime;
import com.prowosma.backend.util.PagedResponse;
import java.util.*;

@RestController
@RequestMapping("/api/meetings")
@Tag(name = "Meetings", description = "Meeting notes and scheduling")
@RequiredArgsConstructor
public class MeetingController {

    private final MeetingRepository meetingRepository;
    private final WorkspaceContext  workspaceContext;
    private final com.prowosma.backend.service.MeetingService meetingService;
    private final com.prowosma.backend.service.MeetingContinuityService continuityService;
    private final com.prowosma.backend.service.MeetingActionItemService actionItemService;
    private final com.prowosma.backend.repository.RaidRepository raidRepository;
    private final com.prowosma.backend.repository.DecisionRepository decisionRepository;

    @GetMapping
    public PagedResponse<Meeting> getAll(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String q,
            @RequestParam(defaultValue = "0")  int page,
            @RequestParam(defaultValue = "50") int size) {
        String wsId = workspaceContext.getWorkspaceId();
        org.springframework.data.domain.PageRequest pr =
            org.springframework.data.domain.PageRequest.of(page, Math.min(size, 200),
                org.springframework.data.domain.Sort.by("meetingDate").descending());
        if (q != null)
            return PagedResponse.ofList(
                meetingRepository.findByWorkspaceIdAndTitleContainingIgnoreCaseOrderByMeetingDateDesc(wsId, q),
                page, Math.min(size, 200));
        if (status != null)
            return PagedResponse.ofList(
                meetingRepository.findByWorkspaceIdAndStatusOrderByMeetingDateDesc(wsId, status),
                page, Math.min(size, 200));
        return PagedResponse.of(meetingRepository.findByWorkspaceId(wsId, pr));
    }

    @GetMapping("/{id}")
    public Meeting getById(@PathVariable String id) {
        return meetingRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Meeting not found: " + id));
    }

    @PostMapping
    public Meeting create(@RequestBody Meeting meeting, Authentication auth) {
        meeting.setWorkspaceId(workspaceContext.getWorkspaceId());
        meeting.setStatus("SCHEDULED");
        if (meeting.getActionItems() == null) meeting.setActionItems(new ArrayList<>());
        if (meeting.getAttendees()   == null) meeting.setAttendees(new ArrayList<>());
        return meetingService.create(meeting, auth.getName());
    }

    @PutMapping("/{id}")
    public Meeting update(@PathVariable String id, @RequestBody Map<String, Object> patch) {
        return meetingRepository.findById(id).map(m -> {
            if (patch.containsKey("title"))       m.setTitle((String) patch.get("title"));
            if (patch.containsKey("description")) m.setDescription((String) patch.get("description"));
            if (patch.containsKey("agenda"))      m.setAgenda((String) patch.get("agenda"));
            if (patch.containsKey("notes"))       m.setNotes((String) patch.get("notes"));
            if (patch.containsKey("summary"))     m.setSummary((String) patch.get("summary"));
            if (patch.containsKey("status"))      m.setStatus((String) patch.get("status"));
            if (patch.containsKey("projectId"))   m.setProjectId((String) patch.get("projectId"));
            if (patch.containsKey("durationMins") && patch.get("durationMins") instanceof Number)
                m.setDurationMins(((Number) patch.get("durationMins")).intValue());
            if (patch.containsKey("meetingDate") && patch.get("meetingDate") != null)
                m.setMeetingDate(LocalDateTime.parse((String) patch.get("meetingDate")));
            @SuppressWarnings("unchecked")
            List<String> attendees = (List<String>) patch.get("attendees");
            if (attendees != null) m.setAttendees(attendees);
            if (patch.containsKey("meetingType")) m.setMeetingType((String) patch.get("meetingType"));
            // Merge by projectId rather than replace wholesale — the modal only
            // edits structural fields (statusSnapshot/quickUpdate/discussionNotes);
            // overwriting the list would destroy actionItemIds/blockerIds/decisionIds
            // already attached via the project sub-resource endpoints.
            if (patch.get("projectDiscussions") instanceof List<?> rawList) {
                for (Object rawObj : rawList) {
                    if (!(rawObj instanceof Map)) continue;
                    @SuppressWarnings("unchecked")
                    Map<String, Object> raw = (Map<String, Object>) rawObj;
                    String projectId = (String) raw.get("projectId");
                    if (projectId == null || projectId.isBlank()) continue;
                    Meeting.ProjectDiscussion pd = findOrCreateDiscussion(m, projectId);
                    if (raw.get("statusSnapshot")   != null) pd.setStatusSnapshot((String) raw.get("statusSnapshot"));
                    if (raw.get("quickUpdate")      != null) pd.setQuickUpdate((String) raw.get("quickUpdate"));
                    if (raw.get("discussionNotes")  != null) pd.setDiscussionNotes((String) raw.get("discussionNotes"));
                    pd.setUpdatedAt(LocalDateTime.now());
                }
            }
            m.setUpdatedAt(LocalDateTime.now());
            return meetingRepository.save(m);
        }).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Meeting not found: " + id));
    }

    /** Add a typed ActionItem */
    @PostMapping("/{id}/action-items")
    public Meeting addActionItem(@PathVariable String id,
                                  @RequestBody Map<String, String> body,
                                  Authentication auth) {
        return meetingRepository.findById(id).map(m -> {
            ActionItem item = new ActionItem();
            item.setId(UUID.randomUUID().toString());
            item.setTitle(body.getOrDefault("title", ""));
            item.setAssignee(body.getOrDefault("assignee", auth.getName()));
            item.setDueDate(body.get("dueDate"));
            item.setDone(false);
            item.setConverted(false);
            item.setCreatedAt(LocalDateTime.now());
            if (m.getActionItems() == null) m.setActionItems(new ArrayList<>());
            m.getActionItems().add(item);
            m.setUpdatedAt(LocalDateTime.now());
            return meetingRepository.save(m);
        }).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Meeting not found: " + id));
    }

    /** Toggle action item done/undone */
    @PatchMapping("/{id}/action-items/{itemId}/toggle")
    public Meeting toggleActionItem(@PathVariable String id, @PathVariable String itemId) {
        return meetingRepository.findById(id).map(m -> {
            if (m.getActionItems() != null) {
                m.getActionItems().stream()
                    .filter(a -> itemId.equals(a.getId()))
                    .findFirst()
                    .ifPresent(a -> a.setDone(!a.isDone()));
            }
            m.setUpdatedAt(LocalDateTime.now());
            return meetingRepository.save(m);
        }).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Meeting not found: " + id));
    }

    @PostMapping("/{id}/complete")
    public Meeting complete(@PathVariable String id) {
        return meetingRepository.findById(id).map(m -> {
            m.setStatus("COMPLETED");
            m.setUpdatedAt(LocalDateTime.now());
            return meetingRepository.save(m);
        }).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Meeting not found: " + id));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, String>> delete(@PathVariable String id) {
        meetingRepository.deleteById(id);
        return ResponseEntity.ok(Map.of("message", "Meeting deleted"));
    }

    // ── Meeting Continuity ────────────────────────────────────────────

    /**
     * Pre-meeting "prepare" view — carry-forward context without needing
     * a meeting to exist yet. Also reused by the Dashboard's meeting-pulse
     * card.
     */
    @GetMapping("/prepare")
    public Map<String, Object> prepare(@RequestParam(required = false) List<String> projectIds) {
        return continuityService.getCarryForward(workspaceContext.getWorkspaceId(), projectIds);
    }

    /** Carry-forward context scoped to whatever projects this meeting has already selected. */
    @GetMapping("/{id}/continuity")
    public Map<String, Object> continuity(@PathVariable String id) {
        Meeting m = meetingRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Meeting not found: " + id));
        List<String> projectIds = m.getProjectDiscussions().stream()
                .map(Meeting.ProjectDiscussion::getProjectId).distinct().toList();
        return continuityService.getCarryForward(m.getWorkspaceId(), projectIds);
    }

    /** "Since Last Meeting" — diffs against the linked previous meeting. */
    @GetMapping("/{id}/whats-changed")
    public Map<String, Object> whatsChanged(@PathVariable String id) {
        return continuityService.getWhatsChanged(id);
    }

    /** End-of-meeting summary, reviewable before the meeting is closed. */
    @GetMapping("/{id}/summary")
    public Map<String, Object> summary(@PathVariable String id) {
        return continuityService.getMeetingSummary(id);
    }

    /** Full history of meetings that discussed a given project. */
    @GetMapping("/project/{projectId}")
    public PagedResponse<Meeting> getByProject(@PathVariable String projectId,
                                                @RequestParam(defaultValue = "0")  int page,
                                                @RequestParam(defaultValue = "50") int size) {
        String wsId = workspaceContext.getWorkspaceId();
        return PagedResponse.ofList(
                meetingRepository.findByWorkspaceIdAndProjectDiscussions_ProjectIdOrderByMeetingDateDesc(wsId, projectId),
                page, Math.min(size, 200));
    }

    /**
     * Day-to-day trends derived from existing timestamps — meetings held,
     * actions created/completed, open-item burnup, blocker open/resolve
     * rate, decisions made, and at-risk project count, per day.
     */
    @GetMapping("/trends")
    public List<Map<String, Object>> trends(@RequestParam(defaultValue = "14") int days) {
        return continuityService.getTrends(workspaceContext.getWorkspaceId(), days);
    }

    // ── Project discussions (multi-project meeting content) ───────────

    private Meeting.ProjectDiscussion findOrCreateDiscussion(Meeting m, String projectId) {
        if (m.getProjectDiscussions() == null) m.setProjectDiscussions(new ArrayList<>());
        return m.getProjectDiscussions().stream()
                .filter(pd -> projectId.equals(pd.getProjectId()))
                .findFirst()
                .orElseGet(() -> {
                    Meeting.ProjectDiscussion pd = new Meeting.ProjectDiscussion();
                    pd.setProjectId(projectId);
                    m.getProjectDiscussions().add(pd);
                    return pd;
                });
    }

    /** Add or update the discussion block for a project in this meeting (upsert by projectId). */
    @PostMapping("/{id}/projects")
    public Meeting upsertProjectDiscussion(@PathVariable String id, @RequestBody Map<String, String> body) {
        return meetingRepository.findById(id).map(m -> {
            String projectId = body.get("projectId");
            if (projectId == null || projectId.isBlank())
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "projectId is required");
            Meeting.ProjectDiscussion pd = findOrCreateDiscussion(m, projectId);
            if (body.containsKey("statusSnapshot")) pd.setStatusSnapshot(body.get("statusSnapshot"));
            if (body.containsKey("quickUpdate"))    pd.setQuickUpdate(body.get("quickUpdate"));
            if (body.containsKey("discussionNotes")) pd.setDiscussionNotes(body.get("discussionNotes"));
            pd.setUpdatedAt(LocalDateTime.now());
            m.setUpdatedAt(LocalDateTime.now());
            return meetingRepository.save(m);
        }).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Meeting not found: " + id));
    }

    /** Create a brand-new action item scoped to this meeting + project. */
    @PostMapping("/{id}/projects/{projectId}/action-items")
    public MeetingActionItem addActionItemForProject(@PathVariable String id, @PathVariable String projectId,
                                                       @RequestBody MeetingActionItem body, Authentication auth) {
        Meeting m = meetingRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Meeting not found: " + id));
        if (body.getProjectIds() == null || body.getProjectIds().isEmpty())
            body.setProjectIds(new ArrayList<>(List.of(projectId)));
        MeetingActionItem created = actionItemService.create(body, id, auth.getName());
        Meeting.ProjectDiscussion pd = findOrCreateDiscussion(m, projectId);
        pd.getActionItemIds().add(created.getId());
        pd.setUpdatedAt(LocalDateTime.now());
        m.setUpdatedAt(LocalDateTime.now());
        meetingRepository.save(m);
        return created;
    }

    /** Carry an existing (previously raised) action item into this meeting's discussion. */
    @PostMapping("/{id}/projects/{projectId}/action-items/{actionItemId}/carry")
    public MeetingActionItem carryActionItem(@PathVariable String id, @PathVariable String projectId,
                                              @PathVariable String actionItemId) {
        Meeting m = meetingRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Meeting not found: " + id));
        MeetingActionItem touched = actionItemService.touchInMeeting(actionItemId, id);
        Meeting.ProjectDiscussion pd = findOrCreateDiscussion(m, projectId);
        if (!pd.getActionItemIds().contains(actionItemId)) pd.getActionItemIds().add(actionItemId);
        pd.setUpdatedAt(LocalDateTime.now());
        m.setUpdatedAt(LocalDateTime.now());
        meetingRepository.save(m);
        return touched;
    }

    /** Create a brand-new blocker/risk (RaidEntry) scoped to this meeting + project. */
    @PostMapping("/{id}/projects/{projectId}/blockers")
    public RaidEntry addBlockerForProject(@PathVariable String id, @PathVariable String projectId,
                                           @RequestBody RaidEntry body, Authentication auth) {
        Meeting m = meetingRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Meeting not found: " + id));
        body.setOrganizationId(workspaceContext.getWorkspaceId());
        body.setProjectId(projectId);
        if (body.getType() == null) body.setType("ISSUE");
        if (body.getStatus() == null) body.setStatus("OPEN");
        body.setCreatedBy(auth.getName());
        body.setCreatedAt(LocalDateTime.now());
        body.setUpdatedAt(LocalDateTime.now());
        RaidEntry saved = raidRepository.save(body);
        RaidEntry linked = continuityService.linkRaidToMeeting(saved.getId(), id, true, auth.getName());

        Meeting.ProjectDiscussion pd = findOrCreateDiscussion(m, projectId);
        pd.getBlockerIds().add(linked.getId());
        pd.setUpdatedAt(LocalDateTime.now());
        m.setUpdatedAt(LocalDateTime.now());
        meetingRepository.save(m);
        return linked;
    }

    /** Carry an existing blocker/risk into this meeting's discussion. */
    @PostMapping("/{id}/projects/{projectId}/blockers/{raidId}/carry")
    public RaidEntry carryBlocker(@PathVariable String id, @PathVariable String projectId,
                                   @PathVariable String raidId, Authentication auth) {
        Meeting m = meetingRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Meeting not found: " + id));
        RaidEntry touched = continuityService.linkRaidToMeeting(raidId, id, false, auth.getName());
        Meeting.ProjectDiscussion pd = findOrCreateDiscussion(m, projectId);
        if (!pd.getBlockerIds().contains(raidId)) pd.getBlockerIds().add(raidId);
        pd.setUpdatedAt(LocalDateTime.now());
        m.setUpdatedAt(LocalDateTime.now());
        meetingRepository.save(m);
        return touched;
    }

    /** Create a brand-new decision scoped to this meeting + project. */
    @PostMapping("/{id}/projects/{projectId}/decisions")
    public Decision addDecisionForProject(@PathVariable String id, @PathVariable String projectId,
                                           @RequestBody Decision body, Authentication auth) {
        Meeting m = meetingRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Meeting not found: " + id));
        body.setOrganizationId(workspaceContext.getWorkspaceId());
        if (body.getLinkedProjectIds() == null) body.setLinkedProjectIds(new ArrayList<>());
        if (!body.getLinkedProjectIds().contains(projectId)) body.getLinkedProjectIds().add(projectId);
        if (body.getStatus() == null) body.setStatus("OPEN");
        body.setCreatedBy(auth.getName());
        body.setCreatedAt(LocalDateTime.now());
        body.setUpdatedAt(LocalDateTime.now());
        Decision saved = decisionRepository.save(body);
        Decision linked = continuityService.linkDecisionToMeeting(saved.getId(), id, true, auth.getName());

        Meeting.ProjectDiscussion pd = findOrCreateDiscussion(m, projectId);
        pd.getDecisionIds().add(linked.getId());
        pd.setUpdatedAt(LocalDateTime.now());
        m.setUpdatedAt(LocalDateTime.now());
        meetingRepository.save(m);
        return linked;
    }

    /** Reference an existing (already-decided or still-open) decision from this meeting. */
    @PostMapping("/{id}/projects/{projectId}/decisions/{decisionId}/carry")
    public Decision carryDecision(@PathVariable String id, @PathVariable String projectId,
                                   @PathVariable String decisionId, Authentication auth) {
        Meeting m = meetingRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Meeting not found: " + id));
        Decision touched = continuityService.linkDecisionToMeeting(decisionId, id, false, auth.getName());
        Meeting.ProjectDiscussion pd = findOrCreateDiscussion(m, projectId);
        if (!pd.getDecisionIds().contains(decisionId)) pd.getDecisionIds().add(decisionId);
        pd.setUpdatedAt(LocalDateTime.now());
        m.setUpdatedAt(LocalDateTime.now());
        meetingRepository.save(m);
        return touched;
    }
}

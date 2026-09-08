package com.prowosma.backend.service;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.MeetingActionItem;
import com.prowosma.backend.repository.MeetingActionItemRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;

/**
 * Owns the lifecycle of {@link MeetingActionItem} — the canonical,
 * top-level record for an action raised in a meeting. Meetings only ever
 * reference these ids (via Meeting.ProjectDiscussion.actionItemIds); this
 * service is the single place that mutates them, so carrying an item
 * forward across many meetings never creates a duplicate record.
 */
@Service
@RequiredArgsConstructor
public class MeetingActionItemService {

    private static final List<String> OPEN_STATUSES = List.of("OPEN", "IN_PROGRESS", "DEFERRED");

    private final MeetingActionItemRepository repository;
    private final ActivityLogService activityLogService;
    private final WorkspaceContext workspaceContext;

    public Optional<MeetingActionItem> getById(String id) {
        return repository.findById(id);
    }

    public List<MeetingActionItem> getByIds(List<String> ids) {
        if (ids == null || ids.isEmpty()) return List.of();
        return repository.findAllById(ids);
    }

    public List<MeetingActionItem> getAll(String orgId) {
        return repository.findByOrganizationId(orgId);
    }

    /**
     * Creates a new action item originating in the given meeting.
     */
    public MeetingActionItem create(MeetingActionItem item, String meetingId, String createdBy) {
        item.setOrganizationId(workspaceContext.getWorkspaceId());
        if (item.getStatus() == null) item.setStatus("OPEN");
        if (item.getPriority() == null) item.setPriority("MEDIUM");
        if (item.getProjectIds() == null) item.setProjectIds(new ArrayList<>());
        item.setSourceMeetingId(meetingId);
        item.setMeetingIds(meetingId != null ? new ArrayList<>(List.of(meetingId)) : new ArrayList<>());
        item.setCreatedBy(createdBy);
        item.setCreatedAt(LocalDateTime.now());
        item.setUpdatedAt(LocalDateTime.now());

        MeetingActionItem saved = repository.save(item);
        activityLogService.log("meeting_action_item", saved.getId(), saved.getTitle(),
                "CREATED", null, saved.getStatus(), createdBy);
        return saved;
    }

    /**
     * Carry-forward candidates: open, in-progress, or deferred (and due)
     * items, optionally scoped to a set of projects. Items deferred to a
     * future date are intentionally excluded until that date arrives —
     * they should not read as "stuck" the way an overdue open item does.
     */
    public List<MeetingActionItem> getCarryForwardCandidates(String orgId, List<String> projectIds) {
        List<MeetingActionItem> candidates = (projectIds == null || projectIds.isEmpty())
                ? repository.findByOrganizationIdAndStatusIn(orgId, OPEN_STATUSES)
                : repository.findByOrganizationIdAndProjectIdsInAndStatusIn(orgId, projectIds, OPEN_STATUSES);

        LocalDateTime now = LocalDateTime.now();
        return candidates.stream()
                .filter(item -> !"DEFERRED".equals(item.getStatus())
                        || item.getDeferredUntil() == null
                        || !item.getDeferredUntil().isAfter(now))
                .sorted(Comparator
                        .comparing((MeetingActionItem i) -> i.getDueDate() == null)
                        .thenComparing(i -> i.getDueDate() == null ? LocalDateTime.MAX : i.getDueDate()))
                .toList();
    }

    /** Number of times an item has been carried into a meeting beyond its origin. */
    public int carryForwardCount(MeetingActionItem item) {
        int size = item.getMeetingIds() == null ? 0 : item.getMeetingIds().size();
        return Math.max(0, size - 1);
    }

    /** Records that this item was referenced/discussed again in the given meeting. */
    public MeetingActionItem touchInMeeting(String id, String meetingId) {
        return repository.findById(id).map(item -> {
            if (item.getMeetingIds() == null) item.setMeetingIds(new ArrayList<>());
            if (!item.getMeetingIds().contains(meetingId)) item.getMeetingIds().add(meetingId);
            item.setUpdatedAt(LocalDateTime.now());
            return repository.save(item);
        }).orElseThrow(() -> new IllegalArgumentException("Action item not found: " + id));
    }

    public MeetingActionItem updateStatus(String id, String newStatus, String performedBy, String meetingId) {
        return repository.findById(id).map(item -> {
            String oldStatus = item.getStatus();
            item.setStatus(newStatus);
            if ("COMPLETED".equals(newStatus)) item.setCompletedAt(LocalDateTime.now());
            if (meetingId != null) {
                if (item.getMeetingIds() == null) item.setMeetingIds(new ArrayList<>());
                if (!item.getMeetingIds().contains(meetingId)) item.getMeetingIds().add(meetingId);
            }
            item.setUpdatedAt(LocalDateTime.now());
            MeetingActionItem saved = repository.save(item);
            activityLogService.log("meeting_action_item", saved.getId(), saved.getTitle(),
                    "STATUS_CHANGED", oldStatus, newStatus, performedBy);
            return saved;
        }).orElseThrow(() -> new IllegalArgumentException("Action item not found: " + id));
    }

    public MeetingActionItem complete(String id, String performedBy, String meetingId) {
        return updateStatus(id, "COMPLETED", performedBy, meetingId);
    }

    public MeetingActionItem dismiss(String id, String performedBy, String meetingId) {
        return updateStatus(id, "DISMISSED", performedBy, meetingId);
    }

    /** Defer until next meeting (deferredUntil = null) or a specific date. */
    public MeetingActionItem defer(String id, LocalDateTime deferredUntil, String performedBy, String meetingId) {
        return repository.findById(id).map(item -> {
            String oldStatus = item.getStatus();
            item.setStatus("DEFERRED");
            item.setDeferredUntil(deferredUntil);
            if (meetingId != null) {
                if (item.getMeetingIds() == null) item.setMeetingIds(new ArrayList<>());
                if (!item.getMeetingIds().contains(meetingId)) item.getMeetingIds().add(meetingId);
            }
            item.setUpdatedAt(LocalDateTime.now());
            MeetingActionItem saved = repository.save(item);
            activityLogService.log("meeting_action_item", saved.getId(), saved.getTitle(),
                    "STATUS_CHANGED", oldStatus, "DEFERRED", performedBy);
            return saved;
        }).orElseThrow(() -> new IllegalArgumentException("Action item not found: " + id));
    }

    public MeetingActionItem reassign(String id, String newOwner, String performedBy) {
        return repository.findById(id).map(item -> {
            String oldOwner = item.getOwner();
            item.setOwner(newOwner);
            item.setUpdatedAt(LocalDateTime.now());
            MeetingActionItem saved = repository.save(item);
            activityLogService.log("meeting_action_item", saved.getId(), saved.getTitle(),
                    "OWNER_CHANGED", oldOwner, newOwner, performedBy);
            return saved;
        }).orElseThrow(() -> new IllegalArgumentException("Action item not found: " + id));
    }

    public MeetingActionItem update(String id, MeetingActionItem patch, String performedBy) {
        return repository.findById(id).map(item -> {
            if (patch.getTitle()       != null) item.setTitle(patch.getTitle());
            if (patch.getDescription() != null) item.setDescription(patch.getDescription());
            if (patch.getOwner()       != null) item.setOwner(patch.getOwner());
            if (patch.getPriority()    != null) item.setPriority(patch.getPriority());
            if (patch.getDueDate()     != null) item.setDueDate(patch.getDueDate());
            if (patch.getProjectIds()  != null) item.setProjectIds(patch.getProjectIds());
            item.setUpdatedAt(LocalDateTime.now());
            return repository.save(item);
        }).orElseThrow(() -> new IllegalArgumentException("Action item not found: " + id));
    }

    public MeetingActionItem markConvertedToTask(String id, String taskId) {
        return repository.findById(id).map(item -> {
            item.setConvertedTaskId(taskId);
            item.setUpdatedAt(LocalDateTime.now());
            return repository.save(item);
        }).orElseThrow(() -> new IllegalArgumentException("Action item not found: " + id));
    }

    public boolean delete(String id) {
        if (!repository.existsById(id)) return false;
        repository.deleteById(id);
        return true;
    }
}

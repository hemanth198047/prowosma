package com.prowosma.backend.service;

import com.prowosma.backend.model.Meeting;
import com.prowosma.backend.repository.MeetingRepository;
import com.prowosma.backend.service.ActivityLogService;
import com.prowosma.backend.config.WorkspaceContext;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class MeetingService {

    private final MeetingRepository meetingRepository;
    private final ActivityLogService activityLogService;
    private final WorkspaceContext    workspaceContext;

    public List<Meeting> getByWorkspace(String workspaceId) {
        return meetingRepository.findByWorkspaceIdOrderByMeetingDateDesc(workspaceId);
    }

    public List<Meeting> getByDoc(String docId) {
        return meetingRepository.findByDocIdOrderByMeetingDateDesc(docId);
    }

    public List<Meeting> search(String workspaceId, String q) {
        return meetingRepository.findByWorkspaceIdAndTitleContainingIgnoreCaseOrderByMeetingDateDesc(workspaceId, q);
    }

    public Optional<Meeting> getById(String id) {
        return meetingRepository.findById(id);
    }

    public Meeting create(Meeting m, String createdBy) {
        m.setCreatedBy(createdBy);
        m.setCreatedAt(LocalDateTime.now());
        m.setUpdatedAt(LocalDateTime.now());
        if (m.getStatus() == null) m.setStatus("COMPLETED");
        if (m.getTitle()  == null) m.setTitle("Untitled Meeting");
        if (m.getMeetingType() == null) m.setMeetingType("OTHER");
        if (m.getProjectDiscussions() == null) m.setProjectDiscussions(new java.util.ArrayList<>());
        if (m.getActionItems() == null) m.setActionItems(new java.util.ArrayList<>());
        if (m.getAttendees() == null) m.setAttendees(new java.util.ArrayList<>());
        // Give each action item an id if missing
        if (m.getActionItems() != null) {
            m.getActionItems().forEach(a -> {
                if (a.getId() == null) a.setId(UUID.randomUUID().toString());
            });
        }
        // Link to the immediately preceding meeting in this workspace so the
        // continuity chain is O(1) to walk. Uses meetingDate-aware lookup so
        // backfilled/out-of-order meetings still link correctly; falls back
        // to "latest overall" when no date is set yet.
        if (m.getWorkspaceId() != null && m.getPreviousMeetingId() == null) {
            var previous = m.getMeetingDate() != null
                ? meetingRepository.findTopByWorkspaceIdAndMeetingDateLessThanOrderByMeetingDateDesc(
                        m.getWorkspaceId(), m.getMeetingDate())
                : meetingRepository.findTopByWorkspaceIdOrderByMeetingDateDesc(m.getWorkspaceId());
            previous.ifPresent(p -> m.setPreviousMeetingId(p.getId()));
        }
        return meetingRepository.save(m);
    }

    public Optional<Meeting> update(String id, Meeting patch) {
        return meetingRepository.findById(id).map(existing -> {
            if (patch.getTitle()       != null) existing.setTitle(patch.getTitle());
            if (patch.getAgenda()      != null) existing.setAgenda(patch.getAgenda());
            if (patch.getNotes()       != null) existing.setNotes(patch.getNotes());
            if (patch.getSummary()     != null) existing.setSummary(patch.getSummary());
            if (patch.getAttendees()   != null) existing.setAttendees(patch.getAttendees());
            if (patch.getActionItems() != null) existing.setActionItems(patch.getActionItems());
            if (patch.getStatus()      != null) existing.setStatus(patch.getStatus());
            if (patch.getMeetingDate() != null) existing.setMeetingDate(patch.getMeetingDate());
            if (patch.getDocId()       != null) existing.setDocId(patch.getDocId());
            if (patch.getMeetingType() != null) existing.setMeetingType(patch.getMeetingType());
            if (patch.getProjectDiscussions() != null) existing.setProjectDiscussions(patch.getProjectDiscussions());
            existing.setUpdatedAt(LocalDateTime.now());
            return meetingRepository.save(existing);
        });
    }

    public boolean delete(String id) {
        if (!meetingRepository.existsById(id)) return false;
        meetingRepository.deleteById(id);
        return true;
    }

    // Mark an action item as converted to a task
    public Optional<Meeting> markActionConverted(String meetingId, String actionId, String taskId) {
        return meetingRepository.findById(meetingId).map(meeting -> {
            meeting.getActionItems().stream()
                .filter(a -> actionId.equals(a.getId()))
                .findFirst()
                .ifPresent(a -> { a.setConverted(true); a.setTaskId(taskId); });
            meeting.setUpdatedAt(LocalDateTime.now());
            return meetingRepository.save(meeting);
        });
    }
}

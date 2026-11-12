package com.prowosma.backend.repository;

import com.prowosma.backend.model.Meeting;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.List;

public interface MeetingRepository extends MongoRepository<Meeting, String> {
    List<Meeting> findByWorkspaceIdOrderByMeetingDateDesc(String workspaceId);
    List<Meeting> findByDocIdOrderByMeetingDateDesc(String docId);
    List<Meeting> findByWorkspaceIdAndTitleContainingIgnoreCaseOrderByMeetingDateDesc(String wsId, String title);
    List<Meeting> findByWorkspaceIdAndStatusOrderByMeetingDateDesc(String wsId, String status);
    Page<Meeting> findByWorkspaceId(String workspaceId, Pageable pageable);

    // Calendar view: meetings that start inside the visible date range.
    List<Meeting> findByWorkspaceIdAndMeetingDateBetweenOrderByMeetingDateAsc(
            String workspaceId, java.time.LocalDateTime from, java.time.LocalDateTime to);

    // ── Meeting Continuity ──────────────────────────────────────────
    // Latest meeting in the workspace overall — used to set previousMeetingId
    // at creation time so the chain is O(1) to walk, never a full date scan.
    java.util.Optional<Meeting> findTopByWorkspaceIdOrderByMeetingDateDesc(String workspaceId);

    // Latest meeting strictly before a given date — used when a meeting is
    // created/backfilled out of chronological order.
    java.util.Optional<Meeting> findTopByWorkspaceIdAndMeetingDateLessThanOrderByMeetingDateDesc(
            String workspaceId, java.time.LocalDateTime beforeDate);

    // Most recent meeting that discussed a given project — powers the
    // "latest known status" lookup for projects marked AT_RISK/BLOCKED
    // without scanning full meeting history.
    java.util.Optional<Meeting> findTopByWorkspaceIdAndProjectDiscussions_ProjectIdOrderByMeetingDateDesc(
            String workspaceId, String projectId);

    // Full history of meetings that discussed a given project — powers
    // "project meeting history" / project timeline views.
    List<Meeting> findByWorkspaceIdAndProjectDiscussions_ProjectIdOrderByMeetingDateDesc(
            String workspaceId, String projectId);
}

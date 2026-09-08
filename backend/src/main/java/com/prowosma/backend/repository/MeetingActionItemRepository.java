package com.prowosma.backend.repository;

import com.prowosma.backend.model.MeetingActionItem;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.List;

public interface MeetingActionItemRepository extends MongoRepository<MeetingActionItem, String> {
    List<MeetingActionItem> findByOrganizationId(String orgId);
    Page<MeetingActionItem> findByOrganizationId(String orgId, Pageable pageable);

    // Carry-forward candidates, workspace-wide (no project filter selected).
    List<MeetingActionItem> findByOrganizationIdAndStatusIn(String orgId, List<String> statuses);

    // Carry-forward candidates scoped to the projects a meeting is discussing.
    List<MeetingActionItem> findByOrganizationIdAndProjectIdsInAndStatusIn(
            String orgId, List<String> projectIds, List<String> statuses);

    // Items that originated in a specific meeting — used for "new action
    // items" in an end-of-meeting summary.
    List<MeetingActionItem> findBySourceMeetingId(String meetingId);

    // Items that were carried into / touched by a specific meeting —
    // used to render "carried forward into this meeting".
    List<MeetingActionItem> findByMeetingIdsContaining(String meetingId);
}

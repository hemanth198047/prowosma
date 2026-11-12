package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Data
@Document(collection = "meetings")
public class Meeting {
    @Id private String id;
    private String workspaceId;
    private String title;
    private String description;
    private String agenda;
    private String notes;
    private String summary;
    private String status = "SCHEDULED";
    private String projectId;
    private String createdBy;
    private LocalDateTime meetingDate;
    private Integer durationMins;
    // Where the meeting happens: a room name or a meeting link (Teams, Zoom,
    // Meet...). Shown on the calendar; a link gets a "Join" button.
    private String location;
    private String docId;
    private List<String> attendees = new ArrayList<>();

    /* actionItems as typed list — MeetingService calls .getId(), .setConverted(), .setTaskId() */
    private List<ActionItem> actionItems = new ArrayList<>();

    @Data
    public static class ActionItem {
        private String id;
        private String title;
        private String assignee;
        private String dueDate;
        private boolean done      = false;
        private boolean converted = false;
        private String taskId;
        private LocalDateTime createdAt = LocalDateTime.now();
    }

    // ── Meeting Continuity / Daily Project Pulse ─────────────────
    // meetingType classifies the meeting for continuity chaining and
    // templates. Additive — legacy meetings default to "OTHER" and are
    // otherwise unaffected.
    private String meetingType = "OTHER"; // STANDUP | EOD | REVIEW | OTHER

    // Pointer to the immediately preceding meeting in this workspace,
    // set once at creation time. This makes "previous meeting" lookup
    // O(1) instead of a date-range scan, and stays unambiguous even when
    // multiple meetings occur on the same day. Null for the first-ever
    // meeting in a workspace.
    private String previousMeetingId;

    // Multi-project discussion capture. Each entry is a per-meeting
    // SNAPSHOT of one project's discussion — it does not own the
    // project's canonical state, and it references (never copies) the
    // underlying action items / blockers / decisions so carrying an item
    // forward across meetings never duplicates the business record.
    private List<ProjectDiscussion> projectDiscussions = new ArrayList<>();

    @Data
    public static class ProjectDiscussion {
        private String id = java.util.UUID.randomUUID().toString();
        private String projectId;

        // Point-in-time status as asserted in this meeting. Intentionally
        // manual/asserted rather than derived — Project.status remains the
        // system of record elsewhere in the app; this is a meeting-scoped
        // opinion about it, not a rewrite of it.
        private String statusSnapshot; // NOT_STARTED | IN_PROGRESS | ON_TRACK | AT_RISK | BLOCKED | COMPLETED

        // Fast, low-friction update used for daily stand-ups where nothing
        // structured needs to change.
        private String quickUpdate;    // NO_CHANGE | PROGRESS | BLOCKED | COMPLETED | NEEDS_DISCUSSION

        private String discussionNotes; // free-form context

        // References only — canonical records live in their own
        // top-level collections (meeting_action_items, raid_entries,
        // decisions).
        private List<String> actionItemIds = new ArrayList<>();
        private List<String> blockerIds    = new ArrayList<>();
        private List<String> decisionIds   = new ArrayList<>();

        private LocalDateTime createdAt = LocalDateTime.now();
        private LocalDateTime updatedAt = LocalDateTime.now();
    }

    private LocalDateTime createdAt = LocalDateTime.now();
    private LocalDateTime updatedAt = LocalDateTime.now();
}

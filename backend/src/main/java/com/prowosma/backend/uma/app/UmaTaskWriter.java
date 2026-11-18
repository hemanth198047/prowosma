package com.prowosma.backend.uma.app;

import com.prowosma.backend.model.Task;
import com.prowosma.backend.service.TaskService;
import com.prowosma.backend.uma.model.UmaInsights;
import com.prowosma.backend.uma.model.UmaMeeting;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * Creates the task for one action item through the existing task module (so its permission checks, activity log, notifications and
 * goal sync all apply). The same item never makes a second task: the source key is unique per workspace, and an existing task is
 * returned instead. Must run inside a request (a person's, or MeetingSystemContext for background work).
 */
@Component
public class UmaTaskWriter {
    private final TaskService tasks;
    private final MongoTemplate mongo;

    public UmaTaskWriter(TaskService tasks, MongoTemplate mongo) { this.tasks = tasks; this.mongo = mongo; }

    public static String sourceKey(String meetingId, String actionId) { return "uma:" + meetingId + ":" + actionId; }

    public Task existing(String org, String key) {
        return mongo.findOne(new Query(Criteria.where("organizationId").is(org).and("sourceActionKey").is(key)), Task.class);
    }

    /** @param assign whether to put the matched owner on the task (false leaves it unassigned) */
    public Task createOrFind(String org, UmaMeeting m, UmaInsights.ActionItem a, String createdBy, boolean assign) {
        String key = sourceKey(m.getId(), a.getId());
        Task found = existing(org, key);
        if (found != null) return found;
        Task t = new Task();
        t.setTitle(a.getTitle());
        t.setDescription(description(m, a, assign));
        t.setProjectId(a.getProjectId());
        t.setPriority(a.getPriority());
        if (a.getDueDate() != null) t.setDueDate(a.getDueDate().atStartOfDay());
        if (assign && a.getOwnerMemberId() != null) t.setAssigneeIds(new ArrayList<>(List.of(a.getOwnerMemberId())));
        t.setTags(new ArrayList<>(List.of("meeting")));
        t.setCreatedBy(createdBy);
        t.setSourceMeetingId(m.getId());
        t.setSourceMeetingTitle(m.getTitle());
        t.setSourceActionKey(key);
        t.setSourceEvidence(new ArrayList<>(a.getEvidence()));
        try { return tasks.create(t); }
        catch (DuplicateKeyException race) {
            Task again = existing(org, key);
            if (again == null) throw race;
            return again;
        }
    }

    static String description(UmaMeeting m, UmaInsights.ActionItem a, boolean assigned) {
        StringBuilder sb = new StringBuilder();
        if (a.getDescription() != null && !a.getDescription().isBlank()) sb.append(a.getDescription()).append("\n\n");
        if (a.getOwnerSpoken() != null && (a.getOwnerMemberId() == null || !assigned)) sb.append("Owner named in the meeting: ").append(a.getOwnerSpoken()).append("\n");
        if (a.getDueSpoken() != null && a.getDueDate() == null) sb.append("Deadline as said: ").append(a.getDueSpoken()).append("\n");
        if (a.getDependsOn() != null) sb.append("Depends on: ").append(a.getDependsOn()).append("\n");
        sb.append("From the meeting \"").append(m.getTitle()).append("\" (AI Meeting Assistant), transcript line")
          .append(a.getEvidence().size() == 1 ? " " : "s ").append(String.join(", ", a.getEvidence().stream().map(i -> "#" + i).toList())).append('.');
        return sb.toString();
    }
}

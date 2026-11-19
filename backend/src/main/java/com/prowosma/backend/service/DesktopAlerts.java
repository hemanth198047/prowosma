package com.prowosma.backend.service;

import com.prowosma.backend.attendance.app.AttendanceFeature;
import com.prowosma.backend.attendance.app.AttendanceService;
import com.prowosma.backend.model.Task;
import com.prowosma.backend.model.TeamMember;
import com.prowosma.backend.model.Workspace;
import com.prowosma.backend.repository.TeamMemberRepository;
import com.prowosma.backend.repository.WorkspaceRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.index.Index;
import org.springframework.data.mongodb.core.mapping.event.AbstractMongoEventListener;
import org.springframework.data.mongodb.core.mapping.event.AfterSaveEvent;
import org.springframework.data.mongodb.core.mapping.event.BeforeConvertEvent;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

import java.time.*;
import java.util.*;

/**
 * Desktop / phone notifications (Web Push) for the things a person must not miss, delivered even when Prowosma isn't open:
 * <ul>
 *   <li>a task was assigned to you (from any screen, the meeting assistant included) - not when you assigned it to yourself;</li>
 *   <li>a task of yours is due within the hour, and when it becomes overdue;</li>
 *   <li>Attendance (when the workspace has it on): you haven't clocked in after your start time, or you're still clocked in well after your end.</li>
 * </ul>
 * Each alert is sent once: a row in {@code alerts_sent} (unique key) records it. Nothing is sent unless push is configured on the
 * server (VAPID keys) and the person turned notifications on in their browser.
 */
@Slf4j
@Component
public class DesktopAlerts extends AbstractMongoEventListener<Task> {
    static final String SENT = "alerts_sent";

    private final MongoTemplate mongo;
    private final PersonalAlertService alerts;
    private final TeamMemberRepository members;
    private final WorkspaceRepository workspaces;
    private final AttendanceService attendance;
    private final AttendanceFeature attendanceFeature;

    @Value("${app.alerts.jobs-enabled:true}")
    private boolean jobsEnabled = true;

    public DesktopAlerts(MongoTemplate mongo, PersonalAlertService alerts, TeamMemberRepository members, WorkspaceRepository workspaces,
                         AttendanceService attendance, AttendanceFeature attendanceFeature) {
        this.mongo = mongo; this.alerts = alerts; this.members = members; this.workspaces = workspaces;
        this.attendance = attendance; this.attendanceFeature = attendanceFeature;
        try { mongo.indexOps(SENT).ensureIndex(new Index().on("key", org.springframework.data.domain.Sort.Direction.ASC).unique()); }
        catch (RuntimeException e) { log.warn("alerts: index not created: {}", e.getClass().getSimpleName()); }
    }

    /** Records the alert; false if it was already sent. */
    boolean firstTime(String key) {
        try {
            mongo.insert(new org.bson.Document(Map.of("key", key, "at", new Date())), SENT);
            return true;
        } catch (DuplicateKeyException e) { return false; }
    }

    private String emailOf(String memberId) {
        return memberId == null ? null : members.findById(memberId).map(TeamMember::getEmail).map(e -> e.toLowerCase(Locale.ROOT)).orElse(null);
    }

    private static String actor() {
        var a = SecurityContextHolder.getContext().getAuthentication();
        return a == null || a.getName() == null ? null : a.getName().toLowerCase(Locale.ROOT);
    }

    // ── assigned to you ──────────────────────────────────────────────────

    /** Who was assigned before this save (read from the database), per task id, on this thread. */
    private final ThreadLocal<Map<String, Set<String>>> before = ThreadLocal.withInitial(HashMap::new);

    @Override
    public void onBeforeConvert(BeforeConvertEvent<Task> event) {
        Task t = event.getSource();
        if (t.getId() == null) return;                                          // new task: everyone on it is new
        try {
            org.bson.Document d = mongo.getCollection(mongo.getCollectionName(Task.class))
                    .find(new org.bson.Document("_id", toId(t.getId()))).projection(new org.bson.Document("assigneeIds", 1)).first();
            Set<String> was = new HashSet<>();
            if (d != null && d.get("assigneeIds") instanceof List<?> l) l.forEach(x -> was.add(String.valueOf(x)));
            before.get().put(t.getId(), was);
        } catch (RuntimeException e) {
            before.get().put(t.getId(), new HashSet<>(t.getAssigneeIds() == null ? List.of() : t.getAssigneeIds()));   // unsure: alert nobody
        }
    }

    private static Object toId(String id) { return org.bson.types.ObjectId.isValid(id) ? new org.bson.types.ObjectId(id) : id; }

    @Override
    public void onAfterSave(AfterSaveEvent<Task> event) {
        Task t = event.getSource();
        Set<String> was = t.getId() == null ? null : before.get().remove(t.getId());
        try {
            if (t.getId() == null || t.getAssigneeIds() == null || t.getAssigneeIds().isEmpty() || "DONE".equals(t.getStatus())) return;
            String me = actor();
            for (String id : t.getAssigneeIds()) {
                if (was != null && was.contains(id)) continue;                       // already on it before this change
                String email = emailOf(id);
                if (email == null || email.equals(me)) continue;                      // you assigned it to yourself
                if (!firstTime("assigned:" + t.getId() + ":" + id)) continue;
                alerts.tell(email, "New task for you", t.getTitle(), "/tasks?highlight=" + t.getId());
            }
        } catch (RuntimeException e) {
            log.warn("alerts: assignment alert failed: {}", e.getClass().getSimpleName());
        }
    }

    // ── due soon / overdue / attendance ──────────────────────────────────

    @Scheduled(fixedDelayString = "${app.alerts.sweep-ms:120000}", initialDelayString = "${app.alerts.sweep-initial-ms:90000}")
    public void sweep() {
        if (!jobsEnabled) return;
        try { sweepAt(Instant.now()); }
        catch (RuntimeException e) { log.warn("alerts sweep failed: {}", e.getClass().getSimpleName()); }
    }

    /** One pass at the given time (tests pick the time). Returns how many alerts were sent. */
    public int sweepAt(Instant now) {
        int sent = 0;
        LocalDateTime utcNow = LocalDateTime.ofInstant(now, ZoneOffset.UTC);
        // Due within the next hour.
        Query soon = new Query(Criteria.where("status").ne("DONE").and("assigneeIds.0").exists(true)
                .and("dueDate").gt(utcNow).lte(utcNow.plusHours(1))).limit(500);
        for (Task t : mongo.find(soon, Task.class)) sent += tellAssignees(t, "due:" + t.getId() + ":" + t.getDueDate(), "Due within the hour", t.getTitle());
        // Became overdue in the last day (older ones were already known about before this feature, so they aren't re-announced).
        Query late = new Query(Criteria.where("status").ne("DONE").and("assigneeIds.0").exists(true)
                .and("dueDate").lte(utcNow).gt(utcNow.minusDays(1))).limit(500);
        for (Task t : mongo.find(late, Task.class)) sent += tellAssignees(t, "overdue:" + t.getId() + ":" + t.getDueDate(), "Overdue", t.getTitle());
        // Attendance nudges.
        for (Workspace ws : workspaces.findAll()) {
            if (ws.getId() == null || !attendanceFeature.isOn(ws.getId())) continue;
            for (AttendanceService.Reminder r : attendance.reminders(ws.getId(), now)) {
                if (!firstTime("att:" + ws.getId() + ":" + r.email() + ":" + r.kind() + ":" + r.date())) continue;
                alerts.tell(r.email(), r.title(), r.body(), "/attendance");
                sent++;
            }
        }
        return sent;
    }

    private int tellAssignees(Task t, String key, String title, String body) {
        int n = 0;
        for (String id : t.getAssigneeIds()) {
            String email = emailOf(id);
            if (email == null || !firstTime(key + ":" + id)) continue;
            alerts.tell(email, title, body, "/tasks?highlight=" + t.getId());
            n++;
        }
        return n;
    }
}

package com.prowosma.backend.service;

import com.prowosma.backend.model.*;
import com.prowosma.backend.repository.*;
import org.springframework.beans.factory.annotation.Value;
import lombok.RequiredArgsConstructor;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.stream.Collectors;

/**
 * P2-1: Email Notification Digest
 * Sends daily (8am) and weekly (Mon 8am) HTML digest emails
 * respecting per-workspace notifPrefs.weeklyDigest / dailyDigest setting.
 */
@Service
@RequiredArgsConstructor
public class DigestService {

    @Value("${app.frontend.url:http://localhost:5173}")
    private String frontendUrl;


    private final TaskRepository       taskRepo;
    private final GoalRepository       goalRepo;
    private final ProjectRepository    projectRepo;
    private final NotificationRepository notifRepo;
    private final WorkspaceRepository  wsRepo;
    private final UserRepository       userRepo;
    private final EmailService         emailService;

    private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("dd MMM yyyy");

    // ── Daily digest: 8am every day, all workspaces ──────────
    @Scheduled(cron = "0 0 8 * * *")
    public void sendDailyDigests() {
        wsRepo.findAll().forEach(ws -> {
            if (!isDailyEnabled(ws)) return;
            sendDailyDigestFor(ws);
        });
    }

    /**
     * Sends one workspace's daily digest right now, regardless of that
     * workspace's dailyDigest preference — used by the "Send Reminder Now"
     * button (ReminderController), where the person clicking it has
     * explicitly asked for it, so the opt-out shouldn't apply the way it
     * does for the automatic 8am run.
     *
     * This replaces the old ReminderService/ReminderController pair, which
     * had two real bugs: it depended on the request-scoped WorkspaceContext
     * bean, so it could never actually be @Scheduled in the first place
     * (Spring throws outside an active request) — which is why it only ever
     * existed as a manual button, not the "server-side scheduled" behavior
     * the button's own label implied. And it sent every workspace's
     * reminder to one single hardcoded app.reminder.email address instead
     * of to that workspace's actual members, so two different workspaces
     * clicking the button would both notify the exact same inbox about
     * neither workspace's actual overdue work.
     */
    public void sendDailyDigestNowFor(String organizationId) {
        wsRepo.findById(organizationId).ifPresent(this::sendDailyDigestFor);
    }

    private void sendDailyDigestFor(Workspace ws) {
        String orgId = ws.getId();
        LocalDateTime now       = LocalDateTime.now();
        LocalDateTime endOfDay  = now.toLocalDate().atTime(23, 59, 59);
        LocalDateTime tomorrowEnd = now.toLocalDate().plusDays(1).atTime(23, 59, 59);

        List<Task> overdue = taskRepo.findByOrganizationId(orgId).stream()
            .filter(t -> t.getDueDate() != null && t.getDueDate().isBefore(now)
                && !"DONE".equals(t.getStatus()))
            .collect(Collectors.toList());

        List<Task> dueToday = taskRepo.findByOrganizationId(orgId).stream()
            .filter(t -> t.getDueDate() != null
                && t.getDueDate().toLocalDate().equals(now.toLocalDate())
                && !"DONE".equals(t.getStatus()))
            .collect(Collectors.toList());

        // Previously only in the now-retired ReminderService — folded in
        // here so this single, correctly-scheduled, correctly-addressed
        // digest covers the same ground the old one did, instead of two
        // parallel implementations (one broken) doing overlapping work.
        List<Task> dueTomorrow = taskRepo.findByOrganizationId(orgId).stream()
            .filter(t -> t.getDueDate() != null
                && t.getDueDate().isAfter(endOfDay) && t.getDueDate().isBefore(tomorrowEnd)
                && !"DONE".equals(t.getStatus()))
            .collect(Collectors.toList());

        List<Project> overdueProjects = projectRepo.findByOrganizationId(orgId).stream()
            .filter(p -> p.getDueDate() != null && p.getDueDate().isBefore(now)
                && !"DONE".equals(p.getStatus()))
            .collect(Collectors.toList());

        List<Goal> overdueGoals = goalRepo.findByOrganizationId(orgId).stream()
            .filter(g -> g.getTargetDate() != null && g.getTargetDate().isBefore(now)
                && !"ACHIEVED".equals(g.getStatus()))
            .collect(Collectors.toList());

        List<Notification> unread = notifRepo.findByOrganizationId(orgId).stream()
            .filter(n -> !n.isRead()
                && n.getCreatedAt().isAfter(now.minusHours(24)))
            .collect(Collectors.toList());

        if (overdue.isEmpty() && dueToday.isEmpty() && dueTomorrow.isEmpty()
                && overdueProjects.isEmpty() && overdueGoals.isEmpty() && unread.isEmpty()) return;

        String html = buildDailyHtml(ws.getName(), now, overdue, dueToday, dueTomorrow,
            overdueProjects, overdueGoals, unread);
        String subject = "📋 Prowosma Daily — " + now.format(DATE)
            + (overdue.isEmpty() ? "" : " | " + overdue.size() + " overdue");

        // Send to workspace owner + all members who enabled digest
        userRepo.findByOrganizationId(orgId)
            .forEach(u -> emailService.sendHtmlEmail(u.getEmail(), u.getName(), subject, html));
    }

    // ── Weekly digest: Monday 8am ─────────────────────────────
    @Scheduled(cron = "0 0 8 * * MON")
    public void sendWeeklyDigests() {
        wsRepo.findAll().forEach(ws -> {
            if (!isWeeklyEnabled(ws)) return;
            String orgId = ws.getId();
            LocalDateTime now = LocalDateTime.now();
            LocalDateTime weekAgo = now.minusDays(7);

            List<Task> completed = taskRepo.findByOrganizationId(orgId).stream()
                .filter(t -> "DONE".equals(t.getStatus())
                    && t.getUpdatedAt() != null && t.getUpdatedAt().isAfter(weekAgo))
                .collect(Collectors.toList());

            List<Goal> atRiskGoals = goalRepo.findByOrganizationId(orgId).stream()
                .filter(g -> "ACTIVE".equals(g.getStatus()) && g.getConfidence() < 50)
                .collect(Collectors.toList());

            List<Task> overdue = taskRepo.findByOrganizationId(orgId).stream()
                .filter(t -> t.getDueDate() != null && t.getDueDate().isBefore(now)
                    && !"DONE".equals(t.getStatus()))
                .collect(Collectors.toList());

            String html = buildWeeklyHtml(ws.getName(), now, completed, atRiskGoals, overdue);
            String subject = "📊 Prowosma Weekly — " + now.format(DATE)
                + " | " + completed.size() + " tasks completed";

            userRepo.findByOrganizationId(orgId)
                .forEach(u -> emailService.sendHtmlEmail(u.getEmail(), u.getName(), subject, html));
        });
    }

    // ── HTML builders ─────────────────────────────────────────

    private String buildDailyHtml(String wsName, LocalDateTime now,
            List<Task> overdue, List<Task> dueToday, List<Task> dueTomorrow,
            List<Project> overdueProjects, List<Goal> overdueGoals, List<Notification> unread) {
        return """
            <!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;">
            <div style="background:#6366f1;padding:20px 24px;border-radius:8px 8px 0 0;">
              <h1 style="color:#fff;margin:0;font-size:20px;">📋 Daily Digest — %s</h1>
              <p style="color:rgba(255,255,255,.8);margin:4px 0 0;font-size:13px;">%s</p>
            </div>
            <div style="background:#fff;padding:24px;border-radius:0 0 8px 8px;">
              %s %s %s %s %s %s
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
              <p style="font-size:12px;color:#9ca3af;">
                <a href="" + frontendUrl + "" style="color:#6366f1;">Open Prowosma</a> ·
                Manage <a href="" + frontendUrl + "/workspace-settings" style="color:#6366f1;">digest preferences</a>
              </p>
            </div></body></html>
            """.formatted(wsName, now.format(DATE),
                taskSection("⚠️ Overdue Tasks", overdue, "#ef4444"),
                taskSection("📅 Due Today", dueToday, "#f59e0b"),
                taskSection("🔔 Due Tomorrow", dueTomorrow, "#3b82f6"),
                projectSection("📁 Overdue Projects", overdueProjects),
                goalSection("🎯 Overdue Goals", overdueGoals),
                notifSection("🔔 Unread Notifications", unread));
    }

    private String buildWeeklyHtml(String wsName, LocalDateTime now,
            List<Task> completed, List<Goal> atRisk, List<Task> overdue) {
        return """
            <!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;">
            <div style="background:#10b981;padding:20px 24px;border-radius:8px 8px 0 0;">
              <h1 style="color:#fff;margin:0;font-size:20px;">📊 Weekly Digest — %s</h1>
              <p style="color:rgba(255,255,255,.8);margin:4px 0 0;font-size:13px;">%s</p>
            </div>
            <div style="background:#fff;padding:24px;border-radius:0 0 8px 8px;">
              <div style="display:flex;gap:16px;margin-bottom:20px;">
                <div style="flex:1;text-align:center;padding:16px;background:#f0fdf4;border-radius:8px;">
                  <div style="font-size:28px;font-weight:800;color:#10b981;">%d</div>
                  <div style="font-size:12px;color:#6b7280;">Tasks completed</div>
                </div>
                <div style="flex:1;text-align:center;padding:16px;background:#fef2f2;border-radius:8px;">
                  <div style="font-size:28px;font-weight:800;color:#ef4444;">%d</div>
                  <div style="font-size:12px;color:#6b7280;">Overdue tasks</div>
                </div>
                <div style="flex:1;text-align:center;padding:16px;background:#fffbeb;border-radius:8px;">
                  <div style="font-size:28px;font-weight:800;color:#f59e0b;">%d</div>
                  <div style="font-size:12px;color:#6b7280;">Goals at risk</div>
                </div>
              </div>
              %s %s
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
              <p style="font-size:12px;color:#9ca3af;">
                <a href="" + frontendUrl + "" style="color:#6366f1;">Open Prowosma</a>
              </p>
            </div></body></html>
            """.formatted(wsName, now.format(DATE),
                completed.size(), overdue.size(), atRisk.size(),
                goalSection("🎯 Goals at Risk", atRisk),
                taskSection("📋 Recent Completions", completed, "#10b981"));
    }

    private String taskSection(String title, List<Task> tasks, String color) {
        if (tasks.isEmpty()) return "";
        StringBuilder sb = new StringBuilder();
        sb.append("<h3 style='color:").append(color).append(";font-size:14px;margin:16px 0 8px;'>")
          .append(title).append(" (").append(tasks.size()).append(")</h3><ul style='padding-left:16px;margin:0;'>");
        tasks.stream().limit(10).forEach(t ->
            sb.append("<li style='font-size:13px;color:#374151;padding:3px 0;'>")
              .append(t.getTitle()).append(" <span style='color:#9ca3af;font-size:11px;'>[")
              .append(t.getPriority()).append("]</span></li>"));
        if (tasks.size() > 10) sb.append("<li style='color:#9ca3af;font-size:12px;'>… and ")
            .append(tasks.size()-10).append(" more</li>");
        return sb.append("</ul>").toString();
    }

    private String goalSection(String title, List<Goal> goals) {
        if (goals.isEmpty()) return "";
        StringBuilder sb = new StringBuilder();
        sb.append("<h3 style='color:#f59e0b;font-size:14px;margin:16px 0 8px;'>")
          .append(title).append(" (").append(goals.size()).append(")</h3><ul style='padding-left:16px;margin:0;'>");
        goals.stream().limit(6).forEach(g ->
            sb.append("<li style='font-size:13px;color:#374151;padding:3px 0;'>")
              .append(g.getTitle()).append(" <span style='color:#f59e0b;font-size:11px;'>")
              .append(g.getConfidence()).append("% confidence</span></li>"));
        return sb.append("</ul>").toString();
    }

    private String projectSection(String title, List<Project> projects) {
        if (projects.isEmpty()) return "";
        StringBuilder sb = new StringBuilder();
        sb.append("<h3 style='color:#ef4444;font-size:14px;margin:16px 0 8px;'>")
          .append(title).append(" (").append(projects.size()).append(")</h3><ul style='padding-left:16px;margin:0;'>");
        projects.stream().limit(6).forEach(p ->
            sb.append("<li style='font-size:13px;color:#374151;padding:3px 0;'>")
              .append(p.getName()).append(" <span style='color:#9ca3af;font-size:11px;'>[")
              .append(p.getDueDate() != null ? p.getDueDate().toLocalDate() : "").append("]</span></li>"));
        return sb.append("</ul>").toString();
    }

    private String notifSection(String title, List<Notification> notifs) {
        if (notifs.isEmpty()) return "";
        StringBuilder sb = new StringBuilder();
        sb.append("<h3 style='color:#6366f1;font-size:14px;margin:16px 0 8px;'>")
          .append(title).append(" (").append(notifs.size()).append(")</h3><ul style='padding-left:16px;margin:0;'>");
        notifs.stream().limit(5).forEach(n ->
            sb.append("<li style='font-size:13px;color:#374151;padding:3px 0;'>")
              .append(n.getTitle()).append("</li>"));
        return sb.append("</ul>").toString();
    }

    private boolean isDailyEnabled(Workspace ws) {
        var prefs = ws.getNotifPrefs();
        return prefs == null || prefs.getOrDefault("dailyDigest", true);
    }
    private boolean isWeeklyEnabled(Workspace ws) {
        var prefs = ws.getNotifPrefs();
        return prefs == null || prefs.getOrDefault("weeklyDigest", false);
    }
}

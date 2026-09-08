package com.prowosma.backend.service;


import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.Goal;
import com.prowosma.backend.model.Project;
import com.prowosma.backend.model.Task;
import com.prowosma.backend.repository.GoalRepository;
import com.prowosma.backend.repository.ProjectRepository;
import com.prowosma.backend.repository.TaskRepository;
import com.prowosma.backend.repository.WorkspaceRepository;
import org.springframework.beans.factory.annotation.Value;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class ReminderService {

    @Value("${app.frontend.url:http://localhost:5173}")
    private String frontendUrl;


    private final TaskRepository taskRepository;
    private final ProjectRepository projectRepository;
    private final GoalRepository goalRepository;
    private final EmailService emailService;
    private final WorkspaceContext workspaceContext;
    private final WorkspaceRepository workspaceRepository;
    private static final DateTimeFormatter FMT =
            DateTimeFormatter.ofPattern("dd MMM yyyy HH:mm");

    public void sendDailyReminder() {
        LocalDateTime now = LocalDateTime.now();
        LocalDateTime tomorrow = now.plusDays(1);
        LocalDateTime endOfDay = now.toLocalDate().atTime(23, 59, 59);
        LocalDateTime startOfDay = now.toLocalDate().atStartOfDay();

        // Overdue tasks
        List<Task> overdue = taskRepository.findByOrganizationId(workspaceContext.getWorkspaceId()).stream()
                .filter(t -> t.getDueDate() != null
                        && t.getDueDate().isBefore(now)
                        && !"DONE".equals(t.getStatus()))
                .collect(Collectors.toList());

        // Today tasks
        List<Task> today = taskRepository.findByOrganizationId(workspaceContext.getWorkspaceId()).stream()
                .filter(t -> t.getDueDate() != null
                        && !t.getDueDate().isBefore(startOfDay)
                        && !t.getDueDate().isAfter(endOfDay))
                .collect(Collectors.toList());

        // Due tomorrow
        List<Task> dueTomorrow = taskRepository.findByOrganizationId(workspaceContext.getWorkspaceId()).stream()
                .filter(t -> t.getDueDate() != null
                        && t.getDueDate().isAfter(endOfDay)
                        && t.getDueDate().isBefore(tomorrow.toLocalDate().atTime(23, 59, 59))
                        && !"DONE".equals(t.getStatus()))
                .collect(Collectors.toList());

        // Overdue projects
        List<Project> overdueProjects = projectRepository.findByOrganizationId(workspaceContext.getWorkspaceId()).stream()
                .filter(p -> p.getDueDate() != null
                        && p.getDueDate().isBefore(now)
                        && !"DONE".equals(p.getStatus()))
                .collect(Collectors.toList());

        // Overdue goals
        List<Goal> overdueGoals = goalRepository.findByOrganizationId(workspaceContext.getWorkspaceId()).stream()
                .filter(g -> g.getTargetDate() != null
                        && g.getTargetDate().isBefore(now)
                        && !"ACHIEVED".equals(g.getStatus()))
                .collect(Collectors.toList());

        if (overdue.isEmpty() && today.isEmpty() && dueTomorrow.isEmpty()
                && overdueProjects.isEmpty() && overdueGoals.isEmpty()) return;

        StringBuilder body = new StringBuilder();
        body.append("ProjectsNGoals - Daily Reminder\n");
        body.append("=".repeat(40)).append("\n\n");
        body.append("Date: ").append(now.format(FMT)).append("\n\n");

        if (!overdue.isEmpty()) {
            body.append("⚠️ OVERDUE TASKS (").append(overdue.size()).append(")\n");
            body.append("-".repeat(30)).append("\n");
            overdue.forEach(t -> body.append("• ").append(t.getTitle())
                    .append(" [").append(t.getPriority()).append("]")
                    .append(" - Due: ").append(t.getDueDate().format(FMT)).append("\n"));
            body.append("\n");
        }

        if (!today.isEmpty()) {
            body.append("📅 DUE TODAY (").append(today.size()).append(")\n");
            body.append("-".repeat(30)).append("\n");
            today.forEach(t -> body.append("• ").append(t.getTitle())
                    .append(" [").append(t.getStatus()).append("]").append("\n"));
            body.append("\n");
        }

        if (!dueTomorrow.isEmpty()) {
            body.append("🔔 DUE TOMORROW (").append(dueTomorrow.size()).append(")\n");
            body.append("-".repeat(30)).append("\n");
            dueTomorrow.forEach(t -> body.append("• ").append(t.getTitle())
                    .append(" [").append(t.getPriority()).append("]").append("\n"));
            body.append("\n");
        }

        if (!overdueProjects.isEmpty()) {
            body.append("📁 OVERDUE PROJECTS (").append(overdueProjects.size()).append(")\n");
            body.append("-".repeat(30)).append("\n");
            overdueProjects.forEach(p -> body.append("• ").append(p.getName())
                    .append(" - Due: ").append(p.getDueDate().format(FMT)).append("\n"));
            body.append("\n");
        }

        if (!overdueGoals.isEmpty()) {
            body.append("🎯 OVERDUE GOALS (").append(overdueGoals.size()).append(")\n");
            body.append("-".repeat(30)).append("\n");
            overdueGoals.forEach(g -> body.append("• ").append(g.getTitle())
                    .append(" - Target: ").append(g.getTargetDate().format(FMT)).append("\n"));
            body.append("\n");
        }

        body.append("=".repeat(40)).append("\n");
        body.append("Visit your dashboard: " + frontendUrl + "\n");

        // EmailService has no plain-text sendReminder() — this digest was
        // built as plain text throughout, so wrap it in <pre> rather than
        // rewrite it as HTML. Recipient: the workspace owner, resolved the
        // same way OwnershipService/WorkspaceService do elsewhere.
        workspaceRepository.findById(workspaceContext.getWorkspaceId()).ifPresent(ws -> {
            if (ws.getOwnerEmail() == null || ws.getOwnerEmail().isBlank()) return;
            String html = "<pre style=\"font-family:monospace;white-space:pre-wrap;\">"
                    + body.toString()
                        .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                    + "</pre>";
            emailService.sendHtmlEmail(ws.getOwnerEmail(), "Workspace Owner",
                    "📋 ProjectsNGoals Daily Reminder - " + now.toLocalDate(), html);
        });
    }
}

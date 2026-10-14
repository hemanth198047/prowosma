package com.prowosma.backend.controller;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.AISettings;
import com.prowosma.backend.model.Goal;
import com.prowosma.backend.model.Project;
import com.prowosma.backend.model.Task;
import com.prowosma.backend.repository.GoalRepository;
import com.prowosma.backend.repository.ProjectRepository;
import com.prowosma.backend.repository.TaskRepository;
import com.prowosma.backend.service.*;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/ai")
@RequiredArgsConstructor
public class AIController {

    private final AIService aiService;
    private final AISettingsService aiSettingsService;
    private final TaskRepository taskRepository;
    private final ProjectRepository projectRepository;
    private final GoalRepository goalRepository;
    private final TaskService taskService;
    private final NotificationService notificationService;
    private final WorkspaceContext workspaceContext;

    // ── Settings ──────────────────────────────────────────────

    // The API key is never returned (see AISettingsService.view); changing any of this is admin-only (RoleGuardFilter).
    @GetMapping("/settings")
    public Map<String, Object> getSettings() {
        return aiSettingsService.view(aiSettingsService.get());
    }

    /**
     * Is AI on? Safe for everyone signed in: yes/no facts only — never the API key (unlike /settings, which returns the whole record).
     * The top-bar badge reads this.
     */
    @GetMapping("/status")
    public Map<String, Object> status() {
        return com.prowosma.backend.service.AIStatus.of(aiSettingsService.get());
    }

    @PostMapping("/settings")
    public Map<String, Object> saveSettings(@RequestBody AISettings settings) {
        return aiSettingsService.view(aiSettingsService.save(settings));
    }

    @PatchMapping("/settings/toggle")
    public Map<String, Object> toggleAI(@RequestBody Map<String, Boolean> body) {
        return aiSettingsService.view(aiSettingsService.toggleAI(Boolean.TRUE.equals(body.get("enabled"))));
    }

    @PatchMapping("/settings/features/{key}")
    public Map<String, Object> toggleFeature(@PathVariable String key) {
        return aiSettingsService.view(aiSettingsService.toggleFeature(key));
    }

    // ── AI-1: Task Assistant ───────────────────────────────────

    @PostMapping("/task-assistant")
    public Map<String, Object> generateTasks(@RequestBody Map<String, String> body) {
        if (!aiService.isEnabled("task_assistant"))
            return Map.of("error", "Task Assistant is not enabled");
        String projectDesc = body.get("description");
        String projectName = body.getOrDefault("projectName", "Project");
        String prompt = """
            You are a project manager. Generate a list of tasks for the following project.
            Return ONLY a JSON array of task objects with fields:
            title (string), description (string), priority (LOW/MEDIUM/HIGH), estimatedMinutes (number)
            No extra text, just the JSON array.
            """;
        List tasks = aiService.askJson(prompt,
                "Project: " + projectName + "\nDescription: " + projectDesc, List.class);
        return Map.of("tasks", tasks);
    }

    // ── AI-2: Goal Advisor ─────────────────────────────────────

    @PostMapping("/goal-advisor")
    public Map<String, Object> adviseGoal(@RequestBody Map<String, String> body) {
        if (!aiService.isEnabled("goal_advisor"))
            return Map.of("error", "Goal Advisor is not enabled");
        String goalTitle = body.get("title");
        String goalDesc = body.getOrDefault("description", "");
        String prompt = """
            You are a life coach and goal strategist. Given a goal, suggest sub-goals and steps.
            Return ONLY a JSON object with:
            { "subGoals": [ { "title": string, "description": string, "steps": [{"title": string}] } ] }
            No extra text, just JSON.
            """;
        Map result = aiService.askJson(prompt,
                "Goal: " + goalTitle + "\nDescription: " + goalDesc, Map.class);
        return result;
    }

    // ── AI-3 & AI-9: Smart Prioritization Engine ──────────────

    @PostMapping("/prioritize")
    public Map<String, Object> prioritizeTasks(@RequestBody Map<String, Object> body) {
        if (!aiService.isEnabled("prioritization"))
            return Map.of("error", "Prioritization Engine is not enabled");
        List<Task> tasks = taskRepository.findByOrganizationId(workspaceContext.getWorkspaceId(), org.springframework.data.domain.PageRequest.of(0, 2000)).getContent().stream()
                .filter(t -> !"DONE".equals(t.getStatus())).toList();
        if (tasks.isEmpty()) return Map.of("message", "No tasks to prioritize");
        StringBuilder taskList = new StringBuilder();
        tasks.forEach(t -> taskList.append("- ID:").append(t.getId())
                .append(" | Title:").append(t.getTitle())
                .append(" | Priority:").append(t.getPriority())
                .append(" | Status:").append(t.getStatus())
                .append(" | DueDate:").append(t.getDueDate() != null ? t.getDueDate().toString() : "none")
                .append(" | Blockers:").append(t.getBlockedByTaskIds() != null ? t.getBlockedByTaskIds().size() : 0)
                .append("\n"));
        String prompt = """
            You are a productivity expert. Analyze these tasks and suggest optimal priority order.
            Return ONLY a JSON object:
            { "prioritized": [{"id": string, "title": string, "suggestedPriority": "HIGH/MEDIUM/LOW", "reason": string}],
              "insights": string }
            """;
        Map result = aiService.askJson(prompt, "Tasks:\n" + taskList, Map.class);
        return result;
    }

    // ── AI-4: Daily Digest ─────────────────────────────────────

    @GetMapping("/daily-digest")
    public Map<String, Object> getDailyDigest() {
        if (!aiService.isEnabled("daily_digest"))
            return Map.of("error", "Daily Digest is not enabled");
        List<Task> allTasks = taskRepository.findByOrganizationId(workspaceContext.getWorkspaceId(), org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();
        List<Task> overdue = allTasks.stream()
                .filter(t -> t.getDueDate() != null && t.getDueDate().isBefore(LocalDateTime.now())
                        && !"DONE".equals(t.getStatus())).toList();
        List<Task> today = allTasks.stream()
                .filter(t -> t.getDueDate() != null
                        && t.getDueDate().toLocalDate().equals(LocalDateTime.now().toLocalDate()))
                .toList();
        long done = allTasks.stream().filter(t -> "DONE".equals(t.getStatus())).count();
        long inProgress = allTasks.stream().filter(t -> "IN_PROGRESS".equals(t.getStatus())).count();
        String context = String.format(
                "Total tasks: %d, Done: %d, In Progress: %d, Overdue: %d, Due Today: %d",
                allTasks.size(), done, inProgress, overdue.size(), today.size());
        String prompt = """
            You are a productivity coach. Based on the task data, generate an encouraging
            and actionable daily digest. Include: summary, top 3 priorities for today,
            motivational message, and one productivity tip.
            Return as JSON: { "summary": string, "priorities": [string], "motivation": string, "tip": string }
            """;
        Map result = aiService.askJson(prompt, context, Map.class);
        notificationService.create("📊 Daily AI Digest Ready",
                "Your AI digest has been generated", "INFO", "TASK", null);
        return result;
    }

    // ── AI-5: Goal→Project→Task Breakdown ─────────────────────

    @PostMapping("/breakdown")
    public Map<String, Object> breakdown(@RequestBody Map<String, String> body) {
        if (!aiService.isEnabled("breakdown"))
            return Map.of("error", "AI Breakdown is not enabled");
        String goal = body.get("goal");
        String timeframe = body.getOrDefault("timeframe", "3 months");
        String prompt = """
            You are a strategic planner. Break down a goal into projects and tasks.
            Return ONLY JSON:
            { "goal": string, "projects": [
              { "name": string, "description": string, "tasks": [
                { "title": string, "priority": "HIGH/MEDIUM/LOW", "estimatedMinutes": number }
              ]}
            ]}
            """;
        Map result = aiService.askJson(prompt,
                "Goal: " + goal + "\nTimeframe: " + timeframe, Map.class);
        return result;
    }

    // ── AI-8: Smart Scheduling ─────────────────────────────────

    @PostMapping("/schedule")
    public Map<String, Object> schedule(@RequestBody Map<String, Object> body) {
        if (!aiService.isEnabled("scheduling"))
            return Map.of("error", "Smart Scheduling is not enabled");
        List<Task> tasks = taskRepository.findByOrganizationId(workspaceContext.getWorkspaceId(), org.springframework.data.domain.PageRequest.of(0, 2000)).getContent().stream()
                .filter(t -> !"DONE".equals(t.getStatus())).collect(Collectors.toList());
        String workHours = (String) body.getOrDefault("workHours", "9-17");
        String startDate = (String) body.getOrDefault("startDate",
                LocalDateTime.now().toLocalDate().toString());
        StringBuilder taskList = new StringBuilder();
        tasks.forEach(t -> taskList.append("- ").append(t.getTitle())
                .append(" | Priority:").append(t.getPriority())
                .append(" | Est:").append(t.getDueDate() != null ? t.getDueDate() : "flexible")
                .append("\n"));
        String prompt = """
            You are a scheduling expert. Create an optimal daily schedule for these tasks.
            Return ONLY JSON:
            { "schedule": [{ "date": string, "tasks": [{"title": string, "timeSlot": string, "duration": string}] }],
              "advice": string }
            """;
        Map result = aiService.askJson(prompt,
                "Work hours: " + workHours + "\nStart: " + startDate + "\nTasks:\n" + taskList, Map.class);
        return result;
    }

    // ── AI-10: Weekly Planning ─────────────────────────────────

    @GetMapping("/weekly-plan")
    public Map<String, Object> weeklyPlan() {
        if (!aiService.isEnabled("weekly_planning"))
            return Map.of("error", "Weekly Planning is not enabled");
        List<Task> tasks = taskRepository.findByOrganizationId(workspaceContext.getWorkspaceId(), org.springframework.data.domain.PageRequest.of(0, 2000)).getContent().stream()
                .filter(t -> !"DONE".equals(t.getStatus())).toList();
        List<Project> projects = projectRepository.findByOrganizationId(workspaceContext.getWorkspaceId(), org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();
        StringBuilder context = new StringBuilder();
        context.append("Active Tasks: ").append(tasks.size()).append("\n");
        tasks.stream().limit(20).forEach(t -> context.append("- ")
                .append(t.getTitle()).append(" [").append(t.getPriority()).append("]\n"));
        context.append("Projects: ").append(projects.size()).append("\n");
        String prompt = """
            You are a weekly planning coach. Create a structured weekly plan.
            Return ONLY JSON:
            { "weekOf": string, "monday": [string], "tuesday": [string], "wednesday": [string],
              "thursday": [string], "friday": [string], "goals": [string], "advice": string }
            """;
        Map result = aiService.askJson(prompt, context.toString(), Map.class);
        return result;
    }

    // ── AI-12: Task Estimation ─────────────────────────────────

    @PostMapping("/estimate")
    public Map<String, Object> estimate(@RequestBody Map<String, String> body) {
        if (!aiService.isEnabled("estimation"))
            return Map.of("error", "Task Estimation is not enabled");
        String taskTitle = body.get("title");
        String taskDesc = body.getOrDefault("description", "");
        String prompt = """
            You are an experienced software project manager. Estimate task effort.
            Return ONLY JSON:
            { "optimistic": number, "realistic": number, "pessimistic": number,
              "unit": "minutes", "confidence": "LOW/MEDIUM/HIGH", "reasoning": string,
              "breakdown": [{"step": string, "minutes": number}] }
            """;
        Map result = aiService.askJson(prompt,
                "Task: " + taskTitle + "\nDescription: " + taskDesc, Map.class);
        return result;
    }

    // ── AI-13: Daily Standup ───────────────────────────────────

    @GetMapping("/standup")
    public Map<String, Object> standup() {
        if (!aiService.isEnabled("standup"))
            return Map.of("error", "Daily Standup is not enabled");
        List<Task> allTasks = taskRepository.findByOrganizationId(workspaceContext.getWorkspaceId(), org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();
        List<Task> inProgress = allTasks.stream()
                .filter(t -> "IN_PROGRESS".equals(t.getStatus())).toList();
        List<Task> done = allTasks.stream()
                .filter(t -> "DONE".equals(t.getStatus())
                        && t.getUpdatedAt() != null
                        && t.getUpdatedAt().isAfter(LocalDateTime.now().minusDays(1)))
                .toList();
        List<Task> blocked = allTasks.stream()
                .filter(t -> t.getBlockedByTaskIds() != null && !t.getBlockedByTaskIds().isEmpty())
                .toList();
        StringBuilder context = new StringBuilder();
        context.append("Done yesterday: ").append(done.size()).append(" tasks\n");
        context.append("In Progress: ").append(inProgress.size()).append(" tasks\n");
        context.append("Blocked: ").append(blocked.size()).append(" tasks\n");
        done.stream().limit(5).forEach(t -> context.append("Done: ").append(t.getTitle()).append("\n"));
        inProgress.stream().limit(5).forEach(t -> context.append("Doing: ").append(t.getTitle()).append("\n"));
        String prompt = """
            Generate a concise daily standup report.
            Return ONLY JSON:
            { "yesterday": string, "today": string, "blockers": string,
              "mood": "🟢 On Track / 🟡 At Risk / 🔴 Behind",
              "suggestion": string }
            """;
        Map result = aiService.askJson(prompt, context.toString(), Map.class);
        return result;
    }

    // ── AI-14: Smart Dependency Detection ─────────────────────

    @GetMapping("/detect-dependencies")
    public Map<String, Object> detectDependencies() {
        if (!aiService.isEnabled("dependency_detection"))
            return Map.of("error", "Dependency Detection is not enabled");
        List<Task> tasks = taskRepository.findByOrganizationId(workspaceContext.getWorkspaceId(), org.springframework.data.domain.PageRequest.of(0, 2000)).getContent().stream()
                .filter(t -> !"DONE".equals(t.getStatus())).toList();
        if (tasks.size() < 2) return Map.of("dependencies", List.of(), "message", "Need at least 2 tasks");
        StringBuilder taskList = new StringBuilder();
        tasks.stream().limit(30).forEach(t -> taskList.append("ID:").append(t.getId())
                .append(" Title:").append(t.getTitle()).append("\n"));
        String prompt = """
            Analyze these tasks and detect logical dependencies.
            Return ONLY JSON:
            { "dependencies": [{"taskId": string, "dependsOnId": string,
              "reason": string, "confidence": "HIGH/MEDIUM/LOW"}] }
            """;
        return aiService.askJson(prompt, taskList.toString(), Map.class);
    }

    // ── AI-15: Risk Detection ──────────────────────────────────

    @GetMapping("/risks")
    public Map<String, Object> detectRisks() {
        if (!aiService.isEnabled("risk_detection"))
            return Map.of("error", "Risk Detection is not enabled");
        List<Task> overdue = taskRepository.findByOrganizationId(workspaceContext.getWorkspaceId(), org.springframework.data.domain.PageRequest.of(0, 2000)).getContent().stream()
                .filter(t -> t.getDueDate() != null && t.getDueDate().isBefore(LocalDateTime.now())
                        && !"DONE".equals(t.getStatus())).toList();
        List<Project> projects = projectRepository.findByOrganizationId(workspaceContext.getWorkspaceId(), org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();
        StringBuilder context = new StringBuilder();
        context.append("Overdue tasks: ").append(overdue.size()).append("\n");
        context.append("Total projects: ").append(projects.size()).append("\n");
        overdue.forEach(t -> context.append("Overdue: ").append(t.getTitle())
                .append(" since ").append(t.getDueDate()).append("\n"));
        String prompt = """
            You are a risk analyst. Identify project risks and mitigation strategies.
            Return ONLY JSON:
            { "risks": [{"title": string, "severity": "HIGH/MEDIUM/LOW",
              "description": string, "mitigation": string}],
              "overallRisk": "HIGH/MEDIUM/LOW", "summary": string }
            """;
        Map result = aiService.askJson(prompt, context.toString(), Map.class);
        return result;
    }

    // ── AI-16: Natural Language Task Creation ─────────────────

    @PostMapping("/natural-task")
    public Map<String, Object> naturalTask(@RequestBody Map<String, String> body) {
        if (!aiService.isEnabled("natural_language"))
            return Map.of("error", "Natural Language Creation is not enabled");
        String input = body.get("text");
        String prompt = """
            Extract task details from natural language input.
            Return ONLY JSON:
            { "title": string, "description": string, "priority": "LOW/MEDIUM/HIGH",
              "dueDate": "ISO date or null", "tags": [string], "estimatedMinutes": number }
            """;
        Map result = aiService.askJson(prompt, "Input: " + input, Map.class);
        return result;
    }

    // ── AI-17: Meeting Notes → Tasks ──────────────────────────

    @PostMapping("/meeting-notes")
    public Map<String, Object> meetingNotes(@RequestBody Map<String, String> body) {
        if (!aiService.isEnabled("meeting_notes"))
            return Map.of("error", "Meeting Notes is not enabled");
        String notes = body.get("notes");
        String prompt = """
            Extract action items and tasks from meeting notes.
            Return ONLY JSON:
            { "tasks": [{"title": string, "assignee": string, "priority": "LOW/MEDIUM/HIGH",
              "dueDate": string, "description": string}],
              "summary": string, "decisions": [string] }
            """;
        Map result = aiService.askJson(prompt, "Meeting Notes:\n" + notes, Map.class);
        return result;
    }

    // ── AI-19: Focus Mode ──────────────────────────────────────

    @GetMapping("/focus-mode")
    public Map<String, Object> focusMode() {
        if (!aiService.isEnabled("focus_mode"))
            return Map.of("error", "Focus Mode is not enabled");
        List<Task> tasks = taskRepository.findByOrganizationId(workspaceContext.getWorkspaceId(), org.springframework.data.domain.PageRequest.of(0, 2000)).getContent().stream()
                .filter(t -> !"DONE".equals(t.getStatus())).toList();
        StringBuilder taskList = new StringBuilder();
        tasks.stream().limit(20).forEach(t -> taskList.append("- ").append(t.getTitle())
                .append(" [").append(t.getPriority()).append("]\n"));
        String prompt = """
            You are a focus coach. Select the ONE most important task to focus on right now.
            Return ONLY JSON:
            { "focusTask": string, "reason": string, "duration": string,
              "technique": string, "nextTask": string, "motivationalMessage": string }
            """;
        return aiService.askJson(prompt, "Tasks:\n" + taskList, Map.class);
    }

    // ── AI-20: Deadline Negotiator ─────────────────────────────

    @PostMapping("/deadline-negotiator")
    public Map<String, Object> negotiateDeadline(@RequestBody Map<String, String> body) {
        if (!aiService.isEnabled("deadline_negotiator"))
            return Map.of("error", "Deadline Negotiator is not enabled");
        String taskTitle = body.get("title");
        String currentDeadline = body.get("deadline");
        String reason = body.getOrDefault("reason", "");
        String prompt = """
            You are a deadline negotiation expert. Suggest realistic deadline options.
            Return ONLY JSON:
            { "originalDeadline": string, "suggestedDeadlines": [
              {"date": string, "label": string, "rationale": string}],
              "recommendation": string, "riskIfExtended": string }
            """;
        Map result = aiService.askJson(prompt,
                "Task: " + taskTitle + "\nDeadline: " + currentDeadline + "\nReason: " + reason, Map.class);
        return result;
    }

    // ── AI-22: Burnout Detection ───────────────────────────────

    @GetMapping("/burnout-check")
    public Map<String, Object> burnoutCheck() {
        if (!aiService.isEnabled("burnout_detection"))
            return Map.of("error", "Burnout Detection is not enabled");
        List<Task> tasks = taskRepository.findByOrganizationId(workspaceContext.getWorkspaceId(), org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();
        long overdue = tasks.stream().filter(t -> t.getDueDate() != null
                && t.getDueDate().isBefore(LocalDateTime.now())
                && !"DONE".equals(t.getStatus())).count();
        long highPriority = tasks.stream().filter(t -> "HIGH".equals(t.getPriority())
                && !"DONE".equals(t.getStatus())).count();
        long inProgress = tasks.stream().filter(t -> "IN_PROGRESS".equals(t.getStatus())).count();
        String context = String.format(
                "Overdue: %d, High Priority Pending: %d, In Progress simultaneously: %d, Total Pending: %d",
                overdue, highPriority, inProgress,
                tasks.stream().filter(t -> !"DONE".equals(t.getStatus())).count());
        String prompt = """
            You are a wellbeing coach. Assess burnout risk based on workload data.
            Return ONLY JSON:
            { "burnoutRisk": "LOW/MEDIUM/HIGH/CRITICAL",
              "indicators": [string], "recommendations": [string],
              "immediateAction": string, "message": string }
            """;
        Map result = aiService.askJson(prompt, context, Map.class);
        return result;
    }

    // ── AI-23: Knowledge Assistant ─────────────────────────────

    @PostMapping("/ask")
    public Map<String, Object> ask(@RequestBody Map<String, String> body) {
        if (!aiService.isEnabled("knowledge_assistant"))
            return Map.of("error", "Knowledge Assistant is not enabled");
        String question = body.get("question");
        List<Task> tasks = taskRepository.findByOrganizationId(workspaceContext.getWorkspaceId(), org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();
        List<Project> projects = projectRepository.findByOrganizationId(workspaceContext.getWorkspaceId(), org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();
        List<Goal> goals = goalRepository.findByOrganizationId(workspaceContext.getWorkspaceId(), org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();
        String context = String.format(
                "Projects: %d, Tasks: %d (Done: %d), Goals: %d",
                projects.size(), tasks.size(),
                tasks.stream().filter(t -> "DONE".equals(t.getStatus())).count(),
                goals.size());
        String prompt = """
            You are a helpful project management assistant for Prowosma app.
            Answer questions about the user's projects, tasks and goals concisely.
            Return ONLY JSON: { "answer": string, "suggestions": [string] }
            """;
        return aiService.askJson(prompt,
                "Context: " + context + "\nQuestion: " + question, Map.class);
    }

    // ── AI-24: Chat Assistant ──────────────────────────────────

    @PostMapping("/chat")
    public Map<String, Object> chat(@RequestBody Map<String, Object> body) {
        if (!aiService.isEnabled("chat_assistant"))
            return Map.of("error", "Chat Assistant is not enabled");
        String message = (String) body.get("message");
        List<Map<String, String>> history = (List<Map<String, String>>) body.getOrDefault("history", List.of());
        List<Task> tasks = taskRepository.findByOrganizationId(workspaceContext.getWorkspaceId(), org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();
        List<Project> projects = projectRepository.findByOrganizationId(workspaceContext.getWorkspaceId(), org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();
        String context = String.format("Projects: %d, Tasks: %d", projects.size(), tasks.size());
        // Extract userName from top-level OR from nested context map
        String userName = (String) body.getOrDefault("userName", null);
        if (userName == null || userName.isBlank()) {
            Map<String, Object> ctx = (Map<String, Object>) body.get("context");
            if (ctx != null) userName = (String) ctx.getOrDefault("userName", null);
        }
        if (userName == null || userName.isBlank()) userName = "there";
        String userFullName = (String) body.getOrDefault("userFullName", userName);

        // Build richer context string
        String richContext = String.format(
            "User: %s | Page: %s | Projects: %d active | Tasks: %d total",
            userFullName,
            body.getOrDefault("context", Map.of()) instanceof Map ctxMap
                ? ctxMap.getOrDefault("page", "App") : "App",
            projects.size(),
            tasks.size()
        );

        String systemPrompt = """
    You are an AI assistant for Prowosma, a project management platform.
    IMPORTANT: The user's name is %s. ALWAYS address them as %s — never as "User".
    You have access to their workspace data: %s.
    Be concise, warm, and actionable. Use their name naturally in responses.
    When referencing their data, be specific about counts and names.
    """.formatted(userName, userName, richContext);
        String response = aiService.ask(systemPrompt, message);
        return Map.of("response", response, "timestamp", LocalDateTime.now().toString());
    }

    // ── AI-25: Habit Failure Prediction ───────────────────────

    @GetMapping("/predict-risks")
    public Map<String, Object> predictRisks() {
        if (!aiService.isEnabled("predictive_planning"))
            return Map.of("error", "Predictive Planning is not enabled");
        List<Task> tasks = taskRepository.findByOrganizationId(workspaceContext.getWorkspaceId(), org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();
        List<Project> projects = projectRepository.findByOrganizationId(workspaceContext.getWorkspaceId(), org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();
        long overdueCount = tasks.stream().filter(t -> t.getDueDate() != null
                && t.getDueDate().isBefore(LocalDateTime.now())
                && !"DONE".equals(t.getStatus())).count();
        long blockedCount = tasks.stream().filter(t ->
                t.getBlockedByTaskIds() != null && !t.getBlockedByTaskIds().isEmpty()).count();
        String context = String.format(
                "Total tasks: %d, Overdue: %d, Blocked: %d, Projects: %d",
                tasks.size(), overdueCount, blockedCount, projects.size());
        String prompt = """
            Predict upcoming risks and failure patterns based on project data.
            Return ONLY JSON:
            { "predictions": [{"risk": string, "probability": "LOW/MEDIUM/HIGH",
              "timeframe": string, "prevention": string}],
              "trend": string, "recommendation": string }
            """;
        Map result = aiService.askJson(prompt, context, Map.class);
        return result;
    }

    // ── AI-26: Team Performance Insights ──────────────────────

    @GetMapping("/team-insights")
    public Map<String, Object> teamInsights() {
        if (!aiService.isEnabled("team_insights"))
            return Map.of("error", "Team Insights is not enabled");
        List<Task> tasks = taskRepository.findByOrganizationId(workspaceContext.getWorkspaceId(), org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();
        Map<String, Long> byAssignee = new java.util.HashMap<>();
        tasks.forEach(t -> {
            if (t.getAssigneeIds() != null) {
                t.getAssigneeIds().forEach(id -> byAssignee.merge(id, 1L, Long::sum));
            }
        });
        String prompt = """
            Analyze team workload and performance patterns.
            Return ONLY JSON:
            { "insights": [string], "workloadBalance": string,
              "recommendations": [string], "teamHealth": "GOOD/FAIR/POOR",
              "summary": string }
            """;
        Map result = aiService.askJson(prompt,
                "Assignee task counts: " + byAssignee.toString(), Map.class);
        return result;
    }

    // ── AI: Meeting Notes Extractor ────────────────────────────
    // POST /api/ai/extract-meeting
    // Takes raw notes/transcript, returns summary + action items

    @PostMapping("/extract-meeting")
    public Map<String, Object> extractMeeting(@RequestBody Map<String, String> body) {
        String notes = body.getOrDefault("notes", "");
        if (notes.isBlank()) return Map.of("error", "Notes are empty");

        String prompt = """
            You are a meeting facilitator assistant. Analyse the following meeting notes or transcript.
            Extract the key information and return ONLY a JSON object with exactly this structure:
            {
              "summary": "2-4 sentence summary of what was discussed and decided",
              "decisions": ["decision 1", "decision 2"],
              "actionItems": [
                {
                  "title": "Clear action item title (start with a verb)",
                  "assignee": "person name or email if mentioned, else empty string",
                  "dueDate": "YYYY-MM-DD if mentioned, else empty string",
                  "priority": "HIGH or MEDIUM or LOW based on urgency language"
                }
              ]
            }
            Return ONLY the JSON. No markdown, no explanation, no code fences.
            """;

        Map result = aiService.askJson(prompt, "Meeting notes:\n" + notes, Map.class);
        if (result == null) return Map.of("error", "AI extraction failed");
        return result;
    }


    // ── A-11: POST /api/ai/write — AI block writing assistant ─────────────
    @PostMapping("/write")
    public Map<String, Object> write(@RequestBody Map<String, String> body) {
        if (!aiService.isEnabled("knowledge_assistant"))
            return Map.of("error", "AI not enabled");
        String prompt = body.getOrDefault("prompt", "");
        if (prompt.isBlank()) return Map.of("error", "Prompt is empty");

        String systemPrompt = """
            You are a professional writing assistant inside a knowledge base editor.
            The user will give you a writing instruction (e.g. 'Summarize the risks',
            'Draft a meeting agenda', 'Write an intro paragraph about X').
            Respond with only the written text — no preamble, no markdown fences,
            no explanation. Write clearly and professionally in plain text.
            Keep response concise (1-3 paragraphs unless the prompt asks for more).
            """;

        String text = aiService.ask(systemPrompt, prompt);
        return Map.of("data", text != null ? text : "");
    }



    // C-8: Executive intelligence summary
    @GetMapping("/executive-summary")
    public Map<String, Object> executiveSummary() {
        String orgId = workspaceContext.getWorkspaceId();
        List<com.prowosma.backend.model.Project> projects = projectRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();
        List<com.prowosma.backend.model.Task>    tasks    = taskRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();
        List<com.prowosma.backend.model.Goal>    goals    = goalRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();

        long total     = tasks.size();
        long done      = tasks.stream().filter(t -> "DONE".equals(t.getStatus())).count();
        long inProg    = tasks.stream().filter(t -> "IN_PROGRESS".equals(t.getStatus())).count();
        long overdue   = tasks.stream().filter(t ->
            t.getDueDate() != null && t.getDueDate().isBefore(java.time.LocalDateTime.now())
            && !"DONE".equals(t.getStatus())).count();
        long atRiskGoals = goals.stream().filter(g -> g.getConfidence() < 50).count();

        String summary = String.format(
            "Portfolio health overview: %d projects active, %d/%d tasks complete (%d%%), " +
            "%d tasks overdue. %d goals active with %d at risk (confidence <50%%). " +
            "%s " +
            "Recommendation: %s",
            projects.size(), done, total, total>0 ? done*100/total : 0,
            overdue, goals.size(), atRiskGoals,
            overdue > 0
                ? "Overdue tasks require immediate attention."
                : "No overdue tasks — good execution velocity.",
            atRiskGoals > 0
                ? "Review at-risk goals and increase check-in frequency."
                : "All goals on track — maintain current momentum."
        );

        List<String> keyRisks = new ArrayList<>();
        if (overdue > 0) keyRisks.add(overdue + " overdue tasks");
        if (atRiskGoals > 0) keyRisks.add(atRiskGoals + " goals below 50% confidence");
        projects.stream().filter(p -> "PAUSED".equals(p.getStatus())).findFirst()
            .ifPresent(p -> keyRisks.add("Project '" + p.getName() + "' is paused"));

        List<String> recommendations = new ArrayList<>();
        if (overdue > 5) recommendations.add("Run a sprint retrospective to address task backlog");
        if (atRiskGoals > 0) recommendations.add("Schedule goal review meeting this week");
        if (done > 0 && total > 0 && done * 100 / total > 80)
            recommendations.add("Strong completion rate — consider expanding team capacity");

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("summary",         summary);
        result.put("keyRisks",        keyRisks);
        result.put("recommendations", recommendations);
        result.put("stats", Map.of(
            "totalProjects", projects.size(),
            "totalTasks",    total,
            "completedTasks",done,
            "overdueTasks",  overdue,
            "totalGoals",    goals.size(),
            "atRiskGoals",   atRiskGoals
        ));
        return result;
    }


    // D-1: Predictive delay detection
    @GetMapping("/predict-delays")
    public Map<String, Object> predictDelays() {
        String orgId = workspaceContext.getWorkspaceId();
        List<Task> tasks = taskRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();
        java.time.LocalDateTime now = java.time.LocalDateTime.now();

        List<Map<String, Object>> atRisk = new ArrayList<>();
        for (Task t : tasks) {
            if ("DONE".equals(t.getStatus()) || t.getDueDate() == null) continue;
            long daysLeft = java.time.temporal.ChronoUnit.DAYS.between(now, t.getDueDate());
            boolean hasBlockers = t.getBlockedByTaskIds() != null && !t.getBlockedByTaskIds().isEmpty();
            boolean overdue     = t.getDueDate().isBefore(now);
            boolean slippingRisk= daysLeft <= 3 && "TODO".equals(t.getStatus());

            if (overdue || (hasBlockers && daysLeft <= 7) || slippingRisk) {
                Map<String, Object> risk = new LinkedHashMap<>();
                risk.put("taskId",    t.getId());
                risk.put("taskTitle", t.getTitle());
                risk.put("daysLeft",  daysLeft);
                risk.put("isOverdue", overdue);
                risk.put("hasBlockers", hasBlockers);
                risk.put("severity",  overdue ? "HIGH" : daysLeft <= 1 ? "HIGH" : "MEDIUM");
                risk.put("reason",    overdue ? "Already overdue"
                    : hasBlockers ? "Has unresolved dependencies"
                    : "Due in " + daysLeft + " days with no progress");
                atRisk.add(risk);
            }
        }
        atRisk.sort((a,b) -> ((String)a.get("severity")).compareTo((String)b.get("severity")));
        return Map.of("delayRisks", atRisk, "count", atRisk.size(),
            "summary", atRisk.isEmpty()
                ? "No delay risks detected — all tasks are on track"
                : atRisk.size() + " task(s) are at risk of delay");
    }

    // D-2: Goal failure prediction
    @GetMapping("/goal-failure-prediction")
    public Map<String, Object> goalFailurePrediction() {
        String orgId = workspaceContext.getWorkspaceId();
        List<Goal> goals = goalRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();

        List<Map<String, Object>> predictions = new ArrayList<>();
        for (Goal g : goals) {
            if (!"ACTIVE".equals(g.getStatus())) continue;
            int conf  = g.getConfidence() != 0 ? g.getConfidence() : 50;
            int prog  = g.getProgress();
            int checkInCount = g.getCheckIns() != null ? g.getCheckIns().size() : 0;

            // Trend: declining confidence?
            String trend = "STABLE";
            if (g.getConfidenceHistory() != null && g.getConfidenceHistory().size() >= 2) {
                int recent = g.getConfidenceHistory().get(0).getValue();
                int older  = g.getConfidenceHistory().get(Math.min(2, g.getConfidenceHistory().size()-1)).getValue();
                if (recent < older - 10) trend = "DECLINING";
                else if (recent > older + 5) trend = "IMPROVING";
            }

            String failureRisk = conf < 30 ? "HIGH"
                : (conf < 50 && "DECLINING".equals(trend)) ? "HIGH"
                : conf < 50 ? "MEDIUM"
                : "LOW";

            String reasoning = conf < 30
                ? "Very low confidence (" + conf + "%). Immediate intervention needed."
                : "DECLINING".equals(trend)
                ? "Confidence trending downward. Review key results."
                : conf < 50
                ? "Below 50% confidence. Needs attention."
                : "Goal is on track with " + conf + "% confidence.";

            Map<String, Object> pred = new LinkedHashMap<>();
            pred.put("goalId",      g.getId());
            pred.put("goalTitle",   g.getTitle());
            pred.put("confidence",  conf);
            pred.put("progress",    prog);
            pred.put("trend",       trend);
            pred.put("failureRisk", failureRisk);
            pred.put("reasoning",   reasoning);
            pred.put("checkIns",    checkInCount);
            predictions.add(pred);
        }
        predictions.sort((a,b) -> ((String)b.get("failureRisk")).compareTo((String)a.get("failureRisk")));

        long high   = predictions.stream().filter(p -> "HIGH".equals(p.get("failureRisk"))).count();
        long medium = predictions.stream().filter(p -> "MEDIUM".equals(p.get("failureRisk"))).count();
        return Map.of("predictions", predictions, "highRisk", high,
            "mediumRisk", medium, "totalGoals", predictions.size());
    }

    // D-4: AI daily prioritization — what to work on today
    @GetMapping("/daily-priorities")
    public Map<String, Object> dailyPriorities() {
        String orgId = workspaceContext.getWorkspaceId();
        List<Task> tasks = taskRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();
        java.time.LocalDateTime now = java.time.LocalDateTime.now();

        // Score each task: overdue(+30) high-priority(+20) due-today(+15) in-progress(+10) blocked(-20)
        List<Map<String, Object>> scored = new ArrayList<>();
        for (Task t : tasks) {
            if ("DONE".equals(t.getStatus())) continue;
            int score = 0;
            List<String> reasons = new ArrayList<>();
            if (t.getDueDate() != null && t.getDueDate().isBefore(now)) {
                score += 30; reasons.add("Overdue");
            } else if (t.getDueDate() != null &&
                       java.time.temporal.ChronoUnit.DAYS.between(now, t.getDueDate()) == 0) {
                score += 15; reasons.add("Due today");
            } else if (t.getDueDate() != null &&
                       java.time.temporal.ChronoUnit.DAYS.between(now, t.getDueDate()) <= 3) {
                score += 8; reasons.add("Due soon");
            }
            if ("HIGH".equals(t.getPriority()))        { score += 20; reasons.add("High priority"); }
            else if ("MEDIUM".equals(t.getPriority())) { score += 8;  }
            if ("IN_PROGRESS".equals(t.getStatus()))   { score += 10; reasons.add("In progress"); }
            if (t.getBlockedByTaskIds() != null && !t.getBlockedByTaskIds().isEmpty()) {
                score -= 20; reasons.add("Blocked");
            }
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("taskId",    t.getId());
            item.put("title",     t.getTitle());
            item.put("priority",  t.getPriority());
            item.put("status",    t.getStatus());
            item.put("score",     score);
            item.put("reasons",   reasons);
            item.put("dueDate",   t.getDueDate() != null ? t.getDueDate().toString() : null);
            scored.add(item);
        }
        scored.sort((a,b) -> Integer.compare((Integer)b.get("score"), (Integer)a.get("score")));
        List<Map<String, Object>> top = scored.stream().limit(10).toList();

        return Map.of("priorities", top, "totalTasks", tasks.size(),
            "generated", java.time.LocalDateTime.now().toString(),
            "summary", "Focus on these " + top.size() + " tasks today based on urgency, priority, and impact");
    }


    // D-11: Process Mining
    @GetMapping("/process-mining")
    public Map<String, Object> processMining() {
        String orgId = workspaceContext.getWorkspaceId();
        List<Task> tasks = taskRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();
        java.time.LocalDateTime now = java.time.LocalDateTime.now();

        // Calculate avg days in each stage by looking at task age vs status
        long todoCount   = tasks.stream().filter(t -> "TODO".equals(t.getStatus())).count();
        long inProgCount = tasks.stream().filter(t -> "IN_PROGRESS".equals(t.getStatus())).count();
        long doneCount   = tasks.stream().filter(t -> "DONE".equals(t.getStatus())).count();

        // Avg days tasks spend in TODO before being picked up (proxy: creation to updatedAt)
        double avgTodoDays = tasks.stream()
            .filter(t -> !"TODO".equals(t.getStatus()) && t.getCreatedAt() != null && t.getUpdatedAt() != null)
            .mapToLong(t -> java.time.temporal.ChronoUnit.DAYS.between(t.getCreatedAt(), t.getUpdatedAt()))
            .filter(d -> d >= 0 && d <= 365)
            .average().orElse(0);

        // Overdue rate
        long overdue = tasks.stream().filter(t -> t.getDueDate() != null
            && t.getDueDate().isBefore(now) && !"DONE".equals(t.getStatus())).count();
        double overdueRate = tasks.isEmpty() ? 0 : Math.round(overdue * 100.0 / tasks.size());

        List<Map<String, Object>> bottlenecks = new ArrayList<>();
        if (todoCount > inProgCount * 2) {
            bottlenecks.add(Map.of("stage", "Backlog → In Progress", "avgDays", Math.round(avgTodoDays * 10.0)/10.0,
                "issue", "Tasks piling up in backlog — consider WIP limits"));
        }
        if (overdueRate > 20) {
            bottlenecks.add(Map.of("stage", "In Progress → Done", "avgDays", avgTodoDays,
                "issue", "High overdue rate (" + (int)overdueRate + "%) — review task sizing"));
        }
        if (bottlenecks.isEmpty()) {
            bottlenecks.add(Map.of("stage", "Overall flow", "avgDays", avgTodoDays,
                "issue", "No major bottlenecks detected"));
        }

        List<String> recommendations = new ArrayList<>();
        if (todoCount > 20) recommendations.add("Reduce backlog — consider grooming sessions");
        if (overdueRate > 30) recommendations.add("Implement daily standups to unblock tasks");
        if (inProgCount > todoCount) recommendations.add("Too many tasks in progress — apply WIP limits");
        if (recommendations.isEmpty()) recommendations.add("Workflow is healthy — maintain current practices");

        return Map.of(
            "summary", String.format("Analysed %d tasks: %d todo, %d in-progress, %d done. Avg %.1f days per task.",
                tasks.size(), todoCount, inProgCount, doneCount, avgTodoDays),
            "bottlenecks", bottlenecks,
            "recommendations", recommendations,
            "stats", Map.of("total", tasks.size(), "todo", todoCount,
                "inProgress", inProgCount, "done", doneCount, "overdueRate", overdueRate)
        );
    }


    // P3: AI Goal Recommendations
    @GetMapping("/goal-recommendations")
    public Map<String, Object> goalRecommendations() {
        String orgId = workspaceContext.getWorkspaceId();
        List<Goal> goals = goalRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();
        List<Task> tasks = taskRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent();

        if (goals.isEmpty()) return Map.of("recommendations", List.of(),
            "message", "Create some goals first to get AI recommendations.");

        String context = "Existing goals: " + goals.stream()
            .map(g -> g.getTitle() + " (progress:" + g.getProgress() + "%, confidence:" + g.getConfidence() + "%)")
            .collect(java.util.stream.Collectors.joining("; "))
            + ". Tasks: " + tasks.stream().limit(20)
            .map(t -> t.getTitle() + "[" + t.getPriority() + "]")
            .collect(java.util.stream.Collectors.joining("; "));

        String prompt = """
            Based on these existing goals and tasks, suggest 3-5 new strategic goals or key results
            that would complement the current portfolio. Return ONLY JSON:
            { "recommendations": [
                { "title": string, "type": "GOAL|KEY_RESULT", "rationale": string,
                  "suggestedLevel": "COMPANY|TEAM|INDIVIDUAL", "priority": "HIGH|MEDIUM|LOW" }
              ], "summary": string }
            """;

        try {
            return aiService.askJson(prompt, context, Map.class);
        } catch (Exception e) {
            // Fallback: rule-based recommendations
            List<Map<String, Object>> recs = new java.util.ArrayList<>();
            if (goals.stream().noneMatch(g -> g.getTitle().toLowerCase().contains("customer")))
                recs.add(Map.of("title","Improve Customer Satisfaction Score","type","GOAL",
                    "rationale","No customer-focused goals detected","suggestedLevel","COMPANY","priority","HIGH"));
            if (goals.stream().filter(g -> "ACTIVE".equals(g.getStatus())).count() > 5)
                recs.add(Map.of("title","Consolidate Q4 OKR Focus Areas","type","GOAL",
                    "rationale","Too many active goals — consider consolidating","suggestedLevel","TEAM","priority","MEDIUM"));
            if (goals.stream().anyMatch(g -> g.getConfidence() < 30))
                recs.add(Map.of("title","Create Recovery Plan for At-Risk Goals","type","GOAL",
                    "rationale","Several goals below 30% confidence","suggestedLevel","TEAM","priority","HIGH"));
            return Map.of("recommendations", recs, "summary",
                "Based on analysis of " + goals.size() + " goals");
        }
    }

    // P3: Semantic search (keyword-based fallback — vector search requires pgvector/Atlas Vector)
    @GetMapping("/semantic-search")
    public Map<String, Object> semanticSearch(@RequestParam String q) {
        String orgId = workspaceContext.getWorkspaceId();
        String query = q.toLowerCase().trim();

        List<Task> tasks = taskRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent().stream()
            .filter(t -> t.getTitle() != null && (
                t.getTitle().toLowerCase().contains(query) ||
                (t.getDescription() != null && t.getDescription().toLowerCase().contains(query))))
            .limit(10).collect(java.util.stream.Collectors.toList());

        List<Goal> goals = goalRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent().stream()
            .filter(g -> g.getTitle() != null && g.getTitle().toLowerCase().contains(query))
            .limit(5).collect(java.util.stream.Collectors.toList());

        List<Map<String, Object>> results = new java.util.ArrayList<>();
        tasks.forEach(t -> results.add(Map.of("type","TASK","id",t.getId(),"title",t.getTitle(),"score",0.8)));
        goals.forEach(g -> results.add(Map.of("type","GOAL","id",g.getId(),"title",g.getTitle(),"score",0.9)));

        return Map.of("results", results, "query", q, "totalFound", results.size(),
            "note", "Keyword search active. Vector semantic search available with pgvector.");
    }

}

package com.prowosma.backend.controller;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.AISettings;
import com.prowosma.backend.model.Goal;
import com.prowosma.backend.model.Project;
import com.prowosma.backend.model.Task;
import com.prowosma.backend.repository.GoalRepository;
import com.prowosma.backend.repository.ProjectRepository;
import com.prowosma.backend.repository.TaskRepository;
import com.prowosma.backend.repository.TeamMemberRepository;
import com.prowosma.backend.service.*;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@RestController
@RequestMapping("/api/ai")
@RequiredArgsConstructor
public class AIController {
    private final com.prowosma.backend.service.VisibilityService visibility;
    private final com.prowosma.backend.service.GoalService goalService;

    private final AIService aiService;
    private final AISettingsService aiSettingsService;
    private final TaskRepository taskRepository;
    private final ProjectRepository projectRepository;
    private final GoalRepository goalRepository;
    private final TaskService taskService;
    private final NotificationService notificationService;
    private final WorkspaceContext workspaceContext;
    private final LlmModelCatalog modelCatalog;
    private final TeamMemberRepository teamMembers;


    // ── shared helpers: friendly errors, input checks, workspace snapshot ──────────

    private static final Logger log = LoggerFactory.getLogger(AIController.class);

    /** Anything that stopped an AI feature, in words a person can act on. The page shows {error} and {hint}. */
    @ExceptionHandler(AiProblem.class)
    public Map<String, Object> aiProblem(AiProblem e) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("error", e.getMessage());
        if (e.getHint() != null) m.put("hint", e.getHint());
        m.put("kind", e.getKind());
        return m;
    }

    /** A bug or an odd workspace must never end as a blank page or a technical message. (Real HTTP errors still pass through.) */
    @ExceptionHandler(RuntimeException.class)
    public Map<String, Object> unexpected(RuntimeException e) {
        if (e instanceof org.springframework.web.ErrorResponse || e instanceof org.springframework.security.access.AccessDeniedException
                || e instanceof org.springframework.http.converter.HttpMessageNotReadableException
                || e instanceof org.springframework.web.method.annotation.MethodArgumentTypeMismatchException) throw e;
        log.warn("AI feature failed: {}", e.getClass().getSimpleName());
        return Map.of("error", "Something went wrong while preparing this.", "hint", "Please try again. If it keeps happening, tell your admin.", "kind", "UNEXPECTED");
    }

    /** A required piece of text from the person, trimmed and limited; otherwise a plain request to fill it in. */
    private static String need(Map<String, ?> body, String key, String ask, int max) {
        Object v = body == null ? null : body.get(key);
        String t = v == null ? "" : String.valueOf(v).trim();
        if (t.isEmpty()) throw new AiProblem("INPUT", ask, null);
        return t.length() > max ? t.substring(0, max) : t;
    }

    private static String opt(Map<String, ?> body, String key, String dflt, int max) {
        Object v = body == null ? null : body.get(key);
        String t = v == null ? "" : String.valueOf(v).trim();
        if (t.isEmpty()) return dflt;
        return t.length() > max ? t.substring(0, max) : t;
    }

    private static String clip(String s, int n) {
        if (s == null) return "";
        String t = s.replaceAll("\\s+", " ").trim();
        return t.length() > n ? t.substring(0, n) + "…" : t;
    }

    private static Map<String, Object> nothingYet(String why) { return Map.of("message", why); }

    private List<Task> myTasks() {
        return visibility.filterTasks(taskRepository.findByOrganizationId(workspaceContext.getWorkspaceId(),
                org.springframework.data.domain.PageRequest.of(0, 2000)).getContent());
    }

    private List<Project> myProjects() {
        return visibility.filterProjects(projectRepository.findByOrganizationId(workspaceContext.getWorkspaceId(),
                org.springframework.data.domain.PageRequest.of(0, 2000)).getContent());
    }

    private static boolean open(Task t) { return !"DONE".equals(t.getStatus()); }

    private static boolean overdue(Task t) { return open(t) && t.getDueDate() != null && t.getDueDate().isBefore(LocalDateTime.now()); }

    /** Most urgent first: overdue, then by due date, then high priority. Used wherever only some tasks fit in the question to the AI. */
    private static List<Task> mostUrgent(List<Task> tasks, int limit) {
        return tasks.stream().sorted(Comparator
                .comparing((Task t) -> t.getDueDate() == null ? LocalDateTime.MAX : t.getDueDate())
                .thenComparing(t -> "HIGH".equals(t.getPriority()) ? 0 : "MEDIUM".equals(t.getPriority()) ? 1 : 2)).limit(limit).toList();
    }

    private static String line(Task t) {
        return "- " + clip(t.getTitle(), 120) + " [" + t.getPriority() + ", " + t.getStatus() + (t.getDueDate() != null ? ", due " + t.getDueDate().toLocalDate() : "") + "]\n";
    }

    /** What the assistant can see: names and numbers, trimmed so it always fits. This is what lets "Knowledge" and "Chat" answer about real data. */
    private String snapshot(List<Task> tasks, List<Project> projects) {
        StringBuilder b = new StringBuilder();
        b.append("Projects: ").append(projects.size()).append(" | Tasks: ").append(tasks.size())
                .append(" (done ").append(tasks.stream().filter(t -> !open(t)).count())
                .append(", overdue ").append(tasks.stream().filter(AIController::overdue).count()).append(")\n");
        projects.stream().limit(25).forEach(p -> b.append("Project: ").append(clip(p.getName(), 80)).append(p.getStatus() != null ? " [" + p.getStatus() + "]" : "").append("\n"));
        mostUrgent(tasks.stream().filter(AIController::open).toList(), 25).forEach(t -> b.append("Task ").append(line(t).substring(2)));
        try {
            goalService.getAll().stream().limit(15).forEach(g -> b.append("Goal: ").append(clip(g.getTitle(), 80)).append("\n"));
        } catch (RuntimeException ignored) { /* goals are optional context */ }
        return b.toString();
    }

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

    /**
     * Which models can this key use? Asks the provider itself, so the model list in AI Settings is never out of date.
     * Admin-only (RoleGuardFilter covers /api/ai/settings*). A blank key uses the saved key for the same provider.
     * Always answers 200 with either {models:[...]} or {error:"plain-language reason", models:[]} so the page can fall back to typing a name.
     */
    @PostMapping("/settings/models")
    public Map<String, Object> listModels(@RequestBody Map<String, String> body) {
        try {
            LlmModelCatalog.Models m = modelCatalog.list(body.get("apiProvider"), body.get("apiKey"), body.get("apiBaseUrl"), "true".equalsIgnoreCase(body.get("refresh")), body.get("backupId"));
            return Map.of("provider", m.provider(), "models", m.models());
        } catch (com.prowosma.backend.integration.LlmException e) {
            return Map.of("models", List.of(), "error", e.getMessage(), "kind", e.getKind().name());
        }
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
            return Map.of("error", "Task Assistant is switched off for this workspace.", "hint", "An admin can turn it on in AI Settings.", "kind", "DISABLED");
        String desc = need(body, "description", "Describe the project first, for example \"Launch a customer feedback portal\".", 6000);
        String name = opt(body, "projectName", "Project", 200);
        String prompt = """
            You are a project manager. Generate a list of tasks for the following project.
            Return ONLY a JSON array of task objects with fields:
            title (string), description (string), priority (LOW/MEDIUM/HIGH), estimatedMinutes (number)
            No extra text, just the JSON array.
            """;
        List<?> tasks = aiService.askJson(prompt, "Project: " + name + "\nDescription: " + desc, List.class);
        if (tasks.isEmpty()) throw new AiProblem("BAD_ANSWER", "The AI didn't suggest any tasks for that description.", "Add more detail about what the project should deliver and try again.");
        return Map.of("tasks", tasks);
    }

    // ── AI-2: Goal Advisor ─────────────────────────────────────

    @PostMapping("/goal-advisor")
    public Map<String, Object> adviseGoal(@RequestBody Map<String, String> body) {
        if (!aiService.isEnabled("goal_advisor"))
            return Map.of("error", "Goal Advisor is switched off for this workspace.", "hint", "An admin can turn it on in AI Settings.", "kind", "DISABLED");
        String goalTitle = need(body, "title", "Type the goal you want help with first, for example \"Grow newsletter to 5,000 readers\".", 300);
        String goalDesc = opt(body, "description", "", 4000);
        String prompt = """
            You are a life coach and goal strategist. Given a goal, suggest sub-goals and steps.
            Return ONLY a JSON object with:
            { "subGoals": [ { "title": string, "description": string, "steps": [{"title": string}] } ] }
            No extra text, just JSON.
            """;
        return aiService.askJson(prompt, "Goal: " + goalTitle + "\nDescription: " + goalDesc, Map.class);
    }

    // ── AI-3 & AI-9: Smart Prioritization Engine ──────────────

    @PostMapping("/prioritize")
    public Map<String, Object> prioritizeTasks(@RequestBody(required = false) Map<String, Object> body) {
        if (!aiService.isEnabled("prioritization"))
            return Map.of("error", "Prioritization Engine is switched off for this workspace.", "hint", "An admin can turn it on in AI Settings.", "kind", "DISABLED");
        List<Task> open = myTasks().stream().filter(AIController::open).toList();
        if (open.isEmpty()) return nothingYet("You have no open tasks to put in order. Add some tasks first.");
        List<Task> tasks = mostUrgent(open, 60);
        Map<String, Task> byId = new HashMap<>();
        StringBuilder taskList = new StringBuilder();
        tasks.forEach(t -> {
            byId.put(t.getId(), t);
            taskList.append("- ID:").append(t.getId())
                    .append(" | Title:").append(clip(t.getTitle(), 120))
                    .append(" | Priority:").append(t.getPriority())
                    .append(" | Status:").append(t.getStatus())
                    .append(" | DueDate:").append(t.getDueDate() != null ? t.getDueDate().toLocalDate().toString() : "none")
                    .append(" | Blockers:").append(t.getBlockedByTaskIds() != null ? t.getBlockedByTaskIds().size() : 0)
                    .append("\n");
        });
        String prompt = """
            You are a productivity expert. Analyze these tasks and suggest optimal priority order.
            Use the exact ID values given. Return ONLY a JSON object:
            { "prioritized": [{"id": string, "title": string, "suggestedPriority": "HIGH/MEDIUM/LOW", "reason": string}],
              "insights": string }
            """;
        Map<String, Object> result = aiService.askJson(prompt, "Tasks:\n" + taskList + (open.size() > tasks.size() ? "(" + (open.size() - tasks.size()) + " less urgent tasks are not listed)\n" : ""), Map.class);
        Object list = result.get("prioritized");
        if (list instanceof List<?> l) {                       // keep only tasks that exist, so nothing invented is shown
            List<Object> good = new ArrayList<>();
            for (Object o : l) if (o instanceof Map<?, ?> m && m.get("id") != null && byId.containsKey(String.valueOf(m.get("id")))) good.add(o);
            result = new LinkedHashMap<>(result);
            result.put("prioritized", good);
        }
        return result;
    }

    // ── AI-4: Daily Digest ─────────────────────────────────────

    @GetMapping("/daily-digest")
    public Map<String, Object> getDailyDigest() {
        if (!aiService.isEnabled("daily_digest"))
            return Map.of("error", "Daily Digest is switched off for this workspace.", "hint", "An admin can turn it on in AI Settings.", "kind", "DISABLED");
        List<Task> allTasks = myTasks();
        if (allTasks.isEmpty()) return nothingYet("There are no tasks yet, so there is nothing to summarise. Add a few tasks and try again.");
        List<Task> overdue = allTasks.stream().filter(AIController::overdue).toList();
        List<Task> today = allTasks.stream().filter(t -> t.getDueDate() != null && t.getDueDate().toLocalDate().equals(LocalDateTime.now().toLocalDate())).toList();
        long done = allTasks.stream().filter(t -> !open(t)).count();
        long inProgress = allTasks.stream().filter(t -> "IN_PROGRESS".equals(t.getStatus())).count();
        StringBuilder context = new StringBuilder(String.format(
                "Total tasks: %d, Done: %d, In Progress: %d, Overdue: %d, Due Today: %d\n", allTasks.size(), done, inProgress, overdue.size(), today.size()));
        mostUrgent(overdue, 8).forEach(t -> context.append("Overdue ").append(line(t).substring(2)));
        today.stream().limit(8).forEach(t -> context.append("Due today ").append(line(t).substring(2)));
        String prompt = """
            You are a productivity coach. Based on the task data, generate an encouraging
            and actionable daily digest. Include: summary, top 3 priorities for today,
            motivational message, and one productivity tip.
            Return as JSON: { "summary": string, "priorities": [string], "motivation": string, "tip": string }
            """;
        Map<String, Object> result = aiService.askJson(prompt, context.toString(), Map.class);
        try {
            notificationService.create("📊 Daily AI Digest Ready", "Your AI digest has been generated", "INFO", "TASK", null);
        } catch (RuntimeException ignored) { /* the digest is the point; a failed notification must not hide it */ }
        return result;
    }

    // ── AI-5: Goal→Project→Task Breakdown ─────────────────────

    @PostMapping("/breakdown")
    public Map<String, Object> breakdown(@RequestBody Map<String, String> body) {
        if (!aiService.isEnabled("breakdown"))
            return Map.of("error", "AI Breakdown is switched off for this workspace.", "hint", "An admin can turn it on in AI Settings.", "kind", "DISABLED");
        String goal = need(body, "goal", "Type the goal to break down first, for example \"Open a second office\".", 1000);
        String timeframe = opt(body, "timeframe", "3 months", 100);
        String prompt = """
            You are a strategic planner. Break down a goal into projects and tasks.
            Return ONLY JSON:
            { "goal": string, "projects": [
              { "name": string, "description": string, "tasks": [
                { "title": string, "priority": "HIGH/MEDIUM/LOW", "estimatedMinutes": number }
              ]}
            ]}
            """;
        return aiService.askJson(prompt, "Goal: " + goal + "\nTimeframe: " + timeframe, Map.class);
    }

    // ── AI-8: Smart Scheduling ─────────────────────────────────

    @PostMapping("/schedule")
    public Map<String, Object> schedule(@RequestBody(required = false) Map<String, Object> body) {
        if (!aiService.isEnabled("scheduling"))
            return Map.of("error", "Smart Scheduling is switched off for this workspace.", "hint", "An admin can turn it on in AI Settings.", "kind", "DISABLED");
        List<Task> open = myTasks().stream().filter(AIController::open).toList();
        if (open.isEmpty()) return nothingYet("You have no open tasks to schedule.");
        String workHours = opt(body, "workHours", "9-17", 40);
        String startDate = opt(body, "startDate", LocalDateTime.now().toLocalDate().toString(), 20);
        StringBuilder taskList = new StringBuilder();
        mostUrgent(open, 50).forEach(t -> taskList.append(line(t)));
        String prompt = """
            You are a scheduling expert. Create an optimal daily schedule for these tasks.
            Return ONLY JSON:
            { "schedule": [{ "date": string, "tasks": [{"title": string, "timeSlot": string, "duration": string}] }],
              "advice": string }
            """;
        return aiService.askJson(prompt, "Work hours: " + workHours + "\nStart: " + startDate + "\nTasks:\n" + taskList, Map.class);
    }

    // ── AI-10: Weekly Planning ─────────────────────────────────

    @GetMapping("/weekly-plan")
    public Map<String, Object> weeklyPlan() {
        if (!aiService.isEnabled("weekly_planning"))
            return Map.of("error", "Weekly Planning is switched off for this workspace.", "hint", "An admin can turn it on in AI Settings.", "kind", "DISABLED");
        List<Task> open = myTasks().stream().filter(AIController::open).toList();
        if (open.isEmpty()) return nothingYet("You have no open tasks to plan a week around. Add some tasks first.");
        List<Project> projects = myProjects();
        StringBuilder context = new StringBuilder();
        context.append("Open tasks: ").append(open.size()).append("\n");
        mostUrgent(open, 30).forEach(t -> context.append(line(t)));
        context.append("Projects: ").append(projects.size()).append("\n");
        String prompt = """
            You are a weekly planning coach. Create a structured weekly plan.
            Return ONLY JSON:
            { "weekOf": string, "monday": [string], "tuesday": [string], "wednesday": [string],
              "thursday": [string], "friday": [string], "goals": [string], "advice": string }
            """;
        return aiService.askJson(prompt, context.toString(), Map.class);
    }

    // ── AI-12: Task Estimation ─────────────────────────────────

    @PostMapping("/estimate")
    public Map<String, Object> estimate(@RequestBody Map<String, String> body) {
        if (!aiService.isEnabled("estimation"))
            return Map.of("error", "Task Estimation is switched off for this workspace.", "hint", "An admin can turn it on in AI Settings.", "kind", "DISABLED");
        String taskTitle = need(body, "title", "Type the task to estimate first, for example \"Build the login page\".", 300);
        String taskDesc = opt(body, "description", "", 4000);
        String prompt = """
            You are an experienced software project manager. Estimate task effort.
            Return ONLY JSON:
            { "optimistic": number, "realistic": number, "pessimistic": number,
              "unit": "minutes", "confidence": "LOW/MEDIUM/HIGH", "reasoning": string,
              "breakdown": [{"step": string, "minutes": number}] }
            """;
        return aiService.askJson(prompt, "Task: " + taskTitle + "\nDescription: " + taskDesc, Map.class);
    }

    // ── AI-13: Daily Standup ───────────────────────────────────

    @GetMapping("/standup")
    public Map<String, Object> standup() {
        if (!aiService.isEnabled("standup"))
            return Map.of("error", "Daily Standup is switched off for this workspace.", "hint", "An admin can turn it on in AI Settings.", "kind", "DISABLED");
        List<Task> allTasks = myTasks();
        List<Task> inProgress = allTasks.stream().filter(t -> "IN_PROGRESS".equals(t.getStatus())).toList();
        List<Task> done = allTasks.stream().filter(t -> "DONE".equals(t.getStatus()) && t.getUpdatedAt() != null
                && t.getUpdatedAt().isAfter(LocalDateTime.now().minusDays(1))).toList();
        List<Task> blocked = allTasks.stream().filter(t -> open(t) && t.getBlockedByTaskIds() != null && !t.getBlockedByTaskIds().isEmpty()).toList();
        if (inProgress.isEmpty() && done.isEmpty() && blocked.isEmpty())
            return nothingYet("Nothing was finished in the last day and nothing is in progress, so there is no standup to report yet. Move a task to In Progress and try again.");
        StringBuilder context = new StringBuilder();
        context.append("Done in the last day: ").append(done.size()).append(" tasks\n");
        context.append("In Progress: ").append(inProgress.size()).append(" tasks\n");
        context.append("Blocked: ").append(blocked.size()).append(" tasks\n");
        done.stream().limit(8).forEach(t -> context.append("Done: ").append(clip(t.getTitle(), 120)).append("\n"));
        inProgress.stream().limit(8).forEach(t -> context.append("Doing: ").append(clip(t.getTitle(), 120)).append("\n"));
        blocked.stream().limit(5).forEach(t -> context.append("Blocked: ").append(clip(t.getTitle(), 120)).append("\n"));
        String prompt = """
            Generate a concise daily standup report.
            Return ONLY JSON:
            { "yesterday": string, "today": string, "blockers": string,
              "mood": "On Track / At Risk / Behind",
              "suggestion": string }
            """;
        return aiService.askJson(prompt, context.toString(), Map.class);
    }

    // ── AI-14: Smart Dependency Detection ─────────────────────

    @GetMapping("/detect-dependencies")
    public Map<String, Object> detectDependencies() {
        if (!aiService.isEnabled("dependency_detection"))
            return Map.of("error", "Dependency Detection is switched off for this workspace.", "hint", "An admin can turn it on in AI Settings.", "kind", "DISABLED");
        List<Task> open = myTasks().stream().filter(AIController::open).toList();
        if (open.size() < 2) return Map.of("dependencies", List.of(), "message", "You need at least two open tasks to look for links between them.");
        List<Task> tasks = mostUrgent(open, 40);
        Map<String, Task> byId = new HashMap<>();
        StringBuilder taskList = new StringBuilder();
        tasks.forEach(t -> { byId.put(t.getId(), t); taskList.append("ID:").append(t.getId()).append(" Title:").append(clip(t.getTitle(), 120)).append("\n"); });
        String prompt = """
            Analyze these tasks and detect logical dependencies.
            Use the exact ID values given. Return ONLY JSON:
            { "dependencies": [{"taskId": string, "dependsOnId": string,
              "reason": string, "confidence": "HIGH/MEDIUM/LOW"}] }
            """;
        Map<String, Object> result = aiService.askJson(prompt, taskList.toString(), Map.class);
        List<Object> good = new ArrayList<>();
        if (result.get("dependencies") instanceof List<?> l)
            for (Object o : l) {
                if (!(o instanceof Map<?, ?> m)) continue;
                Task a = byId.get(String.valueOf(m.get("taskId"))), d = byId.get(String.valueOf(m.get("dependsOnId")));
                if (a == null || d == null || a == d) continue;       // ids the AI made up are dropped
                Map<String, Object> row = new LinkedHashMap<>();
                m.forEach((k, v) -> row.put(String.valueOf(k), v));
                row.put("taskTitle", clip(a.getTitle(), 120));
                row.put("dependsOnTitle", clip(d.getTitle(), 120));
                good.add(row);
            }
        Map<String, Object> out = new LinkedHashMap<>(result);
        out.put("dependencies", good);
        if (good.isEmpty()) out.put("message", "No clear links between your tasks were found.");
        return out;
    }

    // ── AI-15: Risk Detection ──────────────────────────────────

    @GetMapping("/risks")
    public Map<String, Object> detectRisks() {
        if (!aiService.isEnabled("risk_detection"))
            return Map.of("error", "Risk Detection is switched off for this workspace.", "hint", "An admin can turn it on in AI Settings.", "kind", "DISABLED");
        List<Task> tasks = myTasks();
        List<Project> projects = myProjects();
        if (tasks.isEmpty() && projects.isEmpty()) return nothingYet("There are no projects or tasks yet, so there is nothing to check for risks.");
        List<Task> overdue = tasks.stream().filter(AIController::overdue).toList();
        StringBuilder context = new StringBuilder();
        context.append("Open tasks: ").append(tasks.stream().filter(AIController::open).count()).append("\n");
        context.append("Overdue tasks: ").append(overdue.size()).append("\n");
        context.append("Total projects: ").append(projects.size()).append("\n");
        mostUrgent(overdue, 15).forEach(t -> context.append("Overdue ").append(line(t).substring(2)));
        String prompt = """
            You are a risk analyst. Identify project risks and mitigation strategies.
            Return ONLY JSON:
            { "risks": [{"title": string, "severity": "HIGH/MEDIUM/LOW",
              "description": string, "mitigation": string}],
              "overallRisk": "HIGH/MEDIUM/LOW", "summary": string }
            """;
        return aiService.askJson(prompt, context.toString(), Map.class);
    }

    // ── AI-16: Natural Language Task Creation ─────────────────

    @PostMapping("/natural-task")
    public Map<String, Object> naturalTask(@RequestBody Map<String, String> body) {
        if (!aiService.isEnabled("natural_language"))
            return Map.of("error", "Natural Language Creation is switched off for this workspace.", "hint", "An admin can turn it on in AI Settings.", "kind", "DISABLED");
        String input = need(body, "text", "Type what needs doing first, for example \"Call the supplier tomorrow about the invoice, high priority\".", 2000);
        String prompt = """
            Extract task details from natural language input. Work out relative dates such as "tomorrow" or "next Friday" from today's date.
            Return ONLY JSON:
            { "title": string, "description": string, "priority": "LOW/MEDIUM/HIGH",
              "dueDate": "YYYY-MM-DD or null", "tags": [string], "estimatedMinutes": number }
            """;
        Map<String, Object> result = new LinkedHashMap<>(aiService.askJson(prompt, "Input: " + input, Map.class));
        Object title = result.get("title");
        if (title == null || String.valueOf(title).isBlank())
            throw new AiProblem("BAD_ANSWER", "We couldn't find a task in that sentence.", "Say what needs doing, for example \"Send the report to Ravi on Friday\".");
        String pr = String.valueOf(result.getOrDefault("priority", "MEDIUM")).toUpperCase(Locale.ROOT);
        result.put("priority", List.of("LOW", "MEDIUM", "HIGH").contains(pr) ? pr : "MEDIUM");
        return result;
    }

    // ── AI-17: Meeting Notes → Tasks ──────────────────────────

    @PostMapping("/meeting-notes")
    public Map<String, Object> meetingNotes(@RequestBody Map<String, String> body) {
        if (!aiService.isEnabled("meeting_notes"))
            return Map.of("error", "Meeting Notes is switched off for this workspace.", "hint", "An admin can turn it on in AI Settings.", "kind", "DISABLED");
        String notes = need(body, "notes", "Paste your meeting notes first.", 30000);
        String prompt = """
            Extract action items and tasks from meeting notes.
            Return ONLY JSON:
            { "tasks": [{"title": string, "assignee": string, "priority": "LOW/MEDIUM/HIGH",
              "dueDate": string, "description": string}],
              "summary": string, "decisions": [string] }
            """;
        return aiService.askJson(prompt, "Meeting Notes:\n" + notes, Map.class);
    }

    // ── AI-19: Focus Mode ──────────────────────────────────────

    @GetMapping("/focus-mode")
    public Map<String, Object> focusMode() {
        if (!aiService.isEnabled("focus_mode"))
            return Map.of("error", "Focus Mode is switched off for this workspace.", "hint", "An admin can turn it on in AI Settings.", "kind", "DISABLED");
        List<Task> open = myTasks().stream().filter(AIController::open).toList();
        if (open.isEmpty()) return nothingYet("You have no open tasks, so there is nothing to focus on right now.");
        StringBuilder taskList = new StringBuilder();
        mostUrgent(open, 25).forEach(t -> taskList.append(line(t)));
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
            return Map.of("error", "Deadline Negotiator is switched off for this workspace.", "hint", "An admin can turn it on in AI Settings.", "kind", "DISABLED");
        String taskTitle = need(body, "title", "Type the task whose deadline you want to discuss first.", 300);
        String currentDeadline = opt(body, "deadline", "not set", 60);
        String reason = opt(body, "reason", "", 2000);
        String prompt = """
            You are a deadline negotiation expert. Suggest realistic deadline options.
            Return ONLY JSON:
            { "originalDeadline": string, "suggestedDeadlines": [
              {"date": string, "label": string, "rationale": string}],
              "recommendation": string, "riskIfExtended": string }
            """;
        return aiService.askJson(prompt, "Task: " + taskTitle + "\nDeadline: " + currentDeadline + "\nReason: " + reason, Map.class);
    }

    // ── AI-22: Burnout Detection ───────────────────────────────

    @GetMapping("/burnout-check")
    public Map<String, Object> burnoutCheck() {
        if (!aiService.isEnabled("burnout_detection"))
            return Map.of("error", "Burnout Detection is switched off for this workspace.", "hint", "An admin can turn it on in AI Settings.", "kind", "DISABLED");
        List<Task> tasks = myTasks();
        List<Task> pending = tasks.stream().filter(AIController::open).toList();
        if (pending.isEmpty()) return nothingYet("There is no open work, so there is no workload to check. Nothing to worry about right now.");
        long overdue = tasks.stream().filter(AIController::overdue).count();
        long highPriority = pending.stream().filter(t -> "HIGH".equals(t.getPriority())).count();
        long inProgress = tasks.stream().filter(t -> "IN_PROGRESS".equals(t.getStatus())).count();
        String context = String.format("Overdue: %d, High Priority Pending: %d, In Progress simultaneously: %d, Total Pending: %d",
                overdue, highPriority, inProgress, pending.size());
        String prompt = """
            You are a wellbeing coach. Assess burnout risk based on workload data.
            Return ONLY JSON:
            { "burnoutRisk": "LOW/MEDIUM/HIGH/CRITICAL",
              "indicators": [string], "recommendations": [string],
              "immediateAction": string, "message": string }
            """;
        return aiService.askJson(prompt, context, Map.class);
    }

    // ── AI-23: Knowledge Assistant ─────────────────────────────

    @PostMapping("/ask")
    public Map<String, Object> ask(@RequestBody Map<String, String> body) {
        if (!aiService.isEnabled("knowledge_assistant"))
            return Map.of("error", "Knowledge Assistant is switched off for this workspace.", "hint", "An admin can turn it on in AI Settings.", "kind", "DISABLED");
        String question = need(body, "question", "Type your question first, for example \"Which tasks are overdue?\"", 2000);
        String context = snapshot(myTasks(), myProjects());
        String prompt = """
            You are a helpful project management assistant for the Prowosma app.
            Answer questions about the user's projects, tasks and goals concisely, using ONLY the workspace data given.
            If the data doesn't contain the answer, say so plainly instead of guessing.
            Return ONLY JSON: { "answer": string, "suggestions": [string] }
            """;
        return aiService.askJson(prompt, "Workspace data:\n" + context + "\nQuestion: " + question, Map.class);
    }

    // ── AI-24: Chat Assistant ──────────────────────────────────

    @SuppressWarnings("unchecked")
    @PostMapping("/chat")
    public Map<String, Object> chat(@RequestBody Map<String, Object> body) {
        if (!aiService.isEnabled("chat_assistant"))
            return Map.of("error", "Chat Assistant is switched off for this workspace.", "hint", "An admin can turn it on in AI Settings.", "kind", "DISABLED");
        String message = need(body, "message", "Type a message first.", 4000);
        Object ctxObj = body.get("context");
        Map<String, Object> ctx = ctxObj instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of();
        String userName = opt(body, "userName", String.valueOf(ctx.getOrDefault("userName", "")).replace("null", ""), 80);
        if (userName.isBlank()) userName = "there";
        String page = String.valueOf(ctx.getOrDefault("page", "App"));
        StringBuilder convo = new StringBuilder();
        if (body.get("history") instanceof List<?> h) {              // the last few turns, so follow-up questions make sense
            List<?> recent = h.subList(Math.max(0, h.size() - 8), h.size());
            for (Object o : recent)
                if (o instanceof Map<?, ?> m && m.get("content") != null)
                    convo.append("assistant".equals(String.valueOf(m.get("role"))) ? "Assistant: " : "User: ").append(clip(String.valueOf(m.get("content")), 600)).append("\n");
        }
        String systemPrompt = """
            You are an AI assistant for Prowosma, a project management platform.
            The user's name is %s. Address them by name, never as "User".
            Current page: %s.
            Their workspace data (names and numbers only):
            %s
            Be concise, warm and actionable. When you mention their data be specific, and if the data doesn't have the answer, say so instead of guessing.
            Recent conversation:
            %s""".formatted(userName, clip(page, 60), snapshot(myTasks(), myProjects()), convo.length() == 0 ? "(none)" : convo);
        String response = aiService.chatReply(systemPrompt, message, null);
        if (response == null || response.isBlank())
            throw new AiProblem("BAD_ANSWER", "The AI sent back an empty reply.", "Please ask again.");
        return Map.of("response", response, "timestamp", LocalDateTime.now().toString());
    }

    // ── AI-25: Predictive Planning ────────────────────────────

    @GetMapping("/predict-risks")
    public Map<String, Object> predictRisks() {
        if (!aiService.isEnabled("predictive_planning"))
            return Map.of("error", "Predictive Planning is switched off for this workspace.", "hint", "An admin can turn it on in AI Settings.", "kind", "DISABLED");
        List<Task> tasks = myTasks();
        if (tasks.isEmpty()) return nothingYet("There are no tasks yet, so there is nothing to base a prediction on. Add tasks with due dates and try again.");
        List<Project> projects = myProjects();
        long overdueCount = tasks.stream().filter(AIController::overdue).count();
        long blockedCount = tasks.stream().filter(t -> open(t) && t.getBlockedByTaskIds() != null && !t.getBlockedByTaskIds().isEmpty()).count();
        long dueSoon = tasks.stream().filter(t -> open(t) && t.getDueDate() != null && t.getDueDate().isAfter(LocalDateTime.now())
                && t.getDueDate().isBefore(LocalDateTime.now().plusDays(7))).count();
        String context = String.format("Total tasks: %d, Open: %d, Overdue: %d, Blocked: %d, Due in the next 7 days: %d, Projects: %d",
                tasks.size(), tasks.stream().filter(AIController::open).count(), overdueCount, blockedCount, dueSoon, projects.size());
        String prompt = """
            Predict upcoming risks and failure patterns based on project data.
            Return ONLY JSON:
            { "predictions": [{"risk": string, "probability": "LOW/MEDIUM/HIGH",
              "timeframe": string, "prevention": string}],
              "trend": string, "recommendation": string }
            """;
        return aiService.askJson(prompt, context, Map.class);
    }

    // ── AI-26: Team Performance Insights ──────────────────────

    @GetMapping("/team-insights")
    public Map<String, Object> teamInsights() {
        if (!aiService.isEnabled("team_insights"))
            return Map.of("error", "Team Insights is switched off for this workspace.", "hint", "An admin can turn it on in AI Settings.", "kind", "DISABLED");
        List<Task> tasks = myTasks();
        Map<String, String> names = new HashMap<>();
        try {
            teamMembers.findByOrganizationId(workspaceContext.getWorkspaceId()).forEach(m -> names.put(m.getId(), m.getName() != null ? m.getName() : m.getEmail()));
        } catch (RuntimeException ignored) { /* ids are used when names can't be looked up */ }
        Map<String, long[]> perPerson = new TreeMap<>();                 // name -> {open, done, overdue}
        tasks.forEach(t -> {
            if (t.getAssigneeIds() == null) return;
            for (String id : t.getAssigneeIds()) {
                long[] c = perPerson.computeIfAbsent(names.getOrDefault(id, "Team member"), k -> new long[3]);
                if (open(t)) c[0]++; else c[1]++;
                if (overdue(t)) c[2]++;
            }
        });
        if (perPerson.isEmpty()) return nothingYet("No tasks are assigned to anyone yet, so there is no team workload to look at. Assign some tasks and try again.");
        StringBuilder sb = new StringBuilder();
        perPerson.entrySet().stream().limit(40).forEach(e -> sb.append(e.getKey()).append(": open ").append(e.getValue()[0])
                .append(", done ").append(e.getValue()[1]).append(", overdue ").append(e.getValue()[2]).append("\n"));
        String prompt = """
            Analyze team workload and performance patterns.
            Return ONLY JSON:
            { "insights": [string], "workloadBalance": string,
              "recommendations": [string], "teamHealth": "GOOD/FAIR/POOR",
              "summary": string }
            """;
        return aiService.askJson(prompt, "Tasks per person:\n" + sb, Map.class);
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
        List<com.prowosma.backend.model.Project> projects = visibility.filterProjects(projectRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent());
        List<com.prowosma.backend.model.Task>    tasks    = visibility.filterTasks(taskRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent());
        List<com.prowosma.backend.model.Goal>    goals    = goalService.getAll();

        long total     = tasks.size();
        long done      = tasks.stream().filter(t -> "DONE".equals(t.getStatus())).count();
        long inProg    = tasks.stream().filter(t -> "IN_PROGRESS".equals(t.getStatus())).count();
        long overdue   = tasks.stream().filter(t ->
            t.getDueDate() != null && t.getDueDate().isBefore(java.time.LocalDateTime.now())
            && !com.prowosma.backend.model.Task.isFinished(t.getStatus())).count();
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
        List<Task> tasks = visibility.filterTasks(taskRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent());
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
        List<Goal> goals = goalService.getAll();

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
        List<Task> tasks = visibility.filterTasks(taskRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent());
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
        List<Task> tasks = visibility.filterTasks(taskRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent());
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
            && t.getDueDate().isBefore(now) && !com.prowosma.backend.model.Task.isFinished(t.getStatus())).count();
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
        List<Goal> goals = goalService.getAll();
        List<Task> tasks = visibility.filterTasks(taskRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent());

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

        List<Task> tasks = visibility.filterTasks(taskRepository.findByOrganizationId(orgId, org.springframework.data.domain.PageRequest.of(0, 2000)).getContent()).stream()
            .filter(t -> t.getTitle() != null && (
                t.getTitle().toLowerCase().contains(query) ||
                (t.getDescription() != null && t.getDescription().toLowerCase().contains(query))))
            .limit(10).collect(java.util.stream.Collectors.toList());

        List<Goal> goals = goalService.getAll().stream()
            .filter(g -> g.getTitle() != null && g.getTitle().toLowerCase().contains(query))
            .limit(5).collect(java.util.stream.Collectors.toList());

        List<Map<String, Object>> results = new java.util.ArrayList<>();
        tasks.forEach(t -> results.add(Map.of("type","TASK","id",t.getId(),"title",t.getTitle(),"score",0.8)));
        goals.forEach(g -> results.add(Map.of("type","GOAL","id",g.getId(),"title",g.getTitle(),"score",0.9)));

        return Map.of("results", results, "query", q, "totalFound", results.size(),
            "note", "Keyword search active. Vector semantic search available with pgvector.");
    }

}

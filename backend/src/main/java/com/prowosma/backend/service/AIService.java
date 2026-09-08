package com.prowosma.backend.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.AISettings;
import com.prowosma.backend.repository.AISettingsRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import java.util.*;

@Service
@RequiredArgsConstructor
public class AIService {

    private final ObjectMapper objectMapper;
    private final AISettingsRepository aiSettingsRepository;
    private final WorkspaceContext workspaceContext;
    private AISettings getSettings() {
        return aiSettingsRepository.findByOrganizationId(workspaceContext.getWorkspaceId()).stream()
                .findFirst()
                .orElseGet(() -> {
                    // No settings saved yet — create a permissive default so AI works
                    com.prowosma.backend.model.AISettings def = new com.prowosma.backend.model.AISettings();
                    def.setOrganizationId(workspaceContext.getWorkspaceId());
                    def.setAiEnabled(true);
                    return def;
                });
    }

    public boolean isEnabled(String featureKey) {
        try {
            AISettings settings = getSettings();
            if (!settings.isAiEnabled()) return false;
            // Opt-out model: feature enabled unless explicitly set to false
            if (settings.getFeatures() == null) return true;
            return settings.getFeatures().getOrDefault(featureKey, true);
        } catch (Exception e) {
            return true; // default allow when no config exists
        }
    }

    public String ask(String systemPrompt, String userMessage) {
        AISettings settings = getSettings();
        if (!settings.isAiEnabled())
            throw new RuntimeException("AI_DISABLED");

        // If no API key configured, return a helpful workspace-aware response
        if (settings.getApiKey() == null || settings.getApiKey().isBlank()) {
            return generateFallbackResponse(userMessage, systemPrompt);
        }

        try {
            RestTemplate rest = new RestTemplate();
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);

            String provider = (settings.getApiProvider() != null && !settings.getApiProvider().isBlank())
                ? settings.getApiProvider() : "ANTHROPIC";
            System.out.println("[AIService] Using provider: " + provider + " model: " + settings.getModel());
            String url;
            Map<String, Object> body = new HashMap<>();

            switch (provider) {
                case "OPENAI" -> {
                    url = "https://api.openai.com/v1/chat/completions";
                    headers.set("Authorization", "Bearer " + settings.getApiKey());
                    String oaiModel = (settings.getModel() != null && !settings.getModel().isBlank()) ? settings.getModel() : "gpt-4o-mini";
                    body.put("model", oaiModel);
                    int oaiTokens = settings.getMaxTokens() > 0 ? settings.getMaxTokens() : 2048;
                    body.put("max_tokens", oaiTokens);
                    body.put("messages", List.of(
                            Map.of("role", "system", "content", systemPrompt),
                            Map.of("role", "user", "content", userMessage)
                    ));
                }
                case "GEMINI" -> {
                    url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=" + settings.getApiKey();
                    body.put("contents", List.of(Map.of("parts", List.of(Map.of("text", systemPrompt + "\n" + userMessage)))));
                }
                case "CUSTOM" -> {
                    url = settings.getApiBaseUrl();
                    headers.set("Authorization", "Bearer " + settings.getApiKey());
                    body.put("model", settings.getModel());
                    body.put("max_tokens", settings.getMaxTokens());
                    body.put("messages", List.of(
                            Map.of("role", "system", "content", systemPrompt),
                            Map.of("role", "user", "content", userMessage)
                    ));
                }
                default -> { // ANTHROPIC
                    url = "https://api.anthropic.com/v1/messages";
                    headers.set("x-api-key", settings.getApiKey());
                    headers.set("anthropic-version", "2023-06-01");
                    body.put("model", settings.getModel() != null ? settings.getModel() : "claude-sonnet-4-20250514");
                    body.put("max_tokens", settings.getMaxTokens());
                    body.put("system", systemPrompt);
                    body.put("messages", List.of(Map.of("role", "user", "content", userMessage)));
                }
            }

            HttpEntity<Map<String, Object>> entity = new HttpEntity<>(body, headers);
            ResponseEntity<Map> response = rest.postForEntity(url, entity, Map.class);
            Map<String, Object> responseBody = response.getBody();

            // Parse response based on provider
            return switch (provider) {
                case "OPENAI", "CUSTOM" -> {
                    List<Map<String, Object>> choices = (List<Map<String, Object>>) responseBody.get("choices");
                    Map<String, Object> msg = (Map<String, Object>) choices.get(0).get("message");
                    yield (String) msg.get("content");
                }
                case "GEMINI" -> {
                    List<Map<String, Object>> candidates = (List<Map<String, Object>>) responseBody.get("candidates");
                    Map<String, Object> content = (Map<String, Object>) candidates.get(0).get("content");
                    List<Map<String, Object>> parts = (List<Map<String, Object>>) content.get("parts");
                    yield (String) parts.get(0).get("text");
                }
                default -> {
                    List<Map<String, Object>> content = (List<Map<String, Object>>) responseBody.get("content");
                    yield (String) content.get(0).get("text");
                }
            };
        } catch (org.springframework.web.client.HttpClientErrorException e) {
            // 401/403 = bad/missing API key — return helpful fallback instead of crashing
            if (e.getStatusCode().value() == 401 || e.getStatusCode().value() == 403) {
                return generateFallbackResponse(userMessage, systemPrompt);
            }
            throw new RuntimeException("AI_REQUEST_FAILED: " + e.getMessage());
        } catch (Exception e) {
            if (e.getMessage() != null && e.getMessage().contains("AI_DISABLED")) throw e;
            // Network error or other failure — return fallback
            return generateFallbackResponse(userMessage, systemPrompt);
        }
    }

    public <T> T askJson(String systemPrompt, String userMessage, Class<T> responseType) {
        String raw = ask(systemPrompt, userMessage);
        try {
            String cleaned = raw.trim();
            if (cleaned.startsWith("```json")) cleaned = cleaned.substring(7);
            if (cleaned.startsWith("```")) cleaned = cleaned.substring(3);
            if (cleaned.endsWith("```")) cleaned = cleaned.substring(0, cleaned.length() - 3);
            return objectMapper.readValue(cleaned.trim(), responseType);
        } catch (Exception e) {
            throw new RuntimeException("Failed to parse AI response: " + e.getMessage());
        }
    }

    /**
     * Generates a helpful response when no external AI API key is configured or API call fails.
     * Parses workspace context from the system prompt to give meaningful answers.
     */
    private String generateFallbackResponse(String userMessage, String systemPrompt) {
        String lower = userMessage.toLowerCase();

        // Extract context numbers from systemPrompt
        int projects = 0, tasks = 0;
        try {
            java.util.regex.Matcher pm = java.util.regex.Pattern.compile("Projects: (\\d+)").matcher(systemPrompt);
            if (pm.find()) projects = Integer.parseInt(pm.group(1));
            java.util.regex.Matcher tm = java.util.regex.Pattern.compile("Tasks: (\\d+)").matcher(systemPrompt);
            if (tm.find()) tasks = Integer.parseInt(tm.group(1));
        } catch (Exception ignored) {}

        // Extract user name
        String userName = "there";
        try {
            java.util.regex.Matcher nm = java.util.regex.Pattern.compile("User: ([^|\\n]+)").matcher(systemPrompt);
            if (nm.find()) userName = nm.group(1).trim();
        } catch (Exception ignored) {}

        String apiNote = "\n\n> 💡 **To enable full AI responses**, go to **AI Settings → API Configuration** and add your Anthropic, OpenAI, or Gemini API key.";

        if (lower.contains("project")) {
            return String.format(
                "Hi %s! Here\'s a summary of your workspace projects:\n\n" +
                "📁 **Total Projects:** %d\n\n" +
                "You can view all your projects on the Projects page, including status, progress, categories, and linked goals. " +
                "Each project can contain tasks, sub-projects, sprints, and goals.%s",
                userName, projects, apiNote);
        }
        if (lower.contains("task") || lower.contains("todo")) {
            return String.format(
                "Hi %s! Here\'s your task overview:\n\n" +
                "✅ **Total Tasks:** %d\n\n" +
                "You can manage tasks from the Tasks page, Kanban board, or Jira-style board. " +
                "Tasks support priorities, due dates, assignees, story points, and custom fields.%s",
                userName, tasks, apiNote);
        }
        if (lower.contains("goal")) {
            return String.format(
                "Hi %s! Your workspace overview:\n\n" +
                "🎯 **Goals** are linked to your %d project%s\n" +
                "✅ **Tasks** total: %d\n\n" +
                "You can track goals on the Goals page. Goals support sub-goals, progress tracking, and project linking.%s",
                userName, projects, projects == 1 ? "" : "s", tasks, apiNote);
        }
        if (lower.contains("sprint") || lower.contains("standup") || lower.contains("today")) {
            return String.format(
                "Hi %s! Your workspace has **%d tasks** across **%d projects**.\n\n" +
                "📋 Check your active sprint on the Sprints page\n" +
                "📊 View today\'s priorities on the Dashboard\n" +
                "⚡ Run a standup from the AI panel%s",
                userName, tasks, projects, apiNote);
        }
        if (lower.contains("help") || lower.contains("what can you") || lower.contains("what do you")) {
            return String.format(
                "Hi %s! I\'m your Prowosma AI assistant. Here\'s what I can do:\n\n" +
                "🤖 **Task Assistant** — Generate tasks from project descriptions\n" +
                "🎯 **Goal Advisor** — Suggest sub-goals and OKR steps\n" +
                "📊 **Smart Prioritization** — Order tasks by urgency\n" +
                "☀️ **Daily Digest** — Summarize your day\n" +
                "⚡ **Daily Standup** — Auto-generate standup reports\n" +
                "🔍 **Risk Detection** — Identify project risks\n" +
                "💬 **AI Chat** — Ask me anything about your workspace\n\n" +
                "Your workspace: **%d projects**, **%d tasks**%s",
                userName, projects, tasks, apiNote);
        }
        return String.format(
            "Hi %s! I\'m your Prowosma AI assistant.\n\n" +
            "📊 **Your workspace at a glance:**\n" +
            "- 📁 Projects: **%d**\n" +
            "- ✅ Tasks: **%d**\n\n" +
            "I can help you with task generation, goal planning, risk detection, daily standups, and much more. " +
            "Try asking me about your projects, tasks, or goals!%s",
            userName, projects, tasks, apiNote);
    }
}

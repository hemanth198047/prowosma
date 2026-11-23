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
    private final FieldEncryptionService crypto;
    private final ConfiguredLlmClient llm;
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
        final String apiKey = crypto.decrypt(settings.getApiKey()).trim();      // saved encrypted since this fix; older plaintext keys still work

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
                    headers.set("Authorization", "Bearer " + apiKey);
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
                    // the model chosen in AI Settings (it is picked from the provider's own list); never a hard-coded name that a provider can retire
                    String gemModel = (settings.getModel() != null && settings.getModel().matches("^gemini-[A-Za-z0-9._-]{1,80}$")) ? settings.getModel() : "gemini-2.5-flash";
                    url = "https://generativelanguage.googleapis.com/v1beta/models/" + gemModel + ":generateContent";
                    headers.set("x-goog-api-key", apiKey);          // a header, not ?key= — URLs are written to logs
                    body.put("contents", List.of(Map.of("parts", List.of(Map.of("text", systemPrompt + "\n" + userMessage)))));
                }
                case "CUSTOM" -> {
                    url = settings.getApiBaseUrl();
                    headers.set("Authorization", "Bearer " + apiKey);
                    body.put("model", settings.getModel());
                    body.put("max_tokens", settings.getMaxTokens());
                    body.put("messages", List.of(
                            Map.of("role", "system", "content", systemPrompt),
                            Map.of("role", "user", "content", userMessage)
                    ));
                }
                default -> { // ANTHROPIC
                    url = "https://api.anthropic.com/v1/messages";
                    headers.set("x-api-key", apiKey);
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

    // ── strict path used by the AI assistant's panels ─────────────────────────────────

    private static final int JSON_TOKENS = 8192;          // models that "think" first spend part of the budget before answering

    /** Turns a provider failure into words a person can act on. */
    static AiProblem explain(com.prowosma.backend.integration.LlmException e) {
        return switch (e.getKind()) {
            case NOT_CONFIGURED -> new AiProblem("NOT_CONFIGURED", e.getMessage(), "Ask a workspace admin to open AI Settings and finish the setup.");
            case AUTH -> new AiProblem("AUTH", "The AI provider didn't accept the saved key.",
                    "An admin should open AI Settings, paste a valid key and press Save. A key that was deleted or expired needs to be replaced.");
            case RATE_LIMITED -> new AiProblem("BUSY", "The AI provider is getting too many requests right now.",
                    "Wait a minute and try again. If it keeps happening, an admin can choose a different model in AI Settings.");
            case SERVER, NETWORK -> new AiProblem("UNAVAILABLE", e.getMessage(),
                    "This usually passes in a few minutes, so try again shortly. If it keeps happening, an admin can choose a different model in AI Settings.");
            case INPUT_TOO_LARGE -> new AiProblem("TOO_BIG", "There is more information than the AI model can read in one go.",
                    "Try again with less text, or an admin can choose a model that handles longer text in AI Settings.");
            default -> new AiProblem("MODEL", e.getMessage(), "An admin can open AI Settings, press \"Refresh models\" and choose a model that works.");
        };
    }

    /** One call to the configured model. A busy or retired model is replaced by a working one inside the client; a dropped connection is retried once. */
    private ConfiguredLlmClient.Result strict(String system, String user, int tokens, String featureKey) {
        String org = workspaceContext.getWorkspaceId();
        for (int attempt = 1; ; attempt++) {
            try {
                return llm.complete(org, system, user, tokens, featureKey);
            } catch (com.prowosma.backend.integration.LlmException e) {
                if (attempt == 1 && e.getKind() == com.prowosma.backend.integration.LlmException.Kind.NETWORK) {      // busy/overloaded models are handled inside the client by switching model
                    try { Thread.sleep(1500); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); throw explain(e); }
                    continue;
                }
                throw explain(e);
            }
        }
    }

    /** Free text (the chat). With no key saved at all it answers from the built-in help; any other problem is explained, never hidden. */
    public String chatReply(String systemPrompt, String userMessage, String featureKey) {
        AISettings settings = getSettings();
        if (!settings.isAiEnabled()) throw new AiProblem("DISABLED", "AI is switched off for this workspace.", "An admin can turn it on in AI Settings.");
        if (settings.getApiKey() == null || settings.getApiKey().isBlank()) return generateFallbackResponse(userMessage, systemPrompt);
        return strict(systemPrompt, userMessage, Math.max(settings.getMaxTokens(), 2048), featureKey).text();
    }

    /** Asks for JSON and reads it forgivingly: fences and chatter around it are ignored, and one clearer second try is made if it still isn't JSON. */
    public <T> T askJson(String systemPrompt, String userMessage, Class<T> responseType) { return askJson(systemPrompt, userMessage, responseType, null); }

    public <T> T askJson(String systemPrompt, String userMessage, Class<T> responseType, String featureKey) {
        ConfiguredLlmClient.Result r = strict(systemPrompt, userMessage, JSON_TOKENS, featureKey);
        T out = readJson(r.text(), responseType);
        if (out == null) {
            r = strict(systemPrompt + "\nIMPORTANT: reply with valid JSON only: no explanation, no markdown, nothing before or after it.", userMessage, JSON_TOKENS * 2, featureKey);
            out = readJson(r.text(), responseType);
        }
        if (out == null)
            throw new AiProblem("BAD_ANSWER", "The AI replied in a form we couldn't use.",
                    "Press the button again. If it keeps happening, an admin can choose a different model in AI Settings.");
        return out;
    }

    /** The first JSON value in the text, shaped as the caller wants (an object where a list was wanted is searched for its list, and the other way round). */
    <T> T readJson(String raw, Class<T> type) {
        if (raw == null) return null;
        String t = raw.trim();
        int start = -1;
        for (int i = 0; i < t.length(); i++) { char c = t.charAt(i); if (c == '{' || c == '[') { start = i; break; } }
        if (start < 0) return null;
        try {
            com.fasterxml.jackson.databind.JsonNode n = objectMapper.readTree(t.substring(start));
            if (n == null || n.isMissingNode() || n.isNull()) return null;
            if (List.class.isAssignableFrom(type) && n.isObject()) {
                for (var it = n.elements(); it.hasNext(); ) { var v = it.next(); if (v.isArray()) { n = v; break; } }
                if (!n.isArray()) return null;
            }
            if (Map.class.isAssignableFrom(type) && n.isArray()) {
                Map<String, Object> wrapped = new LinkedHashMap<>();
                wrapped.put("items", objectMapper.convertValue(n, List.class));
                return type.cast(wrapped);
            }
            return objectMapper.convertValue(n, type);
        } catch (Exception e) {
            return null;
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

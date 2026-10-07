package com.prowosma.backend.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.integration.LlmClient;
import com.prowosma.backend.integration.LlmException;
import com.prowosma.backend.integration.LlmException.Kind;
import com.prowosma.backend.integration.LlmHttp;
import com.prowosma.backend.integration.OutboundUrlPolicy;
import com.prowosma.backend.model.AISettings;
import com.prowosma.backend.repository.AISettingsRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.*;
import java.util.regex.Pattern;

/**
 * Calls whichever provider the ORGANIZATION configured in AI Settings (Anthropic, OpenAI, Gemini, or a custom
 * OpenAI-compatible endpoint). Unlike the general-purpose AIService it is STRICT: it never returns canned text when
 * the key is missing or a call fails — it throws a clear error — because invented output here would become minutes
 * and tasks. It reads settings by explicit organization id, so it works in background jobs. The key is only ever
 * placed in a request header, never in a URL, a log line or an error message.
 */
@Service
@RequiredArgsConstructor
public class ConfiguredLlmClient implements LlmClient {

    public static final String FEATURE = "meeting_intelligence";
    private static final Pattern MODEL = Pattern.compile("^[A-Za-z0-9._:/-]{1,100}$");
    private static final Pattern TOO_LARGE = Pattern.compile("(?i)(context length|maximum context|too many tokens|prompt is too long|too long|input is too large|exceeds the (model|maximum))");

    private final AISettingsRepository settingsRepo;
    private final FieldEncryptionService crypto;
    private final LlmHttp http;
    private final ObjectMapper om = new ObjectMapper();

    @Value("${app.integrations.allow-private-hosts:false}")
    private boolean allowPrivateHosts;

    // ── readiness ─────────────────────────────────────────────────────────────

    private AISettings settings(String org) {
        if (org == null) return null;
        return settingsRepo.findByOrganizationId(org).stream().findFirst().orElse(null);
    }

    @Override
    public String notReadyReason(String org) {
        AISettings s = settings(org);
        if (s == null || !s.isAiEnabled()) return "AI isn't turned on. An admin can enable it under AI Settings.";
        if (s.getApiKey() == null || s.getApiKey().isBlank()) return "No AI API key is saved. An admin can add one under AI Settings.";
        if (!s.isFeatureEnabled(FEATURE)) return "Meeting summaries are switched off in AI Settings.";
        String provider = provider(s);
        String model = s.getModel() == null ? "" : s.getModel().trim();
        switch (provider) {
            case "CUSTOM" -> {
                if (s.getApiBaseUrl() == null || s.getApiBaseUrl().isBlank()) return "The custom AI endpoint address is missing in AI Settings.";
                try {
                    OutboundUrlPolicy.parseHttps(s.getApiBaseUrl(), "AI endpoint");
                } catch (IllegalArgumentException e) {
                    return "The custom AI endpoint address in AI Settings isn't a valid https address.";
                }
                if (model.isEmpty()) return "Choose a model for the custom AI endpoint in AI Settings.";
            }
            case "GEMINI" -> {
                if (model.isEmpty()) return "Choose a Gemini model in AI Settings.";
            }
            default -> { /* ANTHROPIC and OPENAI have defaults */ }
        }
        if (!model.isEmpty()) {
            if (!MODEL.matcher(model).matches()) return "The model name in AI Settings contains unsupported characters.";
            String m = model.toLowerCase(Locale.ROOT);
            boolean claude = m.startsWith("claude"), gpt = m.startsWith("gpt") || m.matches("^o\\d.*"), gem = m.startsWith("gemini");
            if ((provider.equals("ANTHROPIC") && (gpt || gem)) || (provider.equals("OPENAI") && (claude || gem))
                    || (provider.equals("GEMINI") && (claude || gpt)))
                return "The model name \"" + model + "\" doesn't match the " + provider + " provider chosen in AI Settings.";
        }
        return null;
    }

    private static String provider(AISettings s) {
        String p = s.getApiProvider();
        return (p == null || p.isBlank()) ? "ANTHROPIC" : p.trim().toUpperCase(Locale.ROOT);
    }

    // ── call ──────────────────────────────────────────────────────────────────

    @Override
    public Result complete(String org, String system, String user, int maxOutputTokens) {
        String reason = notReadyReason(org);
        if (reason != null) throw new LlmException(Kind.NOT_CONFIGURED, reason);
        AISettings s = settings(org);
        String provider = provider(s);
        String key = crypto.decrypt(s.getApiKey()).trim();
        String model = s.getModel() == null || s.getModel().isBlank() ? null : s.getModel().trim();

        String url;
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Content-Type", "application/json");
        Map<String, Object> body = new LinkedHashMap<>();
        switch (provider) {
            case "OPENAI", "CUSTOM" -> {
                boolean custom = provider.equals("CUSTOM");
                url = custom ? s.getApiBaseUrl().trim() : "https://api.openai.com/v1/chat/completions";
                headers.put("Authorization", "Bearer " + key);
                body.put("model", model != null ? model : "gpt-4o-mini");
                body.put("max_completion_tokens", maxOutputTokens);
                body.put("messages", List.of(Map.of("role", "system", "content", system), Map.of("role", "user", "content", user)));
            }
            case "GEMINI" -> {
                url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent";
                headers.put("x-goog-api-key", key);                  // header, not the query string, so it can't leak into URLs/logs
                body.put("systemInstruction", Map.of("parts", List.of(Map.of("text", system))));
                body.put("contents", List.of(Map.of("role", "user", "parts", List.of(Map.of("text", user)))));
                body.put("generationConfig", Map.of("maxOutputTokens", maxOutputTokens));
            }
            default -> {
                url = "https://api.anthropic.com/v1/messages";
                headers.put("x-api-key", key);
                headers.put("anthropic-version", "2023-06-01");
                body.put("model", model != null ? model : "claude-sonnet-4-20250514");
                body.put("max_tokens", maxOutputTokens);
                body.put("system", system);
                body.put("messages", List.of(Map.of("role", "user", "content", user)));
            }
        }

        LlmHttp.Result r;
        try {
            r = http.send("POST", url, headers, om.writeValueAsString(body), allowPrivateHosts);
        } catch (IOException e) {
            throw new LlmException(Kind.NETWORK, "Couldn't reach the AI provider.");
        } catch (IllegalArgumentException e) {
            throw new LlmException(Kind.NOT_CONFIGURED, "The AI endpoint in AI Settings isn't allowed (it must be a public https address).");
        }
        int st = r.status();
        if (st == 401 || st == 403) throw new LlmException(Kind.AUTH, "The AI provider rejected the saved API key.");
        if (st == 429) throw new LlmException(Kind.RATE_LIMITED, "The AI provider is rate limiting requests.");
        if (st >= 500) throw new LlmException(Kind.SERVER, "The AI provider had a problem.");
        if (st < 200 || st >= 300) {
            boolean big = (st == 400 || st == 413) && r.body() != null && TOO_LARGE.matcher(r.body()).find();
            throw new LlmException(big ? Kind.INPUT_TOO_LARGE : Kind.BAD_RESPONSE,
                    big ? "The configured model can't take this much text." : "The AI provider didn't accept the request.");
        }
        try {
            return parse(provider, om.readTree(r.body()), model);
        } catch (IOException | RuntimeException e) {
            throw new LlmException(Kind.BAD_RESPONSE, "The AI provider's reply couldn't be read.");
        }
    }

    private Result parse(String provider, JsonNode n, String model) {
        StringBuilder text = new StringBuilder();
        int in, out;
        boolean truncated;
        switch (provider) {
            case "OPENAI", "CUSTOM" -> {
                JsonNode c = n.path("choices").path(0);
                text.append(c.path("message").path("content").asText(""));
                truncated = "length".equals(c.path("finish_reason").asText(""));
                in = n.path("usage").path("prompt_tokens").asInt(0);
                out = n.path("usage").path("completion_tokens").asInt(0);
            }
            case "GEMINI" -> {
                JsonNode c = n.path("candidates").path(0);
                for (JsonNode p : c.path("content").path("parts")) text.append(p.path("text").asText(""));
                truncated = "MAX_TOKENS".equals(c.path("finishReason").asText(""));
                in = n.path("usageMetadata").path("promptTokenCount").asInt(0);
                out = n.path("usageMetadata").path("candidatesTokenCount").asInt(0);
            }
            default -> {
                for (JsonNode p : n.path("content")) if ("text".equals(p.path("type").asText("text"))) text.append(p.path("text").asText(""));
                truncated = "max_tokens".equals(n.path("stop_reason").asText(""));
                in = n.path("usage").path("input_tokens").asInt(0);
                out = n.path("usage").path("output_tokens").asInt(0);
            }
        }
        if (text.toString().isBlank()) throw new LlmException(Kind.BAD_RESPONSE, "The AI provider returned an empty reply.");
        String usedModel = n.path("model").asText(model == null ? "" : model);
        return new Result(text.toString(), in, out, provider, usedModel, truncated);
    }
}

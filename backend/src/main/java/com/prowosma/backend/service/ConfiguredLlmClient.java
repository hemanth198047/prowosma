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
import lombok.extern.slf4j.Slf4j;
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
@Slf4j
@Service
@RequiredArgsConstructor
public class ConfiguredLlmClient implements LlmClient {

    public static final String FEATURE = "meeting_intelligence";
    private static final Pattern MODEL = Pattern.compile("^[A-Za-z0-9._:/-]{1,100}$");
    private static final Pattern TOO_LARGE = Pattern.compile("(?i)(context length|maximum context|too many tokens|prompt is too long|too long|input is too large|exceeds the (model|maximum))");

    private final AISettingsRepository settingsRepo;
    private final FieldEncryptionService crypto;
    private final LlmHttp http;
    private final LlmModelCatalog catalog;
    private final ObjectMapper om = new ObjectMapper();

    @Value("${app.integrations.allow-private-hosts:false}")
    private boolean allowPrivateHosts;

    // ── readiness ─────────────────────────────────────────────────────────────

    private AISettings settings(String org) {
        if (org == null) return null;
        return settingsRepo.findByOrganizationId(org).stream().findFirst().orElse(null);
    }

    @Override
    public String notReadyReason(String org) { return notReadyReason(org, FEATURE); }

    /** Like {@link #notReadyReason(String)} for another feature (the AI assistant's panels); a null feature skips the per-feature switch. */
    public String notReadyReason(String org, String featureKey) {
        AISettings s = settings(org);
        if (s == null || !s.isAiEnabled()) return "AI isn't turned on. An admin can enable it under AI Settings.";
        if (s.getApiKey() == null || s.getApiKey().isBlank()) return "No AI API key is saved. An admin can add one under AI Settings.";
        if (featureKey != null && !s.isFeatureEnabled(featureKey)) return FEATURE.equals(featureKey) ? "Meeting summaries are switched off in AI Settings." : "This AI feature is switched off in AI Settings.";
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
    public Result complete(String org, String system, String user, int maxOutputTokens) { return complete(org, system, user, maxOutputTokens, FEATURE); }

    // ── automatic model choice ────────────────────────────────────────────────

    /** A model that worked when the chosen one didn't; used first for a while so the next request doesn't wait for the same failure. */
    private record Pref(String model, String configured, long until) {}
    private static final long PREF_MS = 30 * 60 * 1000L;
    private static final int MAX_OTHER_MODELS = 4;
    private final Map<String, Pref> working = new java.util.concurrent.ConcurrentHashMap<>();
    private static final Pattern MODEL_PROBLEM = Pattern.compile("(?i)(isn't available|no quota|not found|no longer available|not supported|does not exist|overloaded)");

    /** Would a different model plausibly succeed? (Not for a bad key, a missing setup, or no network.) */
    private static boolean otherModelMayHelp(LlmException e) {
        return switch (e.getKind()) {
            case RATE_LIMITED, SERVER, INPUT_TOO_LARGE -> true;
            case BAD_RESPONSE -> e.getMessage() != null && MODEL_PROBLEM.matcher(e.getMessage()).find();
            default -> false;
        };
    }

    // ── backup providers ──────────────────────────────────────────────────────

    /** One place requests can go: the main provider (idx 0) or a backup. The key is still encrypted here; it is decrypted only when sending. */
    private record Target(int idx, String provider, String encKey, String baseUrl, String model, String label) {
        boolean needsModelName() { return provider.equals("GEMINI") || provider.equals("CUSTOM"); }
    }

    private static final long COOL_MS = 5 * 60 * 1000L;          // a target that just failed is tried last for a while, so people don't wait on it
    private static final long COOL_AUTH_MS = 15 * 60 * 1000L;
    private static final int MAX_OTHER_MODELS_BACKUP = 2;
    private final Map<String, Long> cooling = new java.util.concurrent.ConcurrentHashMap<>();

    private List<Target> targets(AISettings s) {
        List<Target> out = new ArrayList<>();
        String model = s.getModel() == null || s.getModel().isBlank() ? null : s.getModel().trim();
        out.add(new Target(0, provider(s), s.getApiKey(), s.getApiBaseUrl(), model, "main provider"));
        if (s.getBackups() != null) {
            int i = 1;
            for (AISettings.Backup b : s.getBackups()) {
                if (b == null || b.getApiKey() == null || b.getApiKey().isBlank()) continue;
                String p = b.getApiProvider() == null || b.getApiProvider().isBlank() ? "CUSTOM" : b.getApiProvider().trim().toUpperCase(Locale.ROOT);
                if (p.equals("CUSTOM")) {
                    try { OutboundUrlPolicy.parseHttps(b.getApiBaseUrl(), "AI endpoint"); } catch (RuntimeException e) { continue; }
                }
                String m = b.getModel() == null || b.getModel().isBlank() ? null : b.getModel().trim();
                if (m != null && !MODEL.matcher(m).matches()) m = null;
                out.add(new Target(i++, p, b.getApiKey(), b.getApiBaseUrl(), m, b.getLabel() == null || b.getLabel().isBlank() ? p : b.getLabel()));
            }
        }
        return out;
    }

    private static String coolKey(String org, Target t) {
        return org + "#" + t.idx() + "#" + Objects.hash(t.provider(), t.baseUrl(), t.encKey(), t.model());      // changes when the admin changes the entry
    }

    public Result complete(String org, String system, String user, int maxOutputTokens, String featureKey) {
        String reason = notReadyReason(org, featureKey);
        if (reason != null) throw new LlmException(Kind.NOT_CONFIGURED, reason);
        AISettings s = settings(org);
        List<Target> all = targets(s);
        if (all.size() == 1) return completeOn(org, all.get(0), system, user, maxOutputTokens, MAX_OTHER_MODELS);

        // Targets that failed recently go to the back of the line; the rest keep the order the admin chose.
        long now = System.currentTimeMillis();
        List<Target> order = new ArrayList<>(), later = new ArrayList<>();
        for (Target t : all) (cooling.getOrDefault(coolKey(org, t), 0L) > now ? later : order).add(t);
        order.addAll(later);

        LlmException firstFailure = null;
        for (Target t : order) {
            try {
                Result r = completeOn(org, t, system, user, maxOutputTokens, t.idx() == 0 ? MAX_OTHER_MODELS : MAX_OTHER_MODELS_BACKUP);
                cooling.remove(coolKey(org, t));
                return r;
            } catch (LlmException e) {
                if (e.getKind() == Kind.NOT_CONFIGURED && t.idx() == 0) throw e;
                cooling.put(coolKey(org, t), System.currentTimeMillis() + (e.getKind() == Kind.AUTH ? COOL_AUTH_MS : COOL_MS));
                log.warn("AI provider \"{}\" didn't work ({}); trying the next one", t.label(), e.getKind());
                if (firstFailure == null) firstFailure = e;
            }
        }
        String msg = firstFailure.getMessage();
        throw new LlmException(firstFailure.getKind(), msg + (msg.endsWith(".") ? " " : ". ") + "Your backup AI providers were tried too and didn't work either.");
    }

    /** One provider, with its own automatic model choice (see below). Throws when nothing on this provider answers. */
    private Result completeOn(String org, Target t, String system, String user, int maxOutputTokens, int maxOthers) {
        String configured = t.model();
        String prefKey = org + "#" + t.idx();
        Pref pref = working.get(prefKey);
        String first = pref != null && pref.until() > System.currentTimeMillis() && Objects.equals(pref.configured(), configured) ? pref.model() : configured;
        String key = crypto.decrypt(t.encKey()).trim();
        if (first == null && t.needsModelName()) {
            // A backup saved without a model name: take the provider's first listed one.
            List<String> listed = candidatesFor(t, key);
            if (listed.isEmpty()) throw new LlmException(Kind.BAD_RESPONSE, "No AI models were found for the \"" + t.label() + "\" key.");
            first = listed.get(0);
        }
        LlmException firstFailure;
        try {
            return send(t, first, system, user, maxOutputTokens);
        } catch (LlmException e) {
            if (!otherModelMayHelp(e)) throw e;
            firstFailure = e;
        }
        // The chosen model is busy, retired, or out of quota for this key: use one that works, without waiting for an admin to change the setting.
        working.remove(prefKey);
        List<String> others = new ArrayList<>();
        if (configured != null && !configured.equals(first)) others.add(configured);
        try {
            for (String m : candidatesFor(t, key))
                if (!m.equals(first) && !others.contains(m)) others.add(m);
        } catch (RuntimeException listFailed) {
            if (others.isEmpty()) throw firstFailure;               // couldn't even list alternatives: say what went wrong with the first
        }
        int tried = 0;
        for (String m : others) {
            if (tried++ >= maxOthers) break;
            try {
                Result r = send(t, m, system, user, maxOutputTokens);
                working.put(prefKey, new Pref(m, configured, System.currentTimeMillis() + PREF_MS));
                return r;
            } catch (LlmException e) {
                if (e.getKind() == Kind.AUTH) throw e;
                if (!otherModelMayHelp(e)) throw e;
            }
        }
        throw firstFailure;
    }

    private List<String> candidatesFor(Target t, String key) { return catalog.candidates(t.provider(), key, t.baseUrl()); }

    /** One call to the provider with the given model (null = the provider's default). */
    private Result send(Target t, String model, String system, String user, int maxOutputTokens) {
        String provider = t.provider();
        String key = crypto.decrypt(t.encKey()).trim();

        String url;
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Content-Type", "application/json");
        Map<String, Object> body = new LinkedHashMap<>();
        switch (provider) {
            case "OPENAI", "CUSTOM" -> {
                boolean custom = provider.equals("CUSTOM");
                url = custom ? t.baseUrl().trim() : "https://api.openai.com/v1/chat/completions";
                headers.put("Authorization", "Bearer " + key);
                body.put("model", model != null ? model : "gpt-4o-mini");
                // OpenAI's newer models require max_completion_tokens; the other OpenAI-style services (Groq, Mistral, OpenRouter, Cerebras, Ollama…) all accept the older max_tokens.
                body.put(custom ? "max_tokens" : "max_completion_tokens", maxOutputTokens);
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
        if (st == 404) {
            // The most common cause: the chosen model was retired or isn't offered to this key. Say so, and what to do.
            throw new LlmException(Kind.BAD_RESPONSE, "The model \"" + (model == null ? "default" : model) + "\" isn't available for this key. "
                    + "Open AI Settings, load the models and choose one from the list.");
        }
        if (st == 429 && r.body() != null && r.body().contains("limit: 0"))
            throw new LlmException(Kind.BAD_RESPONSE, "This key has no quota for the model \"" + model + "\". Choose another model in AI Settings, or turn on billing for the key.");
        if (st == 429) throw new LlmException(Kind.RATE_LIMITED, "The AI provider is rate limiting requests.");
        if (st >= 500) {
            String why = LlmModelCatalog.providerMessage(r.body(), key);
            boolean busy = st == 503 || (why != null && why.toLowerCase(java.util.Locale.ROOT).matches(".*(high demand|overloaded|unavailable|try again later).*"));
            throw new LlmException(Kind.SERVER, busy
                    ? "The AI model \"" + (model == null ? "default" : model) + "\" is overloaded right now (the provider says it is busy" + (why == null ? "" : ": " + why) + ")."
                    : "The AI provider had an internal error (" + st + ")" + (why == null ? "." : ": " + why));
        }
        if (st < 200 || st >= 300) {
            boolean big = (st == 400 || st == 413) && r.body() != null && TOO_LARGE.matcher(r.body()).find();
            String why = LlmModelCatalog.providerMessage(r.body(), key);        // the provider's own words, shortened, key removed
            throw new LlmException(big ? Kind.INPUT_TOO_LARGE : Kind.BAD_RESPONSE,
                    big ? "The configured model can't take this much text."
                        : "The AI provider didn't accept the request" + (why == null ? "." : ": " + why));
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

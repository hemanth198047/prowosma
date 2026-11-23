package com.prowosma.backend.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.integration.LlmException;
import com.prowosma.backend.integration.LlmException.Kind;
import com.prowosma.backend.integration.LlmHttp;
import com.prowosma.backend.integration.OutboundUrlPolicy;
import com.prowosma.backend.model.AISettings;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.*;
import java.util.regex.Pattern;

/**
 * Asks the AI provider which models a key can actually use, so AI Settings never has to ship a hard-coded model list
 * that goes stale when a provider retires or adds models. Works for Anthropic, OpenAI, Gemini and any OpenAI-compatible
 * custom endpoint (it asks {@code /models} next to the chat endpoint).
 *
 * The key is only ever placed in a request header. Without a key in the request, the saved key is used — but only for
 * the provider it was saved for, so a saved key is never sent to a different provider's host.
 */
@Service
@RequiredArgsConstructor
public class LlmModelCatalog {

    /** Not chat/text models, or models this app's chat calls can't drive (no system prompt support, media-only, etc.). */
    private static final Pattern NOT_CHAT = Pattern.compile(
            "(?i)(embed|tts|speech|whisper|transcri|audio|realtime|image|imagen|dall-e|veo|lyria|moderation|aqa|"
            + "robotics|computer-use|omni|live|native-audio|nano-banana|antigravity|deep-research|customtools|"
            + "davinci|babbage|search-preview|gemma|codex-mini-latest)");
    private static final Pattern PREVIEW = Pattern.compile("(?i)(preview|exp|experimental|beta)");
    private static final Pattern OPENAI_CHAT = Pattern.compile("^(gpt-|chatgpt-|o\\d).*");
    private static final int MAX_PAGES = 5;

    private final AISettingsService settingsService;
    private final FieldEncryptionService crypto;
    private final LlmHttp http;
    private final ObjectMapper om = new ObjectMapper();

    @Value("${app.integrations.allow-private-hosts:false}")
    private boolean allowPrivateHosts;

    public record Models(String provider, List<String> models) {}

    /**
     * @param provider ANTHROPIC | OPENAI | GEMINI | CUSTOM
     * @param typedKey a key typed in the page (not saved yet), or null/blank to use the saved key
     * @param baseUrl  CUSTOM only: the chat endpoint address from AI Settings
     */
    public Models list(String provider, String typedKey, String baseUrl) {
        String p = provider == null || provider.isBlank() ? "ANTHROPIC" : provider.trim().toUpperCase(Locale.ROOT);
        if (!Set.of("ANTHROPIC", "OPENAI", "GEMINI", "CUSTOM").contains(p))
            throw new LlmException(Kind.NOT_CONFIGURED, "Unknown AI provider.");

        AISettings saved = settingsService.get();
        String key = typedKey == null ? "" : typedKey.trim();
        String savedBase = saved.getApiBaseUrl();
        if (key.isEmpty()) {
            String savedProvider = saved.getApiProvider() == null || saved.getApiProvider().isBlank() ? "ANTHROPIC" : saved.getApiProvider().trim().toUpperCase(Locale.ROOT);
            // Never send the saved key to a provider/endpoint it wasn't saved for.
            boolean sameTarget = savedProvider.equals(p) && (!p.equals("CUSTOM") || sameUrl(savedBase, baseUrl));
            if (sameTarget && saved.getApiKey() != null && !saved.getApiKey().isBlank()) key = crypto.decrypt(saved.getApiKey()).trim();
        }
        if (key.isEmpty() && !p.equals("CUSTOM")) throw new LlmException(Kind.NOT_CONFIGURED, "Enter the API key to load the available models.");

        List<String> ids = switch (p) {
            case "GEMINI" -> gemini(key);
            case "OPENAI" -> openai("https://api.openai.com/v1/models", key, true);
            case "ANTHROPIC" -> anthropic(key);
            default -> custom(baseUrl, key);
        };
        return new Models(p, order(ids));
    }

    // ── providers ─────────────────────────────────────────────────────────────

    private List<String> gemini(String key) {
        Map<String, String> h = new LinkedHashMap<>();
        h.put("x-goog-api-key", key);                                   // header, not ?key=, so it can't leak into URLs/logs
        List<String> out = new ArrayList<>();
        String page = null;
        for (int i = 0; i < MAX_PAGES; i++) {
            String url = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200" + (page == null ? "" : "&pageToken=" + java.net.URLEncoder.encode(page, java.nio.charset.StandardCharsets.UTF_8));
            JsonNode n = get(url, h);
            for (JsonNode m : n.path("models")) {
                boolean canGenerate = false;
                for (JsonNode method : m.path("supportedGenerationMethods")) if ("generateContent".equals(method.asText())) canGenerate = true;
                String id = m.path("name").asText("").replaceFirst("^models/", "");
                if (canGenerate && id.startsWith("gemini") && !NOT_CHAT.matcher(id).find()) out.add(id);
            }
            page = n.path("nextPageToken").asText("");
            if (page.isEmpty()) break;
        }
        return out;
    }

    private List<String> openai(String url, String key, boolean filter) {
        Map<String, String> h = new LinkedHashMap<>();
        if (!key.isEmpty()) h.put("Authorization", "Bearer " + key);
        JsonNode n = get(url, h);
        List<String> out = new ArrayList<>();
        for (JsonNode m : n.path("data")) {
            String id = m.path("id").asText("");
            if (id.isEmpty()) continue;
            if (!filter || (OPENAI_CHAT.matcher(id).matches() && !NOT_CHAT.matcher(id).find())) out.add(id);
        }
        return out;
    }

    private List<String> anthropic(String key) {
        Map<String, String> h = new LinkedHashMap<>();
        h.put("x-api-key", key);
        h.put("anthropic-version", "2023-06-01");
        JsonNode n = get("https://api.anthropic.com/v1/models?limit=1000", h);
        List<String> out = new ArrayList<>();
        for (JsonNode m : n.path("data")) {
            String id = m.path("id").asText("");
            if (id.startsWith("claude")) out.add(id);
        }
        return out;
    }

    private List<String> custom(String baseUrl, String key) {
        if (baseUrl == null || baseUrl.isBlank()) throw new LlmException(Kind.NOT_CONFIGURED, "Enter the endpoint address first.");
        try {
            OutboundUrlPolicy.parseHttps(baseUrl.trim(), "AI endpoint");
        } catch (IllegalArgumentException e) {
            throw new LlmException(Kind.NOT_CONFIGURED, "The custom AI endpoint address isn't a valid https address.");
        }
        // OpenAI-style: https://host/v1/chat/completions  ->  https://host/v1/models
        String u = baseUrl.trim().replaceAll("/+$", "");
        String models = u.matches("(?i).*/chat/completions$") ? u.replaceFirst("(?i)/chat/completions$", "/models")
                : u.matches("(?i).*/v1$") ? u + "/models" : u.replaceAll("(?i)/[^/]+$", "/models");
        return openai(models, key, false);
    }

    // ── plumbing ──────────────────────────────────────────────────────────────

    private JsonNode get(String url, Map<String, String> headers) {
        Map<String, String> h = new LinkedHashMap<>(headers);
        h.put("Accept", "application/json");
        LlmHttp.Result r;
        try {
            r = http.send("GET", url, h, null, allowPrivateHosts);
        } catch (IOException e) {
            throw new LlmException(Kind.NETWORK, "Couldn't reach the AI provider.");
        } catch (IllegalArgumentException e) {
            throw new LlmException(Kind.NOT_CONFIGURED, "That AI endpoint isn't allowed (it must be a public https address).");
        }
        int st = r.status();
        // Gemini answers a bad key with 400 ("API key not valid"), the others with 401/403.
        if (st == 401 || st == 403 || (st == 400 && r.body() != null && r.body().toLowerCase(Locale.ROOT).contains("api key")))
            throw new LlmException(Kind.AUTH, "The AI provider rejected this API key.");
        if (st == 429) throw new LlmException(Kind.RATE_LIMITED, "The AI provider is rate limiting requests. Try again in a minute.");
        if (st >= 500) throw new LlmException(Kind.SERVER, "The AI provider had a problem. Try again shortly.");
        if (st == 404) throw new LlmException(Kind.BAD_RESPONSE, "This endpoint doesn't list its models. Type the model name instead.");
        if (st < 200 || st >= 300) throw new LlmException(Kind.BAD_RESPONSE, "The AI provider didn't accept the request.");
        try {
            return om.readTree(r.body());
        } catch (IOException | RuntimeException e) {
            throw new LlmException(Kind.BAD_RESPONSE, "The AI provider's reply couldn't be read.");
        }
    }

    /** Stable releases before previews, then by name — so the first entry is a sensible default. */
    static List<String> order(Collection<String> ids) {
        List<String> out = new ArrayList<>(new LinkedHashSet<>(ids));
        out.sort(Comparator.comparing((String s) -> PREVIEW.matcher(s).find()).thenComparing(Comparator.naturalOrder()));
        return out;
    }

    private static boolean sameUrl(String a, String b) {
        String x = a == null ? "" : a.trim().replaceAll("/+$", "");
        String y = b == null ? "" : b.trim().replaceAll("/+$", "");
        return !x.isEmpty() && x.equalsIgnoreCase(y);
    }
}

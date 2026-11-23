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
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
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
    private static final int MAX_PROBES = 16;                       // models tested per lookup
    private static final long CACHE_MS = 10 * 60 * 1000L;
    private record Cached(long at, List<String> models) {}
    private final Map<String, Cached> cache = new ConcurrentHashMap<>();

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
    public Models list(String provider, String typedKey, String baseUrl) { return list(provider, typedKey, baseUrl, false); }

    /** @param refresh true = skip the 10-minute memory of an earlier answer for this key */
    public Models list(String provider, String typedKey, String baseUrl, boolean refresh) {
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

        String cacheKey = p + ":" + sha(key + "|" + (baseUrl == null ? "" : baseUrl));
        Cached hit = cache.get(cacheKey);
        if (!refresh && hit != null && System.currentTimeMillis() - hit.at() < CACHE_MS) return new Models(p, hit.models());

        List<String> ids = switch (p) {
            case "GEMINI" -> workingOnly(key, order(gemini(key)));
            case "OPENAI" -> openai("https://api.openai.com/v1/models", key, true);
            case "ANTHROPIC" -> anthropic(key);
            default -> custom(baseUrl, key);
        };
        List<String> ordered = order(ids);
        cache.put(cacheKey, new Cached(System.currentTimeMillis(), ordered));
        return new Models(p, ordered);
    }

    /**
     * Models to try when the chosen one is busy or unavailable, for a given key (no request context needed, so background jobs can use it).
     * Listed only, not tested: the real call that follows is the test. Cached with the rest.
     */
    public List<String> candidates(String provider, String key, String baseUrl) {
        String p = provider == null || provider.isBlank() ? "ANTHROPIC" : provider.trim().toUpperCase(Locale.ROOT);
        String cacheKey = "C:" + p + ":" + sha(key + "|" + (baseUrl == null ? "" : baseUrl));
        Cached hit = cache.get(cacheKey);
        if (hit != null && System.currentTimeMillis() - hit.at() < CACHE_MS) return hit.models();
        List<String> ids = switch (p) {
            case "GEMINI" -> gemini(key);
            case "OPENAI" -> openai("https://api.openai.com/v1/models", key, true);
            case "ANTHROPIC" -> anthropic(key);
            default -> custom(baseUrl, key);
        };
        List<String> ordered = order(ids);
        cache.put(cacheKey, new Cached(System.currentTimeMillis(), ordered));
        return ordered;
    }

    // ── "listed" is not "usable": ask each Gemini model for one tiny reply and keep only the ones that answer ──

    /** Google lists models it then refuses ("no longer available to new users", quota 0 on a free key). Only offer models that really answer. */
    private List<String> workingOnly(String key, List<String> candidates) {
        if (candidates.isEmpty()) throw new LlmException(Kind.BAD_RESPONSE, "This key has no Gemini chat models. Create a key at aistudio.google.com/apikey.");
        List<String> tryThese = candidates.subList(0, Math.min(MAX_PROBES, candidates.size()));
        ExecutorService pool = Executors.newFixedThreadPool(4);
        Map<String, Probe> results = new ConcurrentHashMap<>();
        try {
            List<Callable<Void>> jobs = new ArrayList<>();
            for (String id : tryThese) jobs.add(() -> { results.put(id, probe(key, id)); return null; });
            pool.invokeAll(jobs, 40, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            pool.shutdownNow();
        }
        List<String> ok = new ArrayList<>();
        String why = null;
        for (String id : tryThese) {
            Probe pr = results.get(id);
            if (pr != null && pr.usable()) ok.add(id);
            else if (pr != null && why == null && pr.message() != null) why = pr.message();
        }
        if (ok.isEmpty()) {
            if (results.isEmpty()) throw new LlmException(Kind.NETWORK, "Google didn't answer in time. Try Refresh models in a minute.");
            throw new LlmException(Kind.BAD_RESPONSE, "None of this key's models accepted a test request."
                    + (why == null ? "" : " Google said: " + why + (why.matches(".*[.!?…]$") ? "" : "."))
                    + " Create a new key at aistudio.google.com/apikey, or turn on billing for it.");
        }
        return ok;
    }

    record Probe(boolean usable, int status, String message) {}

    private Probe probe(String key, String id) {
        Map<String, String> h = new LinkedHashMap<>();
        h.put("x-goog-api-key", key);
        h.put("Content-Type", "application/json");
        String body = "{\"systemInstruction\":{\"parts\":[{\"text\":\"Reply with one word.\"}]},"
                + "\"contents\":[{\"role\":\"user\",\"parts\":[{\"text\":\"Hi\"}]}],\"generationConfig\":{\"maxOutputTokens\":16}}";
        try {
            LlmHttp.Result r = http.send("POST", "https://generativelanguage.googleapis.com/v1beta/models/" + id + ":generateContent", h, body, allowPrivateHosts);
            if (r.status() >= 200 && r.status() < 300) return new Probe(true, r.status(), null);
            String msg = providerMessage(r.body(), key);
            // A passing rate limit still means the model works; "limit: 0" means this key has no quota for it at all.
            boolean passingLimit = r.status() == 429 && !(r.body() != null && r.body().contains("limit: 0"));
            return new Probe(passingLimit, r.status(), msg);
        } catch (IOException | RuntimeException e) {
            return new Probe(false, 0, null);
        }
    }

    /** error.message from a provider reply, shortened and with the key removed. Null when there isn't one. */
    public static String providerMessage(String body, String key) {
        if (body == null || body.isBlank()) return null;
        try {
            String m = new ObjectMapper().readTree(body).path("error").path("message").asText("");
            if (m.isBlank()) return null;
            if (key != null && !key.isBlank()) m = m.replace(key, "***");
            m = m.replaceAll("\\s+", " ").trim();
            return m.length() > 220 ? m.substring(0, 220) + "…" : m;
        } catch (IOException | RuntimeException e) {
            return null;
        }
    }

    private static String sha(String x) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(x.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 12; i++) sb.append(String.format("%02x", d[i]));
            return sb.toString();
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
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

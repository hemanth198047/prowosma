package com.prowosma.backend.uma.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.integration.LlmException;
import com.prowosma.backend.integration.LlmHttp;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A model the server operator runs (Ollama, llama.cpp server, vLLM, LM Studio, LocalAI …) behind the OpenAI chat-completions API.
 * Configured with server settings, not in the app: {@code app.uma.llm.base-url} (e.g. http://localhost:11434/v1), {@code app.uma.llm.model},
 * optional {@code app.uma.llm.api-key}. Because the operator sets it, private/local addresses are allowed. Nothing is sent anywhere else.
 */
@Component
public class SelfHostedAiModel implements MeetingAiModel {
    private final LlmHttp http;
    private final ObjectMapper om = new ObjectMapper();

    @Value("${app.uma.llm.base-url:}") private String baseUrl = "";
    @Value("${app.uma.llm.model:}") private String model = "";
    @Value("${app.uma.llm.api-key:}") private String apiKey = "";

    public SelfHostedAiModel(com.prowosma.backend.uma.core.OperatorHttp operatorHttp) { this.http = operatorHttp.llm(); }

    /** Test seam. */
    void configure(String baseUrl, String model) { this.baseUrl = baseUrl; this.model = model; }

    @Override public String name() { return "self-hosted"; }

    @Override
    public String notReadyReason(String org) {
        if (baseUrl == null || baseUrl.isBlank()) return "No self-hosted AI model is configured on the server.";
        if (model == null || model.isBlank()) return "The self-hosted AI model name is missing on the server.";
        return null;
    }

    static String endpoint(String base) {
        String b = base.trim();
        while (b.endsWith("/")) b = b.substring(0, b.length() - 1);
        if (b.endsWith("/chat/completions")) return b;
        if (!b.endsWith("/v1")) b = b + "/v1";
        return b + "/chat/completions";
    }

    @Override
    public Reply complete(String org, String system, String user, int maxOutputTokens) {
        String reason = notReadyReason(org);
        if (reason != null) throw new LlmException(LlmException.Kind.NOT_CONFIGURED, reason);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("model", model.trim());
        body.put("temperature", 0.1);
        body.put("max_tokens", maxOutputTokens);
        body.put("messages", List.of(Map.of("role", "system", "content", system), Map.of("role", "user", "content", user)));
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Content-Type", "application/json");
        if (apiKey != null && !apiKey.isBlank()) headers.put("Authorization", "Bearer " + apiKey.trim());
        LlmHttp.Result r;
        try {
            r = http.send("POST", endpoint(baseUrl), headers, om.writeValueAsString(body), true);
        } catch (IOException e) {
            throw new LlmException(LlmException.Kind.NETWORK, "The self-hosted AI model didn't answer.");
        }
        if (r.status() == 401 || r.status() == 403) throw new LlmException(LlmException.Kind.AUTH, "The self-hosted AI model refused the key.");
        if (r.status() == 429) throw new LlmException(LlmException.Kind.RATE_LIMITED, "The self-hosted AI model is busy.");
        if (r.status() >= 500) throw new LlmException(LlmException.Kind.SERVER, "The self-hosted AI model is down or failed.");
        if (r.status() == 413) throw new LlmException(LlmException.Kind.INPUT_TOO_LARGE, "The meeting is too long for the self-hosted AI model in one go.");
        if (r.status() != 200) throw new LlmException(LlmException.Kind.BAD_RESPONSE, "The self-hosted AI model rejected the request (" + r.status() + ").");
        try {
            JsonNode root = om.readTree(r.body());
            JsonNode choice = root.path("choices").path(0);
            String text = choice.path("message").path("content").asText(null);
            if (text == null || text.isBlank()) throw new LlmException(LlmException.Kind.BAD_RESPONSE, "The self-hosted AI model answered with nothing.");
            boolean truncated = "length".equals(choice.path("finish_reason").asText(""));
            return new Reply(text, root.path("usage").path("prompt_tokens").asInt(0), root.path("usage").path("completion_tokens").asInt(0),
                    "self-hosted", root.path("model").asText(model), truncated);
        } catch (IOException e) {
            throw new LlmException(LlmException.Kind.BAD_RESPONSE, "The self-hosted AI model's answer couldn't be read.");
        }
    }
}

package com.prowosma.backend.integration;

/** The only door to a language model. Replaceable: tests script it, and other providers plug in behind it. */
public interface LlmClient {

    record Result(String text, int inputTokens, int outputTokens, String provider, String model, boolean truncated) {}

    /** null when AI is ready for this organization, otherwise a plain-language reason it isn't. */
    String notReadyReason(String organizationId);

    default boolean isReady(String organizationId) { return notReadyReason(organizationId) == null; }

    /** @throws LlmException on any failure — this client NEVER returns made-up fallback text. */
    Result complete(String organizationId, String system, String user, int maxOutputTokens);
}

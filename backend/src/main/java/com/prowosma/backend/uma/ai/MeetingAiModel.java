package com.prowosma.backend.uma.ai;

/** One language model the meeting assistant can use. Implementations never invent text when they fail: they throw. */
public interface MeetingAiModel {
    record Reply(String text, int inputTokens, int outputTokens, String provider, String model, boolean truncated) {}

    String name();

    /** null when usable for this workspace, otherwise a plain-language reason. */
    String notReadyReason(String org);

    Reply complete(String org, String system, String user, int maxOutputTokens);
}

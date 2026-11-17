package com.prowosma.backend.uma.ai;

import com.prowosma.backend.integration.LlmClient;
import org.springframework.stereotype.Component;

/** The provider an admin chose in AI Settings (Anthropic, OpenAI, Gemini or a custom HTTPS endpoint), via the existing strict client. */
@Component
public class WorkspaceAiModel implements MeetingAiModel {
    private final LlmClient llm;

    public WorkspaceAiModel(LlmClient llm) { this.llm = llm; }

    @Override public String name() { return "workspace"; }

    @Override public String notReadyReason(String org) { return llm.notReadyReason(org); }

    @Override
    public Reply complete(String org, String system, String user, int maxOutputTokens) {
        LlmClient.Result r = llm.complete(org, system, user, maxOutputTokens);
        return new Reply(r.text(), r.inputTokens(), r.outputTokens(), r.provider(), r.model(), r.truncated());
    }
}

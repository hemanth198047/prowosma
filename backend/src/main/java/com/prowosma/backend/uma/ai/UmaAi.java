package com.prowosma.backend.uma.ai;

import com.prowosma.backend.integration.LlmException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * Picks the model for each call, with a fallback. Order: {@code app.uma.llm.prefer} = "workspace" (default: the AI Settings provider first,
 * then the self-hosted model) or "self-hosted". A model that isn't set up is skipped; a model that fails with a temporary error
 * (busy, down, network) hands over to the next one. Permanent errors (bad key, rejected request) are reported, not hidden.
 */
@Component
@Slf4j
public class UmaAi {
    private final List<MeetingAiModel> ordered;

    @org.springframework.beans.factory.annotation.Autowired
    public UmaAi(WorkspaceAiModel workspace, SelfHostedAiModel selfHosted, @Value("${app.uma.llm.prefer:workspace}") String prefer) {
        this.ordered = "self-hosted".equalsIgnoreCase(prefer) ? List.of(selfHosted, workspace) : List.of(workspace, selfHosted);
    }

    /** For tests: an explicit order. */
    public UmaAi(List<MeetingAiModel> ordered) { this.ordered = List.copyOf(ordered); }

    /** null when at least one model is usable; otherwise every reason, joined. */
    public String notReadyReason(String org) {
        List<String> reasons = new ArrayList<>();
        for (MeetingAiModel m : ordered) {
            String r = m.notReadyReason(org);
            if (r == null) return null;
            reasons.add(r);
        }
        return reasons.isEmpty() ? "No AI model is set up." : String.join(" ", reasons.subList(0, 1));
    }

    public MeetingAiModel.Reply complete(String org, String system, String user, int maxOutputTokens) {
        LlmException last = null;
        for (MeetingAiModel m : ordered) {
            if (m.notReadyReason(org) != null) continue;
            try {
                return m.complete(org, system, user, maxOutputTokens);
            } catch (LlmException e) {
                last = e;
                if (!e.isTransient()) throw e;
                log.info("uma ai: {} failed ({}), trying the next model", m.name(), e.getKind());
            }
        }
        if (last != null) throw last;
        throw new LlmException(LlmException.Kind.NOT_CONFIGURED, notReadyReason(org));
    }
}

package com.prowosma.backend.uma;

import com.prowosma.backend.integration.LlmException;
import com.prowosma.backend.integration.SttHttp;
import com.prowosma.backend.uma.ai.InsightPrompts;
import com.prowosma.backend.uma.ai.MeetingAiModel;

import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Function;

/**
 * SCRIPTED STAND-INS used only by tests. They prove our pipeline, validation, permissions and task creation;
 * they do NOT prove how a real speech-to-text engine or language model behaves (that is validated separately
 * against real self-hosted engines, see docs/universal-meeting-assistant/06-VALIDATION.md).
 */
final class UmaFakes {
    private UmaFakes() {}

    static final List<String> LINES = List.of(
            "Good morning everyone, let's start the weekly sync.",
            "Ravi will complete the authentication API by Friday.",
            "We decided to launch on 20 November if the security review passes.",
            "The CDN contract renewal is a risk for the launch.",
            "Someone needs to follow up with procurement.",
            "Does marketing have access to staging yet?");

    /** Speech-to-text server stand-in: answers every audio piece with the six lines above (OpenAI verbose_json shape). */
    static final class Stt implements SttHttp {
        final AtomicInteger calls = new AtomicInteger();
        volatile Integer failStatus = null;
        volatile String body = null;

        void reset() { calls.set(0); failStatus = null; body = null; }

        @Override
        public Result post(String url, Map<String, String> headers, byte[] payload, boolean allowPrivateHosts) {
            calls.incrementAndGet();
            if (failStatus != null) return new Result(failStatus, "{\"error\":{\"message\":\"scripted failure\"}}");
            if (body != null) return new Result(200, body);
            StringBuilder sb = new StringBuilder("{\"language\":\"en\",\"segments\":[");
            for (int i = 0; i < LINES.size(); i++) {
                if (i > 0) sb.append(',');
                sb.append("{\"start\":").append(i * 5).append(",\"end\":").append(i * 5 + 4)
                  .append(",\"text\":\"").append(LINES.get(i)).append("\",\"no_speech_prob\":0.01}");
            }
            return new Result(200, sb.append("]}").toString());
        }
    }

    /** Language model stand-in. By default returns notes for the six lines, including two items the validator must drop. */
    static final class Ai implements MeetingAiModel {
        record Call(String system, String user) {}
        final List<Call> calls = new CopyOnWriteArrayList<>();
        volatile String notReady = null;
        volatile Function<Call, String> responder = null;
        volatile LlmException failWith = null;

        void reset() { calls.clear(); notReady = null; responder = null; failWith = null; }

        @Override public String name() { return "scripted"; }
        @Override public String notReadyReason(String org) { return notReady; }

        @Override
        public Reply complete(String org, String system, String user, int maxOutputTokens) {
            Call c = new Call(system, user);
            calls.add(c);
            if (failWith != null) throw failWith;
            String text = responder != null ? responder.apply(c)
                    : system.equals(InsightPrompts.ASK_SYSTEM) ? ASK_DEFAULT : EXTRACT_DEFAULT;
            return new Reply(text, 100, 50, "scripted", "fake-1", false);
        }
    }

    static final String EXTRACT_DEFAULT = """
            {"summary": "The team agreed the launch plan and owners.",
             "notes": [{"title": "Launch", "points": [{"text": "Launch depends on the security review", "evidence": [3]}]}],
             "decisions": [{"text": "Launch on 20 November if the security review passes", "decidedBy": null, "evidence": [3]}],
             "actions": [
               {"title": "Complete the authentication API", "description": "", "owner": "Ravi", "due": "by Friday", "priority": "HIGH", "confidence": "HIGH", "evidence": [2]},
               {"title": "Follow up with procurement", "description": "", "owner": "Priya", "due": "next Monday", "priority": "MEDIUM", "confidence": "LOW", "evidence": [5]},
               {"title": "Invented item", "owner": null, "due": null, "evidence": [99]}
             ],
             "risks": [{"text": "CDN contract renewal", "kind": "RISK", "evidence": [4]}],
             "questions": [{"text": "Does marketing have staging access?", "evidence": [6]}],
             "followUps": []}
            """;

    static final String ASK_DEFAULT = "{\"answer\": \"Ravi will complete the authentication API by Friday.\", \"evidence\": [2], \"found\": true}";
}

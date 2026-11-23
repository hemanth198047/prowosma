package com.prowosma.backend.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.integration.LlmException;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class AIServiceTest {
    private final AIService ai = new AIService(new ObjectMapper(), null, null, null, null);

    @Test
    void jsonIsFoundInsideFencesAndChatter() {
        Map<?, ?> m = ai.readJson("Sure! Here you go:\n```json\n{\"a\": 1, \"b\": [\"x\"]}\n```\nHope that helps.", Map.class);
        assertEquals(1, m.get("a"));
        assertEquals(List.of("x"), m.get("b"));
    }

    @Test
    void anObjectWhereAListWasWantedIsSearchedForItsList_andTheOtherWayRound() {
        List<?> l = ai.readJson("{\"tasks\": [{\"title\": \"A\"}, {\"title\": \"B\"}]}", List.class);
        assertEquals(2, l.size());
        Map<?, ?> m = ai.readJson("[1, 2]", Map.class);
        assertEquals(List.of(1, 2), m.get("items"));
    }

    @Test
    void textWithoutJsonOrCutOffJsonGivesNullSoTheCallerCanAskAgain() {
        assertNull(ai.readJson("I'm sorry, I can't do that.", Map.class));
        assertNull(ai.readJson("{\"a\": [1, 2", Map.class));
        assertNull(ai.readJson(null, Map.class));
        assertNull(ai.readJson("{\"only\": \"an object\"}", List.class));
    }

    @Test
    void everyProviderFailureIsExplainedInPlainWordsWithWhatToDo() {
        for (LlmException.Kind k : LlmException.Kind.values()) {
            AiProblem p = AIService.explain(new LlmException(k, "Something specific."));
            assertNotNull(p.getMessage());
            assertNotNull(p.getHint(), "a hint for " + k);
            assertFalse((p.getMessage() + p.getHint()).toLowerCase().matches(".*(exception|http|status|stack|json).*"), "no technical words for " + k);
        }
        assertTrue(AIService.explain(new LlmException(LlmException.Kind.AUTH, "x")).getHint().contains("AI Settings"));
    }
}

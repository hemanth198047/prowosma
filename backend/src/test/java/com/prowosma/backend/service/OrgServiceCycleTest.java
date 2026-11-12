package com.prowosma.backend.service;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class OrgServiceCycleTest {

    // ceo <- vp <- lead <- dev
    private Map<String, String> chain() {
        Map<String, String> m = new HashMap<>();
        m.put("ceo", null);
        m.put("vp", "ceo");
        m.put("lead", "vp");
        m.put("dev", "lead");
        return m;
    }

    @Test
    void reportingUpwardsIsFine() {
        assertFalse(OrgService.wouldCreateCycle(chain(), "dev", "vp"));
        assertFalse(OrgService.wouldCreateCycle(chain(), "dev", null));
    }

    @Test
    void reportingToYourselfIsALoop() {
        assertTrue(OrgService.wouldCreateCycle(chain(), "lead", "lead"));
    }

    @Test
    void reportingToSomeoneBelowYouIsALoop() {
        assertTrue(OrgService.wouldCreateCycle(chain(), "vp", "dev"));
        assertTrue(OrgService.wouldCreateCycle(chain(), "ceo", "lead"));
    }

    @Test
    void existingLoopInDataDoesNotHang() {
        Map<String, String> m = new HashMap<>();
        m.put("a", "b");
        m.put("b", "a");
        assertFalse(OrgService.wouldCreateCycle(m, "c", "a"));
    }

    @Test
    void textTrimsBlanksAndCaps() {
        assertNull(OrgService.text("   ", 10));
        assertNull(OrgService.text(null, 10));
        assertEquals("abc", OrgService.text(" abc ", 10));
        assertEquals("abcde", OrgService.text("abcdefgh", 5));
    }
}

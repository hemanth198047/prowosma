package com.prowosma.backend.integration;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

@DisplayName("Inbound events — tokens, signatures and what an event does to a task")
class InboundSecurityTest {

    // ── tokens ───────────────────────────────────────────────────────────────

    @Test
    @DisplayName("tokens are 256 random bits, URL-safe, and never repeat")
    void tokensAreRandom() {
        Set<String> seen = new HashSet<>();
        for (int i = 0; i < 500; i++) {
            String t = InboundTokens.generate();
            assertEquals(43, t.length());
            assertTrue(InboundTokens.looksValid(t));
            assertTrue(seen.add(t));
        }
    }

    @Test
    @DisplayName("hashing is deterministic, hex, and different for different tokens")
    void hashing() {
        String a = InboundTokens.generate(), b = InboundTokens.generate();
        assertEquals(InboundTokens.hash(a), InboundTokens.hash(a));
        assertEquals(64, InboundTokens.hash(a).length());
        assertFalse(InboundTokens.hash(a).equals(InboundTokens.hash(b)));
        assertFalse(InboundTokens.hash(a).contains(a));
    }

    @Test
    @DisplayName("garbage is recognised as not-a-token before any lookup")
    void shapeCheck() {
        for (String bad : new String[]{null, "", "short", "x".repeat(44), "x".repeat(42), "a".repeat(42) + "!", "../../etc/passwd",
                "a".repeat(42) + " ", "a".repeat(42) + "=", "%2e".repeat(14) + "aa"}) {
            assertFalse(InboundTokens.looksValid(bad), String.valueOf(bad));
        }
    }

    // ── signatures ───────────────────────────────────────────────────────────

    private static final byte[] BODY = "{\"action\":\"created\"}".getBytes(StandardCharsets.UTF_8);

    @Test
    @DisplayName("HMAC-SHA256 matches the published test vector")
    void hmacVector() {
        // RFC 4231 test case 2: key "Jefe", data "what do ya want for nothing?"
        assertEquals("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
                Signatures.hmacSha256Hex("Jefe", "what do ya want for nothing?".getBytes(StandardCharsets.UTF_8)));
    }

    @Test
    @DisplayName("a correct signature verifies; wrong secret, altered body, missing or malformed header do not")
    void verification() {
        String sig = Signatures.hmacSha256Hex("s3cret", BODY);
        assertTrue(Signatures.matches("s3cret", BODY, sig));
        assertTrue(Signatures.matches("s3cret", BODY, sig.toUpperCase()));
        assertTrue(Signatures.matches("s3cret", BODY, " sha256=" + sig + " "));
        assertFalse(Signatures.matches("other", BODY, sig));
        assertFalse(Signatures.matches("s3cret", "{\"action\":\"resolved\"}".getBytes(StandardCharsets.UTF_8), sig));
        assertFalse(Signatures.matches("s3cret", BODY, null));
        assertFalse(Signatures.matches("s3cret", BODY, ""));
        assertFalse(Signatures.matches("s3cret", BODY, sig.substring(1)));
        assertFalse(Signatures.matches(null, BODY, sig));
        assertFalse(Signatures.matches("", BODY, sig));
    }

    // ── planner ──────────────────────────────────────────────────────────────

    @Test
    @DisplayName("a new problem creates a task; a repeat of an open one does nothing; a repeat of a closed one reopens it")
    void openEvents() {
        assertEquals(InboundPlanner.Plan.CREATE, InboundPlanner.plan(InboundEvent.Action.OPEN, null));
        assertEquals(InboundPlanner.Plan.NOTHING, InboundPlanner.plan(InboundEvent.Action.OPEN, "TODO"));
        assertEquals(InboundPlanner.Plan.NOTHING, InboundPlanner.plan(InboundEvent.Action.OPEN, "IN_PROGRESS"));
        assertEquals(InboundPlanner.Plan.REOPEN, InboundPlanner.plan(InboundEvent.Action.OPEN, "DONE"));
        assertEquals(InboundPlanner.Plan.REOPEN, InboundPlanner.plan(InboundEvent.Action.OPEN, "done"));
    }

    @Test
    @DisplayName("a recovery closes an open task, and does nothing when there is none or it is already closed")
    void resolveEvents() {
        assertEquals(InboundPlanner.Plan.RESOLVE, InboundPlanner.plan(InboundEvent.Action.RESOLVE, "TODO"));
        assertEquals(InboundPlanner.Plan.RESOLVE, InboundPlanner.plan(InboundEvent.Action.RESOLVE, "IN_PROGRESS"));
        assertEquals(InboundPlanner.Plan.NOTHING, InboundPlanner.plan(InboundEvent.Action.RESOLVE, "DONE"));
        assertEquals(InboundPlanner.Plan.NOTHING, InboundPlanner.plan(InboundEvent.Action.RESOLVE, null));
    }

    @Test
    @DisplayName("ignored events never touch a task")
    void ignoredEvents() {
        for (String status : new String[]{null, "TODO", "DONE"}) {
            assertEquals(InboundPlanner.Plan.NOTHING, InboundPlanner.plan(InboundEvent.Action.IGNORE, status));
        }
    }

    @Test
    @DisplayName("the URL path names map to sources, case-insensitively, and unknown ones don't")
    void sources() {
        assertEquals(InboundSource.DATADOG, InboundSource.fromPath("datadog").orElseThrow());
        assertEquals(InboundSource.SENTRY, InboundSource.fromPath("SENTRY").orElseThrow());
        assertEquals(InboundSource.JENKINS, InboundSource.fromIntegrationType("jenkins").orElseThrow());
        assertTrue(InboundSource.fromPath("github").isEmpty());
        assertTrue(InboundSource.fromPath(null).isEmpty());
        assertTrue(InboundSource.fromPath("").isEmpty());
    }
}

package com.prowosma.backend.auth;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.OptionalLong;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

@DisplayName("Totp — checked against the RFC 4226 / RFC 6238 published test vectors")
class TotpTest {

    /** The secret used by both RFCs' test vectors: the ASCII string "12345678901234567890". */
    private static final byte[] RFC_KEY = "12345678901234567890".getBytes(StandardCharsets.US_ASCII);
    private static final String RFC_SECRET_BASE32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

    @Test
    @DisplayName("HOTP (RFC 4226 appendix D): counters 0..9")
    void hotpVectors() {
        String[] expected = {"755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"};
        for (int counter = 0; counter < expected.length; counter++) {
            assertEquals(expected[counter], Totp.hotp(RFC_KEY, counter, 6), "counter " + counter);
        }
    }

    @Test
    @DisplayName("TOTP (RFC 6238 appendix B, SHA-1): the 8-digit vectors")
    void totpVectors8Digits() {
        long[] seconds = {59L, 1111111109L, 1111111111L, 1234567890L, 2000000000L, 20000000000L};
        String[] expected = {"94287082", "07081804", "14050471", "89005924", "69279037", "65353130"};
        for (int i = 0; i < seconds.length; i++) {
            assertEquals(expected[i], Totp.hotp(RFC_KEY, seconds[i] / 30, 8), "t=" + seconds[i]);
        }
    }

    @Test
    @DisplayName("the 6-digit codes an authenticator app shows are the last six digits of those vectors")
    void sixDigitCodes() {
        assertEquals("287082", Totp.codeAt(RFC_SECRET_BASE32, Totp.stepAt(59_000L)));
        assertEquals("081804", Totp.codeAt(RFC_SECRET_BASE32, Totp.stepAt(1111111109_000L)));
        assertEquals("005924", Totp.codeAt(RFC_SECRET_BASE32, Totp.stepAt(1234567890_000L)));
    }

    @Test
    @DisplayName("steps are 30 seconds long")
    void steps() {
        assertEquals(0, Totp.stepAt(29_999L));
        assertEquals(1, Totp.stepAt(30_000L));
        assertEquals(1, Totp.stepAt(59_999L));
        assertEquals(2, Totp.stepAt(60_000L));
    }

    // ── matching ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("matchStep tells you WHICH step a code belongs to (what makes replay detection possible)")
    void matchReturnsStep() {
        OptionalLong step = Totp.matchStep(RFC_SECRET_BASE32, "287082", 59_000L, 1);
        assertTrue(step.isPresent());
        assertEquals(1L, step.getAsLong());
    }

    @Test
    @DisplayName("a code from one step earlier or later is accepted (clock drift), two away is not")
    void window() {
        long now = 3 * 30_000L + 5_000L;                                   // in step 3
        String previous = Totp.codeAt(RFC_SECRET_BASE32, 2);
        String next = Totp.codeAt(RFC_SECRET_BASE32, 4);
        String twoBack = Totp.codeAt(RFC_SECRET_BASE32, 1);
        assertEquals(2L, Totp.matchStep(RFC_SECRET_BASE32, previous, now, 1).getAsLong());
        assertEquals(4L, Totp.matchStep(RFC_SECRET_BASE32, next, now, 1).getAsLong());
        assertTrue(Totp.matchStep(RFC_SECRET_BASE32, twoBack, now, 1).isEmpty());
        assertTrue(Totp.matchStep(RFC_SECRET_BASE32, twoBack, now, 2).isPresent());
        assertTrue(Totp.matchStep(RFC_SECRET_BASE32, previous, now, 0).isEmpty());
    }

    @Test
    @DisplayName("wrong codes and a wrong secret do not match")
    void mismatch() {
        assertTrue(Totp.matchStep(RFC_SECRET_BASE32, "000000", 59_000L, 1).isEmpty());
        assertTrue(Totp.matchStep("JBSWY3DPEHPK3PXP", "287082", 59_000L, 1).isEmpty());
    }

    @Test
    @DisplayName("only a six-digit number is a code: spaces/hyphens are tolerated, everything else is refused")
    void shapes() {
        assertTrue(Totp.matchStep(RFC_SECRET_BASE32, "287 082", 59_000L, 1).isPresent());
        assertTrue(Totp.matchStep(RFC_SECRET_BASE32, "287-082", 59_000L, 1).isPresent());
        for (String bad : new String[]{null, "", "28708", "2870822", "abcdef", "287o82", "287082\n", "+87082", "２８７０８２"}) {
            assertTrue(Totp.matchStep(RFC_SECRET_BASE32, bad, 59_000L, 1).isEmpty(), String.valueOf(bad));
        }
        assertTrue(Totp.matchStep(null, "287082", 59_000L, 1).isEmpty());
        assertTrue(Totp.matchStep("", "287082", 59_000L, 1).isEmpty());
    }

    // ── base32 ───────────────────────────────────────────────────────────────

    @Test
    @DisplayName("base32 secrets decode the way authenticator apps do: case, spaces and padding don't matter")
    void base32() {
        byte[] expected = "12345678901234567890".getBytes(StandardCharsets.US_ASCII);
        assertEquals(new String(expected, StandardCharsets.US_ASCII),
                new String(Totp.decodeBase32(RFC_SECRET_BASE32), StandardCharsets.US_ASCII));
        assertEquals(new String(expected, StandardCharsets.US_ASCII),
                new String(Totp.decodeBase32("gezd gnbv gy3t qojq gezd gnbv gy3t qojq"), StandardCharsets.US_ASCII));
        assertEquals("foobar", new String(Totp.decodeBase32("MZXW6YTBOI======"), StandardCharsets.US_ASCII));
        assertThrows(IllegalArgumentException.class, () -> Totp.decodeBase32("not base32!"));
        assertFalse(Totp.decodeBase32("MZXW6YTB").length == 0);
    }
}

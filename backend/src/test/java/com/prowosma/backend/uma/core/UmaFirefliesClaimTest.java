package com.prowosma.backend.uma.core;

import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.junit.jupiter.api.Assertions.*;

class UmaFirefliesClaimTest {

    @Test
    void sameMeetingLinkIsRecognisedWhateverTheCasingOrTracking() {
        String a = UmaFireflies.linkKey("https://Meet.Google.com/abc-defg-hij");
        assertEquals(a, UmaFireflies.linkKey(" https://meet.google.com/abc-defg-hij/?authuser=1#x "));
        assertNotEquals(a, UmaFireflies.linkKey("https://meet.google.com/zzz-yyyy-xxx"));
        assertNull(UmaFireflies.linkKey(null));
    }

    @Test
    void refusalMessageSaysWhoSentItAndWhenToTryAgain() {
        String msg = UmaFireflies.describe(new UmaFireflies.Claim(false, "asha@acme.test", Instant.now().minusSeconds(120), null));
        assertTrue(msg.contains("asha@acme.test") && msg.contains("already sent") && msg.contains("10 minutes"), msg);
        assertTrue(UmaFireflies.describe(new UmaFireflies.Claim(false, "automatic", null, null)).contains("Prowosma"));
    }
}

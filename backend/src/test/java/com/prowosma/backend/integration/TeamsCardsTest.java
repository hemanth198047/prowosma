package com.prowosma.backend.integration;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

@DisplayName("Teams — Adaptive Card payload and webhook URL validation")
class TeamsCardsTest {

    @SuppressWarnings("unchecked")
    private static Map<String, Object> content(Map<String, Object> envelope) {
        List<Map<String, Object>> attachments = (List<Map<String, Object>>) envelope.get("attachments");
        return (Map<String, Object>) attachments.get(0).get("content");
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> body(Map<String, Object> envelope) {
        return (List<Map<String, Object>>) content(envelope).get("body");
    }

    @Test
    @DisplayName("builds the message envelope Teams webhooks accept: an Adaptive Card attachment")
    void envelopeShape() {
        Map<String, Object> m = TeamsCards.notification("Deploy finished", "Release 1.4 is live", "#10b981");
        assertEquals("message", m.get("type"));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> attachments = (List<Map<String, Object>>) m.get("attachments");
        assertEquals(1, attachments.size());
        assertEquals("application/vnd.microsoft.card.adaptive", attachments.get(0).get("contentType"));
        assertTrue(attachments.get(0).containsKey("contentUrl"));
        assertNull(attachments.get(0).get("contentUrl"));
        Map<String, Object> card = content(m);
        assertEquals("AdaptiveCard", card.get("type"));
        assertEquals("1.4", card.get("version"));
        assertEquals("http://adaptivecards.io/schemas/adaptive-card.json", card.get("$schema"));
    }

    @Test
    @DisplayName("the card has a coloured heading, the message, and a footer")
    void bodyBlocks() {
        List<Map<String, Object>> blocks = body(TeamsCards.notification("Deploy finished", "Release 1.4 is live", "#10b981"));
        assertEquals(3, blocks.size());
        assertEquals("Deploy finished", blocks.get(0).get("text"));
        assertEquals("Good", blocks.get(0).get("color"));
        assertEquals("Release 1.4 is live", blocks.get(1).get("text"));
        assertEquals(Boolean.TRUE, blocks.get(1).get("wrap"));
        assertEquals("Prowosma", blocks.get(2).get("text"));
    }

    @Test
    @DisplayName("a missing title leaves out the heading; overlong text is cut so the payload stays small")
    void trimming() {
        assertEquals(2, body(TeamsCards.notification(null, "just a message", null)).size());
        assertEquals(2, body(TeamsCards.notification("  ", "just a message", null)).size());
        String longTitle = "T".repeat(500), longMessage = "M".repeat(9000);
        List<Map<String, Object>> blocks = body(TeamsCards.notification(longTitle, longMessage, null));
        assertEquals(TeamsCards.MAX_TITLE, ((String) blocks.get(0).get("text")).length());
        assertEquals(TeamsCards.MAX_MESSAGE, ((String) blocks.get(1).get("text")).length());
        assertEquals("", ((String) body(TeamsCards.notification("t", null, null)).get(1).get("text")));
    }

    @Test
    @DisplayName("Slack-style hex colours and colour names map to Adaptive Card semantic colours")
    void colours() {
        assertEquals("Attention", TeamsCards.semanticColor("#ef4444"));
        assertEquals("Attention", TeamsCards.semanticColor("#FF0000"));
        assertEquals("Good", TeamsCards.semanticColor("#10b981"));
        assertEquals("Good", TeamsCards.semanticColor("#00ff00"));
        assertEquals("Warning", TeamsCards.semanticColor("#f59e0b"));
        assertEquals("Warning", TeamsCards.semanticColor("#ffff00"));
        assertEquals("Accent", TeamsCards.semanticColor("#6366f1"));
        assertEquals("Accent", TeamsCards.semanticColor("#0000ff"));
        assertEquals("Default", TeamsCards.semanticColor("#888888"));
        // band boundaries: a red-orange (hue ~10) and a pink-red (hue ~348) are still "Attention";
        // a true orange (hue ~30) is "Warning"; a green-cyan (hue ~170) tips into "Accent"
        assertEquals("Attention", TeamsCards.semanticColor("#ff2a00"));
        assertEquals("Attention", TeamsCards.semanticColor("#ff0033"));
        assertEquals("Warning", TeamsCards.semanticColor("#ff8000"));
        assertEquals("Good", TeamsCards.semanticColor("#00ff55"));
        assertEquals("Accent", TeamsCards.semanticColor("#00ffd5"));
        assertEquals("Good", TeamsCards.semanticColor("green"));
        assertEquals("Attention", TeamsCards.semanticColor("Danger"));
        assertEquals("Accent", TeamsCards.semanticColor(null));
        assertEquals("Accent", TeamsCards.semanticColor("not-a-colour"));
        assertEquals("Accent", TeamsCards.semanticColor("#12"));
    }

    // ── webhook URL validation ───────────────────────────────────────────────

    @Test
    @DisplayName("real Teams webhook URLs are accepted: legacy connectors and Workflows")
    void acceptsRealUrls() {
        for (String ok : new String[]{
                "https://acme.webhook.office.com/webhookb2/11111111-2222@33333333/IncomingWebhook/abc/def",
                "https://outlook.office.com/webhook/11111111-2222@3333/IncomingWebhook/abc/def",
                "https://prod-12.westus.logic.azure.com:443/workflows/abc123/triggers/manual/paths/invoke?api-version=2016-06-01&sig=xyz",
                "https://x1.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/abc/triggers/manual/paths/invoke?api-version=1&sig=z"}) {
            TeamsCards.validateWebhook(ok, TeamsCards.DEFAULT_HOST_SUFFIXES);
        }
    }

    @Test
    @DisplayName("anything that isn't a Microsoft webhook host is refused — including every look-alike trick")
    void refusesEverythingElse() {
        for (String bad : new String[]{
                "http://outlook.office.com/webhook/x",
                "https://evil.com/webhook",
                "https://webhook.office.com.evil.com/webhookb2/x",
                "https://evil.com/webhook.office.com",
                "https://outlook.office.com@evil.com/webhook",
                "https://logic.azure.com.attacker.io/workflows/x",
                "https://notlogic.azure.com/x",
                "https://169.254.169.254/latest/meta-data/",
                "https://localhost/webhook",
                "https://hooks.slack.com/services/T/B/X",
                "", null}) {
            assertThrows(IllegalArgumentException.class,
                    () -> TeamsCards.validateWebhook(bad, TeamsCards.DEFAULT_HOST_SUFFIXES), String.valueOf(bad));
        }
    }

    @Test
    @DisplayName("sovereign-cloud hosts work once added to the allowed suffixes")
    void extraSuffixes() {
        String gov = "https://acme.webhook.office365.us/webhookb2/x";
        assertThrows(IllegalArgumentException.class, () -> TeamsCards.validateWebhook(gov, TeamsCards.DEFAULT_HOST_SUFFIXES));
        TeamsCards.validateWebhook(gov, List.of("webhook.office365.us"));
    }
}

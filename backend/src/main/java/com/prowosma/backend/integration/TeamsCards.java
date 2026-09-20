package com.prowosma.backend.integration;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Builds the JSON a Microsoft Teams incoming webhook accepts, and validates the webhook URL.
 *
 * Microsoft is retiring the legacy Office 365 connector webhooks in favour of Workflows
 * (Power Automate) webhooks. Both accept an Adaptive Card wrapped in a {@code message}
 * envelope, which is what is built here (the legacy MessageCard format is not).
 */
public final class TeamsCards {

    /**
     * Hosts Teams webhooks live on: legacy connectors ({@code *.webhook.office.com},
     * {@code outlook.office.com}) and Workflows ({@code *.logic.azure.com},
     * {@code *.api.powerplatform.com}). Sovereign-cloud tenants extend this with the
     * {@code app.integrations.teams.allowed-host-suffixes} property.
     */
    public static final List<String> DEFAULT_HOST_SUFFIXES = List.of(
            "webhook.office.com", "outlook.office.com", "outlook.office365.com",
            "logic.azure.com", "api.powerplatform.com", "powerplatform.com");

    static final int MAX_TITLE = 200;
    static final int MAX_MESSAGE = 4000;

    private TeamsCards() {}

    public static java.net.URI validateWebhook(String url, Collection<String> allowedSuffixes) {
        java.net.URI uri = OutboundUrlPolicy.parseHttps(url, "Teams webhook URL");
        OutboundUrlPolicy.requireHostMatches(uri, allowedSuffixes, "Teams webhook URL");
        return uri;
    }

    public static Map<String, Object> notification(String title, String message, String color) {
        List<Object> body = new ArrayList<>();
        String safeTitle = clip(title, MAX_TITLE);
        if (!safeTitle.isEmpty()) {
            Map<String, Object> heading = new LinkedHashMap<>();
            heading.put("type", "TextBlock");
            heading.put("text", safeTitle);
            heading.put("weight", "Bolder");
            heading.put("size", "Medium");
            heading.put("wrap", true);
            heading.put("color", semanticColor(color));
            body.add(heading);
        }
        Map<String, Object> text = new LinkedHashMap<>();
        text.put("type", "TextBlock");
        text.put("text", clip(message, MAX_MESSAGE));
        text.put("wrap", true);
        body.add(text);
        Map<String, Object> footer = new LinkedHashMap<>();
        footer.put("type", "TextBlock");
        footer.put("text", "Prowosma");
        footer.put("isSubtle", true);
        footer.put("size", "Small");
        body.add(footer);

        Map<String, Object> content = new LinkedHashMap<>();
        content.put("$schema", "http://adaptivecards.io/schemas/adaptive-card.json");
        content.put("type", "AdaptiveCard");
        content.put("version", "1.4");
        content.put("body", body);

        Map<String, Object> attachment = new LinkedHashMap<>();
        attachment.put("contentType", "application/vnd.microsoft.card.adaptive");
        attachment.put("contentUrl", null);
        attachment.put("content", content);

        Map<String, Object> envelope = new LinkedHashMap<>();
        envelope.put("type", "message");
        envelope.put("attachments", List.of(attachment));
        return envelope;
    }

    /**
     * Adaptive Card text colours are semantic (Good, Warning, Attention, Accent), not hex.
     * Accepts the hex colours the Slack endpoint already takes, plus the names.
     */
    public static String semanticColor(String color) {
        if (color == null || color.isBlank()) return "Accent";
        String c = color.trim().toLowerCase(Locale.ROOT);
        switch (c) {
            case "good": case "green": case "success": return "Good";
            case "warning": case "yellow": case "orange": case "amber": return "Warning";
            case "attention": case "red": case "danger": case "error": return "Attention";
            case "accent": case "blue": return "Accent";
            default: break;
        }
        if (!c.matches("#[0-9a-f]{6}")) return "Accent";
        int r = Integer.parseInt(c.substring(1, 3), 16);
        int g = Integer.parseInt(c.substring(3, 5), 16);
        int b = Integer.parseInt(c.substring(5, 7), 16);
        int max = Math.max(r, Math.max(g, b)), min = Math.min(r, Math.min(g, b));
        int delta = max - min;
        if (delta < 30) return "Default";                       // grey / near-neutral
        double hue;
        if (max == r)      hue = 60.0 * (((g - b) / (double) delta) % 6);
        else if (max == g) hue = 60.0 * (((b - r) / (double) delta) + 2);
        else               hue = 60.0 * (((r - g) / (double) delta) + 4);
        if (hue < 0) hue += 360;
        if (hue < 20 || hue >= 340) return "Attention";
        if (hue < 70)  return "Warning";
        if (hue < 170) return "Good";
        return "Accent";
    }

    private static String clip(String s, int max) {
        if (s == null) return "";
        String t = s.trim();
        return t.length() <= max ? t : t.substring(0, max - 1) + "\u2026";
    }
}

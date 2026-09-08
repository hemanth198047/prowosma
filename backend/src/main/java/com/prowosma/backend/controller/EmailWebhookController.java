package com.prowosma.backend.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.service.EmailService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;


/**
 * EmailWebhookController — receives bounce/complaint events from whichever
 * ESP is configured (see docs/EMAIL_SETUP.md) and feeds them into
 * EmailService's suppression list, so this app stops sending to addresses
 * a provider has told it, in writing, are undeliverable or complaining.
 * This is the "bounce/complaint handling" piece that was previously
 * entirely missing.
 *
 * Auth: all three endpoints require a shared secret, either as
 * ?secret=... or an X-Webhook-Secret header, checked against
 * email.webhook.shared-secret (EMAIL_WEBHOOK_SECRET). This is a
 * deliberately simple, uniform verification path across all three
 * providers rather than each provider's own (differently-shaped) signature
 * scheme:
 *   - SendGrid supports Ed25519 Event Webhook Signing for stronger
 *     verification — see their docs if you want to add it.
 *   - Postmark has no signature scheme of its own; a shared secret is
 *     Postmark's own recommended approach.
 *   - SES delivers via SNS, which has its own message-signature scheme
 *     (verifiable with the AWS SDK's SnsMessageManager) — not implemented
 *     here to avoid pulling in the AWS SDK for a project that doesn't
 *     otherwise depend on it; add it if SES is your primary provider and
 *     you want cryptographic verification instead of the shared secret.
 *
 * All three endpoints take the request body as a raw String and parse it
 * manually with this controller's own (Jackson 2.x) ObjectMapper, rather
 * than letting Spring bind @RequestBody directly to JsonNode. Spring's
 * built-in HTTP message converter in this environment runs on Jackson 3
 * (tools.jackson.databind) internally, which has no constructor for the
 * unrelated Jackson 2 (com.fasterxml.jackson.databind) JsonNode type this
 * controller uses — binding directly fails with "Cannot construct
 * instance of JsonNode ... abstract types either need to be mapped to
 * concrete types". Parsing manually from a String sidesteps that mismatch
 * entirely.
 *
 * Configure each provider's webhook to POST to:
 *   SES (via SNS topic subscription): /api/webhooks/email/ses?secret=...
 *   SendGrid (Settings -> Mail Settings -> Event Webhook): /api/webhooks/email/sendgrid?secret=...
 *   Postmark (Servers -> Webhooks): /api/webhooks/email/postmark?secret=...
 */
@Slf4j
@RestController
@RequestMapping("/api/webhooks/email")
@Tag(name = "Email Webhooks", description = "Bounce/complaint events from the configured email provider")
@RequiredArgsConstructor
public class EmailWebhookController {

    private final EmailService emailService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Value("${email.webhook.shared-secret:}")
    private String sharedSecret;

    private boolean isAuthorized(String secretParam, String secretHeader) {
        if (sharedSecret == null || sharedSecret.isBlank()) {
            // No secret configured — allow through in local/dev setups only.
            // Set EMAIL_WEBHOOK_SECRET before exposing this endpoint publicly.
            log.warn("[EmailWebhookController] email.webhook.shared-secret is not set — " +
                    "accepting an unauthenticated webhook call. Set EMAIL_WEBHOOK_SECRET before " +
                    "this endpoint is reachable from the internet.");
            return true;
        }
        return sharedSecret.equals(secretParam) || sharedSecret.equals(secretHeader);
    }

    // ── Amazon SES (via SNS) ────────────────────────────────────────────
    @PostMapping("/ses")
    @Operation(summary = "Amazon SES bounce/complaint notifications, delivered via SNS")
    public ResponseEntity<String> ses(
            @RequestParam(required = false) String secret,
            @RequestHeader(value = "X-Webhook-Secret", required = false) String secretHeader,
            @RequestBody String rawBody) {
        if (!isAuthorized(secret, secretHeader)) return ResponseEntity.status(401).body("unauthorized");

        try {
            JsonNode envelope = objectMapper.readTree(rawBody);
            String type = envelope.path("Type").asText("");

            // SNS requires the subscription to be confirmed by GET-ing SubscribeURL
            // once, the first time a topic is wired to this endpoint.
            if ("SubscriptionConfirmation".equals(type)) {
                log.info("[EmailWebhookController] SES/SNS subscription confirmation received. " +
                        "Visit this URL once to confirm: {}", envelope.path("SubscribeURL").asText());
                return ResponseEntity.ok("subscription confirmation logged — see server logs for the confirm URL");
            }

            if (!"Notification".equals(type)) {
                return ResponseEntity.ok("ignored (type=" + type + ")");
            }

            JsonNode message = objectMapper.readTree(envelope.path("Message").asText("{}"));
            String notificationType = message.path("notificationType").asText("");

            if ("Bounce".equals(notificationType)) {
                JsonNode bounce = message.path("bounce");
                String bounceType = bounce.path("bounceType").asText(""); // "Permanent" | "Transient"
                if ("Permanent".equals(bounceType)) {
                    for (JsonNode recipient : bounce.path("bouncedRecipients")) {
                        emailService.suppress(recipient.path("emailAddress").asText(),
                                "HARD_BOUNCE", "ses", rawBody);
                    }
                } else {
                    log.info("[EmailWebhookController] SES soft/transient bounce — not suppressing: {}", bounceType);
                }
            } else if ("Complaint".equals(notificationType)) {
                for (JsonNode recipient : message.path("complaint").path("complainedRecipients")) {
                    emailService.suppress(recipient.path("emailAddress").asText(),
                            "COMPLAINT", "ses", rawBody);
                }
            }
            return ResponseEntity.ok("processed");
        } catch (Exception e) {
            log.error("[EmailWebhookController] Failed to process SES webhook: {}", e.getMessage());
            return ResponseEntity.status(400).body("could not parse payload");
        }
    }

    // ── SendGrid ─────────────────────────────────────────────────────
    @PostMapping("/sendgrid")
    @Operation(summary = "SendGrid Event Webhook — bounce/spam-report events")
    public ResponseEntity<String> sendgrid(
            @RequestParam(required = false) String secret,
            @RequestHeader(value = "X-Webhook-Secret", required = false) String secretHeader,
            @RequestBody String rawBody) {
        if (!isAuthorized(secret, secretHeader)) return ResponseEntity.status(401).body("unauthorized");

        JsonNode events;
        try {
            events = objectMapper.readTree(rawBody);
        } catch (Exception e) {
            log.error("[EmailWebhookController] Failed to parse SendGrid webhook payload: {}", e.getMessage());
            return ResponseEntity.status(400).body("could not parse payload");
        }

        if (!events.isArray()) return ResponseEntity.ok("ignored (not an array)");
        for (JsonNode event : events) {
            String type = event.path("event").asText("");
            String email = event.path("email").asText(null);
            if (email == null) continue;
            switch (type) {
                case "bounce" -> emailService.suppress(email, "HARD_BOUNCE", "sendgrid", event.toString());
                case "spamreport" -> emailService.suppress(email, "COMPLAINT", "sendgrid", event.toString());
                default -> { /* delivered/open/click/deferred/etc — not suppression-relevant */ }
            }
        }
        return ResponseEntity.ok("processed " + events.size() + " event(s)");
    }

    // ── Postmark ─────────────────────────────────────────────────────
    @PostMapping("/postmark")
    @Operation(summary = "Postmark webhook — HardBounce/SpamComplaint events")
    public ResponseEntity<String> postmark(
            @RequestParam(required = false) String secret,
            @RequestHeader(value = "X-Webhook-Secret", required = false) String secretHeader,
            @RequestBody String rawBody) {
        if (!isAuthorized(secret, secretHeader)) return ResponseEntity.status(401).body("unauthorized");

        JsonNode event;
        try {
            event = objectMapper.readTree(rawBody);
        } catch (Exception e) {
            log.error("[EmailWebhookController] Failed to parse Postmark webhook payload: {}", e.getMessage());
            return ResponseEntity.status(400).body("could not parse payload");
        }

        String recordType = event.path("RecordType").asText("");
        String email = event.path("Email").asText(null);
        if (email == null) return ResponseEntity.ok("ignored (no Email field)");

        if ("Bounce".equals(recordType)) {
            String bounceType = event.path("Type").asText(""); // e.g. "HardBounce", "Transient", "SoftBounce"
            if ("HardBounce".equals(bounceType)) {
                emailService.suppress(email, "HARD_BOUNCE", "postmark", event.toString());
            }
        } else if ("SpamComplaint".equals(recordType)) {
            emailService.suppress(email, "COMPLAINT", "postmark", event.toString());
        }
        return ResponseEntity.ok("processed");
    }
}
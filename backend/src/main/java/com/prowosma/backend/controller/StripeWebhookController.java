package com.prowosma.backend.controller;

import com.prowosma.backend.service.BillingService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/**
 * StripeWebhookController — receives real events pushed by Stripe.
 *
 * This is the only path in the whole app that actually changes a
 * workspace's plan or subscription status. Checkout succeeding on the
 * frontend does NOT grant access by itself — it's this webhook, once
 * Stripe confirms the subscription is real, that updates Mongo.
 *
 * Setup (Stripe Dashboard → Developers → Webhooks):
 *   Endpoint URL: https://your-domain.com/api/webhooks/stripe
 *   Events to send: checkout.session.completed, customer.subscription.created,
 *                    customer.subscription.updated, customer.subscription.deleted,
 *                    invoice.paid, invoice.payment_failed
 *   Copy the signing secret (whsec_...) into stripe.webhook-secret / STRIPE_WEBHOOK_SECRET.
 *
 * For local testing, use the Stripe CLI:
 *   stripe listen --forward-to localhost:9090/api/webhooks/stripe
 *
 * IMPORTANT: this endpoint reads the RAW request body for signature
 * verification. Do not add any JSON-parsing filter/interceptor in front of
 * it, or signature verification will fail (a common, well-documented
 * Stripe integration mistake — see the class javadoc in BillingService).
 */
@Slf4j
@RestController
@RequestMapping("/api/webhooks")
@Tag(name = "Stripe Webhooks", description = "Receives real subscription/payment events from Stripe")
@RequiredArgsConstructor
public class StripeWebhookController {

    private final BillingService billingService;

    @PostMapping("/stripe")
    @Operation(summary = "Stripe webhook endpoint — verifies signature, updates subscription state")
    public ResponseEntity<?> handleStripeWebhook(HttpServletRequest request) {
        String sigHeader = request.getHeader("Stripe-Signature");
        if (sigHeader == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "Missing Stripe-Signature header"));
        }

        String payload;
        try {
            payload = new String(request.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            return ResponseEntity.badRequest().body(Map.of("error", "Could not read request body"));
        }

        try {
            billingService.handleWebhook(payload, sigHeader);
            return ResponseEntity.ok(Map.of("received", true));
        } catch (RuntimeException e) {
            log.warn("Webhook processing failed: {}", e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }
}

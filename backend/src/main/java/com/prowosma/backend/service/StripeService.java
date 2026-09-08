package com.prowosma.backend.service;

import com.stripe.Stripe;
import com.stripe.exception.SignatureVerificationException;
import com.stripe.exception.StripeException;
import com.stripe.model.Customer;
import com.stripe.model.Event;
import com.stripe.model.Invoice;
import com.stripe.model.billingportal.Session;
import com.stripe.net.Webhook;
import com.stripe.param.CustomerCreateParams;
import com.stripe.param.SubscriptionUpdateParams;
import com.stripe.param.billingportal.SessionCreateParams;
import com.stripe.param.checkout.SessionCreateParams.LineItem;
import com.stripe.param.checkout.SessionCreateParams.Mode;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * StripeService — the only class in the app that talks to the Stripe SDK
 * directly. Everything here makes a real network call to Stripe's API;
 * nothing in this class is mocked or hardcoded.
 *
 * Requires a real Stripe account and API keys (bring-your-own-key, same
 * pattern as AIService for the AI providers). Until stripe.secret-key is
 * configured, isConfigured() returns false and BillingService surfaces a
 * clear "payments aren't set up yet" message instead of silently failing.
 */
@Slf4j
@Service
public class StripeService {

    @Value("${stripe.secret-key:}")
    private String secretKey;

    @Value("${stripe.webhook-secret:}")
    private String webhookSecret;

    @PostConstruct
    void init() {
        if (isConfigured()) {
            Stripe.apiKey = secretKey;
            log.info("Stripe billing is configured and live.");
        } else {
            log.warn("Stripe secret key is not set (stripe.secret-key / STRIPE_SECRET_KEY). " +
                    "Billing checkout/portal endpoints will return a clear error until it is configured.");
        }
    }

    public boolean isConfigured() {
        return secretKey != null && !secretKey.isBlank();
    }

    public boolean webhookConfigured() {
        return webhookSecret != null && !webhookSecret.isBlank();
    }

    // ── Customers ───────────────────────────────────────────────────

    public Customer findOrCreateCustomer(String workspaceId, String email, String existingCustomerId) throws StripeException {
        if (existingCustomerId != null && !existingCustomerId.isBlank()) {
            return Customer.retrieve(existingCustomerId);
        }
        CustomerCreateParams params = CustomerCreateParams.builder()
                .setEmail(email)
                .putMetadata("workspaceId", workspaceId)
                .build();
        return Customer.create(params);
    }

    // ── Checkout (self-serve upgrade) ───────────────────────────────

    public com.stripe.model.checkout.Session createCheckoutSession(
            String customerId, String priceId, int seats, String workspaceId,
            String successUrl, String cancelUrl) throws StripeException {

        com.stripe.param.checkout.SessionCreateParams params = com.stripe.param.checkout.SessionCreateParams.builder()
                .setMode(Mode.SUBSCRIPTION)
                .setCustomer(customerId)
                .setClientReferenceId(workspaceId)
                .setSuccessUrl(successUrl)
                .setCancelUrl(cancelUrl)
                .setAllowPromotionCodes(true)
                .addLineItem(LineItem.builder()
                        .setPrice(priceId)
                        .setQuantity((long) seats)
                        .build())
                .putMetadata("workspaceId", workspaceId)
                .setSubscriptionData(
                        com.stripe.param.checkout.SessionCreateParams.SubscriptionData.builder()
                                .putMetadata("workspaceId", workspaceId)
                                .build())
                .build();

        return com.stripe.model.checkout.Session.create(params);
    }

    // ── Billing Portal (self-serve card update / cancel / invoices) ─

    public Session createPortalSession(String customerId, String returnUrl) throws StripeException {
        SessionCreateParams params = SessionCreateParams.builder()
                .setCustomer(customerId)
                .setReturnUrl(returnUrl)
                .build();
        return Session.create(params);
    }

    // ── Subscription management ─────────────────────────────────────

    public com.stripe.model.Subscription retrieveSubscription(String subscriptionId) throws StripeException {
        return com.stripe.model.Subscription.retrieve(subscriptionId);
    }

    public com.stripe.model.Subscription setCancelAtPeriodEnd(String subscriptionId, boolean cancel) throws StripeException {
        com.stripe.model.Subscription sub = com.stripe.model.Subscription.retrieve(subscriptionId);
        SubscriptionUpdateParams params = SubscriptionUpdateParams.builder()
                .setCancelAtPeriodEnd(cancel)
                .build();
        return sub.update(params);
    }

    public com.stripe.model.Subscription updateSeats(String subscriptionId, String subscriptionItemId, int seats) throws StripeException {
        com.stripe.model.Subscription sub = com.stripe.model.Subscription.retrieve(subscriptionId);
        SubscriptionUpdateParams params = SubscriptionUpdateParams.builder()
                .addItem(SubscriptionUpdateParams.Item.builder()
                        .setId(subscriptionItemId)
                        .setQuantity((long) seats)
                        .build())
                .setProrationBehavior(SubscriptionUpdateParams.ProrationBehavior.CREATE_PRORATIONS)
                .build();
        return sub.update(params);
    }

    public Invoice retrieveInvoice(String invoiceId) throws StripeException {
        return Invoice.retrieve(invoiceId);
    }

    // ── Webhooks ─────────────────────────────────────────────────────

    public Event constructWebhookEvent(String payload, String sigHeader) throws SignatureVerificationException {
        return Webhook.constructEvent(payload, sigHeader, webhookSecret);
    }
}

package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * Subscription — one document per workspace, mirroring the workspace's
 * real Stripe subscription state.
 *
 * This is a *cache/mirror* of Stripe's own record of truth, kept in sync via
 * the Stripe webhook handler (see StripeWebhookController / BillingService).
 * We never invent billing state locally — every field here is set from a
 * real Stripe API response or webhook event, never hardcoded.
 *
 * A workspace with no Stripe subscription yet still gets a Subscription
 * document created lazily (see BillingService#getOrCreate) so the rest of
 * the app has one consistent place to check plan/seats, defaulting to the
 * FREE plan.
 */
@Data
@Document(collection = "subscriptions")
public class Subscription {

    @Id
    private String id;

    @Indexed(unique = true)
    private String workspaceId;

    // ── Stripe identifiers ──────────────────────────────────────────
    private String stripeCustomerId;
    private String stripeSubscriptionId;
    private String stripePriceId;

    // ── Plan state ──────────────────────────────────────────────────
    /** FREE | PRO | BUSINESS | ENTERPRISE — see PlanCatalog for definitions. */
    private String planId = "FREE";

    /**
     * Mirrors Stripe subscription.status: active | trialing | past_due |
     * canceled | incomplete | incomplete_expired | unpaid | none (no
     * subscription yet — FREE plan).
     */
    private String status = "none";

    /** Seats purchased on the current subscription (quantity on the line item). */
    private int seats = 5; // FREE plan default seat allowance

    private boolean cancelAtPeriodEnd = false;

    private LocalDateTime currentPeriodStart;
    private LocalDateTime currentPeriodEnd;
    private LocalDateTime trialEnd;
    /** Set once a workspace has ever started a trial, so it can't be repeated by canceling and re-starting. */
    private boolean trialUsed = false;
    private LocalDateTime canceledAt;

    private String billingEmail;

    /** Cached mirror of Stripe invoices for fast display without re-querying Stripe every page load. */
    private List<InvoiceRecord> invoices = new ArrayList<>();

    private LocalDateTime createdAt = LocalDateTime.now();
    private LocalDateTime updatedAt = LocalDateTime.now();

    @Data
    public static class InvoiceRecord {
        private String stripeInvoiceId;
        /** draft | open | paid | uncollectible | void */
        private String status;
        private long amountDue;   // smallest currency unit (e.g. cents)
        private long amountPaid;
        private String currency;
        private String hostedInvoiceUrl;
        private String invoicePdf;
        private String number;
        private LocalDateTime created;
        private LocalDateTime periodStart;
        private LocalDateTime periodEnd;
    }
}

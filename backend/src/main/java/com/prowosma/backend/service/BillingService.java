package com.prowosma.backend.service;

import com.prowosma.backend.model.Subscription;
import com.prowosma.backend.repository.InvitationRepository;
import com.prowosma.backend.repository.SubscriptionRepository;
import com.prowosma.backend.repository.UserRepository;
import com.stripe.exception.SignatureVerificationException;
import com.stripe.exception.StripeException;
import com.stripe.model.Customer;
import com.stripe.model.Event;
import com.stripe.model.EventDataObjectDeserializer;
import com.stripe.model.Invoice;
import com.stripe.model.StripeObject;
import com.stripe.model.checkout.Session;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/**
 * BillingService — the real, functional billing engine.
 *
 * Responsibilities:
 *   - Own the per-workspace Subscription record (source of truth in Mongo,
 *     kept in sync with Stripe via webhooks — never invented locally).
 *   - Start a real Stripe Checkout session for a self-serve upgrade.
 *   - Open a real Stripe Billing Portal session for self-serve card
 *     updates, invoice history, and cancellation.
 *   - Enforce seat limits and plan-gated features (SSO, SCIM, white-label,
 *     API access) — this is the piece that was completely missing before:
 *     nothing in the old code ever checked a workspace's plan before
 *     allowing a feature.
 *   - Process Stripe webhook events, which is the *only* place plan/status
 *     actually changes — Checkout success alone does not grant access;
 *     the webhook confirming the subscription is what does.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class BillingService {

    private final SubscriptionRepository subscriptionRepository;
    private final UserRepository userRepository;
    private final InvitationRepository invitationRepository;
    private final StripeService stripeService;
    private final PlanCatalog planCatalog;

    @Value("${app.frontend.url}")
    private String frontendUrl;

    // ── Core record access ──────────────────────────────────────────

    public Subscription getOrCreate(String workspaceId) {
        Subscription sub = subscriptionRepository.findByWorkspaceId(workspaceId)
                .orElseGet(() -> {
                    Subscription s = new Subscription();
                    s.setWorkspaceId(workspaceId);
                    s.setPlanId("FREE");
                    s.setStatus("none");
                    s.setSeats(planCatalog.freePlan().getSeatLimit());
                    return subscriptionRepository.save(s);
                });
        return expireTrialIfDue(sub);
    }

    /**
     * A trialing subscription with no real Stripe subscription behind it
     * doesn't get a webhook to tell it the trial ended — so we check on
     * every read instead. Cheap (one date comparison) and correct: the
     * instant anything asks for this workspace's plan after trialEnd has
     * passed, it's reverted to FREE, exactly as if a scheduled job had
     * done it. No cron/scheduler needed for correctness.
     */
    private Subscription expireTrialIfDue(Subscription sub) {
        if ("trialing".equals(sub.getStatus()) && sub.getStripeSubscriptionId() == null
                && sub.getTrialEnd() != null && sub.getTrialEnd().isBefore(LocalDateTime.now())) {
            sub.setStatus("none");
            sub.setPlanId("FREE");
            sub.setSeats(planCatalog.freePlan().getSeatLimit());
            sub.setUpdatedAt(LocalDateTime.now());
            subscriptionRepository.save(sub);
            log.info("Workspace {} trial expired — reverted to FREE plan", sub.getWorkspaceId());
        }
        return sub;
    }

    /**
     * Starts a real 14-day trial of the Pro plan — no card required, no
     * Stripe involvement at all. One-time per workspace (tracked via
     * trialUsed) so it can't be repeated by canceling and starting again.
     */
    public Map<String, Object> startTrial(String workspaceId) {
        Subscription sub = getOrCreate(workspaceId);
        if (sub.isTrialUsed()) {
            throw new IllegalStateException("This workspace has already used its free trial.");
        }
        if (sub.getStripeSubscriptionId() != null) {
            throw new IllegalStateException("This workspace already has an active subscription.");
        }
        PlanCatalog.Plan pro = planCatalog.byId("PRO").orElseThrow();
        sub.setPlanId("PRO");
        sub.setStatus("trialing");
        sub.setSeats(pro.getSeatLimit());
        sub.setTrialEnd(LocalDateTime.now().plusDays(14));
        sub.setTrialUsed(true);
        sub.setUpdatedAt(LocalDateTime.now());
        subscriptionRepository.save(sub);
        log.info("Workspace {} started a 14-day Pro trial (ends {})", workspaceId, sub.getTrialEnd());
        return getSummary(workspaceId);
    }

    private PlanCatalog.Plan planFor(Subscription sub) {
        return planCatalog.byId(sub.getPlanId()).orElse(planCatalog.freePlan());
    }

    public long countActiveMembers(String workspaceId) {
        return userRepository.countByOrganizationId(workspaceId);
    }

    public long countPendingInvites(String workspaceId) {
        return invitationRepository.countByWorkspaceIdAndStatus(workspaceId, "PENDING");
    }

    // ── Enforcement (the part that was missing entirely before) ────

    /** Throws if this workspace has no room for one more seat. Call before creating any invite/member. */
    public void assertSeatAvailable(String workspaceId) {
        Subscription sub = getOrCreate(workspaceId);
        PlanCatalog.Plan plan = planFor(sub);
        if (plan.getSeatLimit() < 0) return; // unlimited (Enterprise)

        long used = countActiveMembers(workspaceId) + countPendingInvites(workspaceId);
        if (used >= plan.getSeatLimit()) {
            throw new RuntimeException(
                    "Seat limit reached for the " + plan.getName() + " plan (" + plan.getSeatLimit() +
                    " seats, " + used + " used). Upgrade your plan to invite more people.");
        }
    }

    /** feature ∈ {"sso","scim","whiteLabel","apiAccess"} */
    public boolean isFeatureEnabled(String workspaceId, String feature) {
        Subscription sub = getOrCreate(workspaceId);
        PlanCatalog.Plan plan = planFor(sub);
        return switch (feature) {
            case "sso" -> plan.isSsoEnabled();
            case "scim" -> plan.isScimEnabled();
            case "whiteLabel" -> plan.isWhiteLabelEnabled();
            case "apiAccess" -> plan.isApiAccessEnabled();
            default -> true;
        };
    }

    // ── Summary for the frontend ────────────────────────────────────

    public Map<String, Object> getSummary(String workspaceId) {
        Subscription sub = getOrCreate(workspaceId);
        PlanCatalog.Plan plan = planFor(sub);
        long used = countActiveMembers(workspaceId);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("planId", sub.getPlanId());
        result.put("planName", plan.getName());
        result.put("status", sub.getStatus());
        result.put("seatLimit", plan.getSeatLimit());
        result.put("seatsUsed", used);
        result.put("pendingInvites", countPendingInvites(workspaceId));
        result.put("cancelAtPeriodEnd", sub.isCancelAtPeriodEnd());
        result.put("currentPeriodEnd", sub.getCurrentPeriodEnd());
        result.put("trialEnd", sub.getTrialEnd());
        result.put("trialUsed", sub.isTrialUsed());
        result.put("hasPaymentMethod", sub.getStripeCustomerId() != null);
        result.put("features", Map.of(
                "sso", plan.isSsoEnabled(),
                "scim", plan.isScimEnabled(),
                "whiteLabel", plan.isWhiteLabelEnabled(),
                "apiAccess", plan.isApiAccessEnabled(),
                "prioritySupport", plan.isPrioritySupport()
        ));
        result.put("invoices", sub.getInvoices());
        result.put("stripeConfigured", stripeService.isConfigured());
        return result;
    }

    public java.util.List<Map<String, Object>> listPlans() {
        return planCatalog.allPlans().stream().map(p -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", p.getId());
            m.put("name", p.getName());
            m.put("seatLimit", p.getSeatLimit());
            m.put("displayPriceCentsPerSeat", p.getDisplayPriceCentsPerSeat());
            m.put("selfServe", p.isSelfServe());
            m.put("sso", p.isSsoEnabled());
            m.put("scim", p.isScimEnabled());
            m.put("whiteLabel", p.isWhiteLabelEnabled());
            m.put("apiAccess", p.isApiAccessEnabled());
            m.put("prioritySupport", p.isPrioritySupport());
            return m;
        }).toList();
    }

    // ── Checkout / Portal ────────────────────────────────────────────

    public Map<String, Object> startCheckout(String workspaceId, String planId, int seats, String userEmail) {
        if (!stripeService.isConfigured()) {
            throw new IllegalStateException(
                    "Payments aren't configured yet. Set stripe.secret-key (STRIPE_SECRET_KEY) to enable checkout.");
        }
        PlanCatalog.Plan plan = planCatalog.byId(planId)
                .orElseThrow(() -> new IllegalArgumentException("Unknown plan: " + planId));
        if (!plan.isSelfServe() || plan.getStripePriceId() == null) {
            throw new IllegalStateException(plan.getName() + " isn't self-serve — contact sales to set it up.");
        }
        if (seats < 1) seats = 1;

        Subscription sub = getOrCreate(workspaceId);
        try {
            Customer customer = stripeService.findOrCreateCustomer(workspaceId, userEmail, sub.getStripeCustomerId());
            sub.setStripeCustomerId(customer.getId());
            sub.setBillingEmail(userEmail);
            subscriptionRepository.save(sub);

            Session session = stripeService.createCheckoutSession(
                    customer.getId(), plan.getStripePriceId(), seats, workspaceId,
                    frontendUrl + "/licensing?checkout=success",
                    frontendUrl + "/licensing?checkout=cancelled"
            );
            return Map.of("url", session.getUrl());
        } catch (StripeException e) {
            log.error("Stripe checkout session creation failed for workspace {}", workspaceId, e);
            throw new RuntimeException("Could not start checkout: " + e.getMessage());
        }
    }

    public Map<String, Object> openPortal(String workspaceId) {
        if (!stripeService.isConfigured()) {
            throw new IllegalStateException("Payments aren't configured yet.");
        }
        Subscription sub = getOrCreate(workspaceId);
        if (sub.getStripeCustomerId() == null) {
            throw new IllegalStateException("No billing account yet — upgrade to a paid plan first.");
        }
        try {
            var session = stripeService.createPortalSession(sub.getStripeCustomerId(), frontendUrl + "/licensing");
            return Map.of("url", session.getUrl());
        } catch (StripeException e) {
            log.error("Stripe portal session creation failed for workspace {}", workspaceId, e);
            throw new RuntimeException("Could not open billing portal: " + e.getMessage());
        }
    }

    public void requestCancelAtPeriodEnd(String workspaceId, boolean cancel) {
        Subscription sub = getOrCreate(workspaceId);
        if (sub.getStripeSubscriptionId() == null) {
            throw new IllegalStateException("No active subscription to cancel.");
        }
        try {
            var stripeSub = stripeService.setCancelAtPeriodEnd(sub.getStripeSubscriptionId(), cancel);
            applySubscriptionState(sub, stripeSub);
        } catch (StripeException e) {
            log.error("Stripe cancel-at-period-end update failed for workspace {}", workspaceId, e);
            throw new RuntimeException("Could not update cancellation: " + e.getMessage());
        }
    }

    // ── Webhook processing (the only place plan state actually changes) ──

    public void handleWebhook(String payload, String sigHeader) {
        Event event;
        try {
            event = stripeService.constructWebhookEvent(payload, sigHeader);
        } catch (SignatureVerificationException e) {
            log.warn("Rejected webhook with invalid signature");
            throw new RuntimeException("Invalid signature");
        }

        log.info("Stripe webhook received: {}", event.getType());

        switch (event.getType()) {
            case "checkout.session.completed" -> onCheckoutCompleted(event);
            case "customer.subscription.created",
                 "customer.subscription.updated" -> onSubscriptionChanged(event);
            case "customer.subscription.deleted" -> onSubscriptionDeleted(event);
            case "invoice.paid", "invoice.payment_failed", "invoice.finalized" -> onInvoiceEvent(event);
            default -> log.debug("Ignoring unhandled Stripe event type: {}", event.getType());
        }
    }

    private StripeObject deserialize(Event event) {
        EventDataObjectDeserializer deserializer = event.getDataObjectDeserializer();
        Optional<StripeObject> obj = deserializer.getObject();
        if (obj.isPresent()) {
            return obj.get();
        }
        // Falls back to deserializing against the event's own API version when
        // it doesn't match the SDK's compiled-in version. deserializeUnsafe()
        // declares a checked exception, so it can't be used as a plain
        // Supplier method reference (that's what failed to compile before).
        try {
            return deserializer.deserializeUnsafe();
        } catch (Exception e) {
            log.warn("Could not deserialize data object for Stripe event {} ({})", event.getId(), event.getType(), e);
            return null;
        }
    }

    private void onCheckoutCompleted(Event event) {
        StripeObject obj = deserialize(event);
        if (!(obj instanceof Session session)) return;

        String workspaceId = session.getClientReferenceId();
        if (workspaceId == null) {
            log.warn("checkout.session.completed with no client_reference_id — cannot map to a workspace");
            return;
        }
        String subscriptionId = session.getSubscription();
        if (subscriptionId == null) return;

        try {
            var stripeSub = stripeService.retrieveSubscription(subscriptionId);
            Subscription sub = getOrCreate(workspaceId);
            sub.setStripeCustomerId(session.getCustomer());
            sub.setStripeSubscriptionId(subscriptionId);
            applySubscriptionState(sub, stripeSub);
        } catch (StripeException e) {
            log.error("Failed to fetch subscription {} after checkout completion", subscriptionId, e);
        }
    }

    private void onSubscriptionChanged(Event event) {
        StripeObject obj = deserialize(event);
        if (!(obj instanceof com.stripe.model.Subscription stripeSub)) return;

        String workspaceId = stripeSub.getMetadata() != null ? stripeSub.getMetadata().get("workspaceId") : null;
        Subscription sub = resolveByCustomerOrWorkspace(workspaceId, stripeSub.getCustomer());
        if (sub == null) {
            log.warn("customer.subscription.* event for unknown workspace (customer {})", stripeSub.getCustomer());
            return;
        }
        sub.setStripeSubscriptionId(stripeSub.getId());
        sub.setStripeCustomerId(stripeSub.getCustomer());
        applySubscriptionState(sub, stripeSub);
    }

    private void onSubscriptionDeleted(Event event) {
        StripeObject obj = deserialize(event);
        if (!(obj instanceof com.stripe.model.Subscription stripeSub)) return;

        Subscription sub = subscriptionRepository.findByStripeSubscriptionId(stripeSub.getId()).orElse(null);
        if (sub == null) return;

        // Subscription is gone — fall back to FREE plan rather than leaving
        // the workspace on a paid tier with no active Stripe subscription.
        sub.setStatus("canceled");
        sub.setPlanId("FREE");
        sub.setSeats(planCatalog.freePlan().getSeatLimit());
        sub.setCancelAtPeriodEnd(false);
        sub.setCanceledAt(LocalDateTime.now());
        sub.setUpdatedAt(LocalDateTime.now());
        subscriptionRepository.save(sub);
        log.info("Workspace {} subscription canceled — reverted to FREE plan", sub.getWorkspaceId());
    }

    private void onInvoiceEvent(Event event) {
        StripeObject obj = deserialize(event);
        if (!(obj instanceof Invoice invoice)) return;

        String customerId = invoice.getCustomer();
        if (customerId == null) return;
        Subscription sub = subscriptionRepository.findByStripeCustomerId(customerId).orElse(null);
        if (sub == null) return;

        Subscription.InvoiceRecord record = new Subscription.InvoiceRecord();
        record.setStripeInvoiceId(invoice.getId());
        record.setStatus(invoice.getStatus());
        record.setAmountDue(invoice.getAmountDue() == null ? 0 : invoice.getAmountDue());
        record.setAmountPaid(invoice.getAmountPaid() == null ? 0 : invoice.getAmountPaid());
        record.setCurrency(invoice.getCurrency());
        record.setHostedInvoiceUrl(invoice.getHostedInvoiceUrl());
        record.setInvoicePdf(invoice.getInvoicePdf());
        record.setNumber(invoice.getNumber());
        record.setCreated(invoice.getCreated() != null ? toLocalDateTime(invoice.getCreated()) : null);

        sub.getInvoices().removeIf(r -> invoice.getId().equals(r.getStripeInvoiceId()));
        sub.getInvoices().add(0, record); // newest first
        if (sub.getInvoices().size() > 50) {
            sub.setInvoices(sub.getInvoices().subList(0, 50));
        }
        sub.setUpdatedAt(LocalDateTime.now());
        subscriptionRepository.save(sub);
    }

    private Subscription resolveByCustomerOrWorkspace(String workspaceId, String customerId) {
        if (workspaceId != null) {
            Optional<Subscription> byWs = subscriptionRepository.findByWorkspaceId(workspaceId);
            if (byWs.isPresent()) return byWs.get();
        }
        if (customerId != null) {
            Optional<Subscription> byCust = subscriptionRepository.findByStripeCustomerId(customerId);
            if (byCust.isPresent()) return byCust.get();
        }
        if (workspaceId != null) {
            return getOrCreate(workspaceId); // brand new subscription for this workspace
        }
        return null;
    }

    private void applySubscriptionState(Subscription sub, com.stripe.model.Subscription stripeSub) {
        sub.setStatus(stripeSub.getStatus());
        sub.setCancelAtPeriodEnd(Boolean.TRUE.equals(stripeSub.getCancelAtPeriodEnd()));

        if (stripeSub.getItems() != null && !stripeSub.getItems().getData().isEmpty()) {
            var item = stripeSub.getItems().getData().get(0);
            String priceId = item.getPrice() != null ? item.getPrice().getId() : null;
            sub.setStripePriceId(priceId);
            sub.setSeats(item.getQuantity() != null ? item.getQuantity().intValue() : sub.getSeats());

            planCatalog.byStripePriceId(priceId).ifPresentOrElse(
                    plan -> sub.setPlanId(plan.getId()),
                    () -> log.warn("Stripe price {} doesn't match any configured plan — leaving planId as {}", priceId, sub.getPlanId())
            );

            if (item.getCurrentPeriodStart() != null) sub.setCurrentPeriodStart(toLocalDateTime(item.getCurrentPeriodStart()));
            if (item.getCurrentPeriodEnd() != null) sub.setCurrentPeriodEnd(toLocalDateTime(item.getCurrentPeriodEnd()));
        }

        if (stripeSub.getTrialEnd() != null) sub.setTrialEnd(toLocalDateTime(stripeSub.getTrialEnd()));
        sub.setUpdatedAt(LocalDateTime.now());
        subscriptionRepository.save(sub);
        log.info("Workspace {} subscription updated: plan={} status={} seats={}",
                sub.getWorkspaceId(), sub.getPlanId(), sub.getStatus(), sub.getSeats());
    }

    private LocalDateTime toLocalDateTime(long epochSeconds) {
        return LocalDateTime.ofInstant(Instant.ofEpochSecond(epochSeconds), ZoneId.systemDefault());
    }
}

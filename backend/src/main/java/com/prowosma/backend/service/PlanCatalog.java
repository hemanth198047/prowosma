package com.prowosma.backend.service;

import lombok.Data;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Optional;

/**
 * PlanCatalog — the single source of truth for what each plan tier includes.
 *
 * The tier definitions (seat limits, feature flags, display price) live here
 * in code because they're a product decision, not user data. The *real*
 * Stripe Price IDs are read from configuration (application.properties /
 * environment variables) because those are created in your own Stripe
 * Dashboard and are different for every Stripe account — there is no way
 * for this code to invent them, the same way AIService can't invent your
 * Anthropic API key.
 *
 * To go live:
 *   1. Create a Product + a recurring Price in the Stripe Dashboard for
 *      each paid plan (Products → Add Product → Recurring → per seat).
 *   2. Copy each Price ID (starts with "price_") into application.properties
 *      or as the matching environment variable below.
 *
 * ENTERPRISE deliberately has no self-serve Stripe Price — matches the
 * existing "contact sales for custom pricing" language already on the
 * Licensing page. If you later want ENTERPRISE to be self-serve too, just
 * set stripe.price.enterprise and it will behave exactly like the others.
 */
@Component
public class PlanCatalog {

    @Value("${stripe.price.pro:}")
    private String proPriceId;

    @Value("${stripe.price.business:}")
    private String businessPriceId;

    @Value("${stripe.price.enterprise:}")
    private String enterprisePriceId;

    @Data
    public static class Plan {
        private final String id;
        private final String name;
        private String stripePriceId;
        private final int seatLimit;              // -1 = unlimited
        private final long displayPriceCentsPerSeat; // for UI only — real charge amount always comes from Stripe
        private final boolean selfServe;           // false = "contact sales", no Checkout button
        private final boolean ssoEnabled;
        private final boolean scimEnabled;
        private final boolean whiteLabelEnabled;
        private final boolean apiAccessEnabled;
        private final boolean prioritySupport;

        Plan(String id, String name, int seatLimit, long displayPriceCentsPerSeat, boolean selfServe,
             boolean sso, boolean scim, boolean whiteLabel, boolean apiAccess, boolean prioritySupport) {
            this.id = id;
            this.name = name;
            this.seatLimit = seatLimit;
            this.displayPriceCentsPerSeat = displayPriceCentsPerSeat;
            this.selfServe = selfServe;
            this.ssoEnabled = sso;
            this.scimEnabled = scim;
            this.whiteLabelEnabled = whiteLabel;
            this.apiAccessEnabled = apiAccess;
            this.prioritySupport = prioritySupport;
        }
    }

    public List<Plan> allPlans() {
        // FREE seat limit raised from 5 → 5000 (single source of truth —
        // every enforcement point (BillingService.assertSeatAvailable) and
        // display (Licensing/AdminCenter "X of Y seats used") reads this
        // dynamically, so nothing else needs to change for the real limit.
        Plan free = new Plan("FREE", "Free", 5000, 0, false,
                false, false, false, false, false);

        Plan pro = new Plan("PRO", "Pro", 25, 1200, true,
                false, false, false, true, false);
        pro.setStripePriceId(blankToNull(proPriceId));

        Plan business = new Plan("BUSINESS", "Business", 100, 2400, true,
                true, false, true, true, false);
        business.setStripePriceId(blankToNull(businessPriceId));

        Plan enterprise = new Plan("ENTERPRISE", "Enterprise", -1, 0,
                enterprisePriceId != null && !enterprisePriceId.isBlank(), // self-serve only if you configured a price
                true, true, true, true, true);
        enterprise.setStripePriceId(blankToNull(enterprisePriceId));

        return List.of(free, pro, business, enterprise);
    }

    public Optional<Plan> byId(String planId) {
        if (planId == null) return Optional.empty();
        return allPlans().stream()
                .filter(p -> p.getId().equalsIgnoreCase(planId))
                .findFirst();
    }

    public Optional<Plan> byStripePriceId(String priceId) {
        if (priceId == null || priceId.isBlank()) return Optional.empty();
        return allPlans().stream()
                .filter(p -> priceId.equals(p.getStripePriceId()))
                .findFirst();
    }

    public Plan freePlan() {
        return byId("FREE").orElseThrow();
    }

    private String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s;
    }
}

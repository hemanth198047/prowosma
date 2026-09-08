import client, { invalidateCache } from "./client";

const bust = () => invalidateCache("billing");

/** Current plan, seats used/limit, status, invoices, feature flags for this workspace. */
export const getBillingSummary = () => client.get("/billing");

/** All plans (FREE/PRO/BUSINESS/ENTERPRISE) and what each includes. */
export const getPlans = () => client.get("/billing/plans");

/**
 * Starts a real 14-day Pro trial - no card, no Stripe involvement, one-time
 * per workspace. Resolves to the updated billing summary.
 */
export const startTrial = async () => {
  const res = await client.post("/billing/start-trial");
  bust();
  return res;
};

/**
 * Starts a real Stripe Checkout session for a plan upgrade.
 * Resolves to { url } — redirect the browser there to complete payment.
 */
export const startCheckout = async (planId, seats) => {
  const res = await client.post("/billing/checkout", { planId, seats });
  bust();
  return res;
};

/**
 * Opens the real Stripe Billing Portal (update card, view invoices, cancel).
 * Resolves to { url } — redirect the browser there.
 */
export const openBillingPortal = async () => {
  const res = await client.post("/billing/portal");
  return res;
};

export const cancelSubscription = async () => {
  const res = await client.post("/billing/cancel");
  bust();
  return res;
};

export const resumeSubscription = async () => {
  const res = await client.post("/billing/resume");
  bust();
  return res;
};

import client from './client';

export const getBillingSummary = () => client.get('/billing');
export const getPlans = () => client.get('/billing/plans');
export const startTrial = () => client.post('/billing/start-trial');
export const startCheckout = (planId, seats) => client.post('/billing/checkout', { planId, seats });
export const openBillingPortal = () => client.post('/billing/portal');

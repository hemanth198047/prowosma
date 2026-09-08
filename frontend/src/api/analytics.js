import client from "./client";
export const getAnalytics = () => client.get("/analytics");
export const getWorkload  = () => client.get("/analytics/workload");
export const getPortfolio = () => client.get("/analytics/portfolio");

export const getCriticalPath = (projectId) => client.get(`/analytics/critical-path/${projectId}`);

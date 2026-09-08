import client from "./client";
export const getSummaryReport = (from, to) =>
  client.get("/reports/summary", { params: { from, to } });

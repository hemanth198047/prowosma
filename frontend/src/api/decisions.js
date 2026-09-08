import client from "./client";

export const getDecisions     = (wsId, params) => client.get("/decisions", { params: { workspaceId: wsId, ...params } });
export const getDecisionsByDoc= (docId)         => client.get(`/decisions/doc/${docId}`);
export const createDecision   = (data)           => client.post("/decisions", data);
export const updateDecision   = (id, data)       => client.put(`/decisions/${id}`, data);
export const deleteDecision   = (id)             => client.delete(`/decisions/${id}`);
export const aiAnalyseDecision= (id)             => client.post(`/decisions/${id}/ai-analyse`);

// getDecision(id) (singular, GET /decisions/{id}) was removed — it had no
// callers anywhere and no matching backend route either (DecisionController
// only exposes the root list, /doc/{docId}, and the write endpoints below —
// never a get-by-id). Same shape of issue as api/meetings.js's
// getMeetingsByDoc, fixed the same way.

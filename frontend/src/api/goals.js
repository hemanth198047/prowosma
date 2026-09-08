import client, { unwrapList, unwrapPaged } from "./client";

export const getGoals        = (params) => client.get("/goals", { params });
export const getGoal         = (id)     => client.get(`/goals/${id}`);
export const createGoal      = (data)   => client.post("/goals", data);
export const updateGoal      = (id, data) => client.put(`/goals/${id}`, data);
export const updateGoalProgress = (id, progress) => client.patch(`/goals/${id}/progress`, { progress });
export const deleteGoal      = (id)     => client.delete(`/goals/${id}`);
export const getGoalsList    = (params) => client.get("/goals", { params });

// Always-array helpers
export const fetchGoals      = async (params) => unwrapList(await getGoals(params));
export const fetchGoalsPaged = async (params) => unwrapPaged(await getGoals(params));

// Sub-goals & steps
export const addSubGoal     = (id, data)            => client.post(`/goals/${id}/subgoals`, data);
export const updateSubGoal  = (id, subGoalId, data) => client.put(`/goals/${id}/subgoals/${subGoalId}`, data);
export const deleteSubGoal  = (id, subGoalId)       => client.delete(`/goals/${id}/subgoals/${subGoalId}`);
export const addStep        = (id, subGoalId, data) => client.post(`/goals/${id}/subgoals/${subGoalId}/steps`, data);
export const toggleStep     = (id, subGoalId, stepId) => client.patch(`/goals/${id}/subgoals/${subGoalId}/steps/${stepId}/toggle`);
export const deleteStep     = (id, subGoalId, stepId) => client.delete(`/goals/${id}/subgoals/${subGoalId}/steps/${stepId}`);

// Step comments / attachments / dependencies
export const addStepComment      = (g, sg, s, data) => client.post(`/goals/${g}/subgoals/${sg}/steps/${s}/comments`, data);
export const deleteStepComment   = (g, sg, s, cid)  => client.delete(`/goals/${g}/subgoals/${sg}/steps/${s}/comments/${cid}`);
export const addStepAttachment   = (g, sg, s, fd)   => client.post(`/goals/${g}/subgoals/${sg}/steps/${s}/attachments`, fd, { headers: { "Content-Type": "multipart/form-data" } });
export const deleteStepAttachment= (g, sg, s, aid)  => client.delete(`/goals/${g}/subgoals/${sg}/steps/${s}/attachments/${aid}`);
export const addStepDependency   = (g, sg, s, bid)  => client.post(`/goals/${g}/subgoals/${sg}/steps/${s}/dependencies`, { blockedByStepId: bid });
export const removeStepDependency= (g, sg, s, bid)  => client.delete(`/goals/${g}/subgoals/${sg}/steps/${s}/dependencies/${bid}`);

// Cascading / tree
export const getRootGoals   = ()   => client.get("/goals/roots");
export const getChildGoals  = (id) => client.get(`/goals/${id}/children`);
export const getGoalTree    = ()   => client.get("/goals/tree");

// Confidence scoring
export const updateConfidence = (id, confidence, note) => client.patch(`/goals/${id}/confidence`, { confidence, note });

// Check-ins
export const addCheckIn    = (id, data)       => client.post(`/goals/${id}/checkins`, data);
export const deleteCheckIn = (id, checkInId)  => client.delete(`/goals/${id}/checkins/${checkInId}`);

// Key results
export const addKeyResult    = (id, data)       => client.post(`/goals/${id}/keyresults`, data);
export const updateKeyResult = (id, krId, data) => client.patch(`/goals/${id}/keyresults/${krId}`, data);
export const deleteKeyResult = (id, krId)       => client.delete(`/goals/${id}/keyresults/${krId}`);

export const updateGoalDependencies = (id, prereqs) =>
  client.patch(`/goals/${id}/dependencies`, { prerequisiteGoalIds: prereqs });

import client from "./client";

export const getAISettings = () => client.get("/ai/settings");
export const saveAISettings = (data) => client.post("/ai/settings", data);
export const toggleAI = (enabled) =>
  client.patch("/ai/settings/toggle", { enabled });
export const toggleAIFeature = (key) =>
  client.patch(`/ai/settings/features/${key}`);

export const generateTasks = (data) => client.post("/ai/task-assistant", data);
export const adviseGoal = (data) => client.post("/ai/goal-advisor", data);
export const prioritizeTasks = () => client.post("/ai/prioritize", {});
export const getDailyDigest = () => client.get("/ai/daily-digest");
export const breakdown = (data) => client.post("/ai/breakdown", data);
export const scheduletasks = (data) => client.post("/ai/schedule", data);
export const getWeeklyPlan = () => client.get("/ai/weekly-plan");
export const estimateTask = (data) => client.post("/ai/estimate", data);
export const getStandup = () => client.get("/ai/standup");
export const detectDependencies = () => client.get("/ai/detect-dependencies");
export const detectRisks = () => client.get("/ai/risks");
export const naturalTask = (data) => client.post("/ai/natural-task", data);
export const meetingNotes = (data) => client.post("/ai/meeting-notes", data);
export const getFocusMode = () => client.get("/ai/focus-mode");
export const negotiateDeadline = (data) =>
  client.post("/ai/deadline-negotiator", data);
export const burnoutCheck = () => client.get("/ai/burnout-check");
export const askKnowledge = (data) => client.post("/ai/ask", data);
export const chatWithAI = (data) => client.post("/ai/chat", data);
export const predictRisks = () => client.get("/ai/predict-risks");
export const teamInsights = () => client.get("/ai/team-insights");

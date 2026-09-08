import client from "./client";
export const getKpis       = ()           => client.get("/kpis");
export const getKpi        = (id)         => client.get(`/kpis/${id}`);
export const createKpi     = (data)       => client.post("/kpis", data);
export const updateKpi     = (id, data)   => client.put(`/kpis/${id}`, data);
export const deleteKpi     = (id)         => client.delete(`/kpis/${id}`);
export const recordValue   = (id, data)   => client.post(`/kpis/${id}/values`, data);
export const forecastGoal  = (goalId)     => client.get(`/kpis/forecast/${goalId}`);

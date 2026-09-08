import client from "./client";

// Releases
export const getReleases     = (projectId) => client.get("/releases", { params: projectId ? { projectId } : {} });
export const createRelease   = (data)      => client.post("/releases", data);
export const updateRelease   = (id, data)  => client.put(`/releases/${id}`, data);
export const deleteRelease   = (id)        => client.delete(`/releases/${id}`);

// Initiatives
export const getInitiatives  = ()          => client.get("/initiatives");
export const createInitiative= (data)      => client.post("/initiatives", data);
export const updateInitiative= (id, data)  => client.put(`/initiatives/${id}`, data);
export const deleteInitiative= (id)        => client.delete(`/initiatives/${id}`);

// Change Requests now live in api/changeRequests.js, used by the dedicated
// /change-requests page — this file's own getChanges/createChange/
// updateChange/deleteChange were the duplicate PortfolioPlus.jsx "Changes"
// tab's API calls, removed along with that tab (kept would've meant two
// separate wrapper modules hitting the same /api/changes endpoint, an easy
// way for a future edit to update one and not the other).

// Programmes
export const getProgrammes   = ()          => client.get("/programmes");
export const createProgramme = (data)      => client.post("/programmes", data);
export const updateProgramme = (id, data)  => client.put(`/programmes/${id}`, data);
export const deleteProgramme = (id)        => client.delete(`/programmes/${id}`);
export const addMilestone    = (id, data)  => client.post(`/programmes/${id}/milestones`, data);
export const toggleMilestone = (id, mId)   => client.patch(`/programmes/${id}/milestones/${mId}/toggle`);

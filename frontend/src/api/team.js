import client from "./client";
export const getTeamMembers       = ()         => client.get("/team");
export const createTeamMember     = (data)     => client.post("/team", data);
export const updateTeamMember     = (id, data) => client.put(`/team/${id}`, data);
export const deleteTeamMember     = (id)       => client.delete(`/team/${id}`);
// F04 — resolve current user role by email
export const getTeamMemberByEmail = (email)    => client.get(`/team/by-email?email=${encodeURIComponent(email)}`);

export const pingPresence  = ()  => client.post("/team/presence/ping");
export const getPresence   = ()  => client.get("/team/presence");

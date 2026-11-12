import client from "./client";

/** Everyone with reporting line + contact details (GET /api/team/org). */
export const getOrgChart = () => client.get("/team/org");
/** Admin: manager, job title, department, contact details. */
export const updateMemberOrg = (memberId, body) => client.put(`/team/${memberId}/org`, body);
/** Your own contact card: phone, location, timeZone, bio. */
export const updateMyContact = (body) => client.put("/users/me/contact", body);
/** Replace a project's team: [{ email, projectRole, allocationPercent }]. */
export const updateProjectTeam = (projectId, members) => client.put(`/projects/${projectId}/team`, { members });

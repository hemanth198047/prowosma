import client from "./client";

export const sendInvitation   = (data)  => client.post("/invitations", data);
export const getPendingInvites = ()     => client.get("/invitations");
export const cancelInvitation  = (id)   => client.delete(`/invitations/${id}`);
export const resendInvitation  = (id)   => client.post(`/invitations/${id}/resend`);
export const acceptInvitation  = (data) => client.post("/invitations/accept", data);
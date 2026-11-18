import client from "./client";

// Attendance (/api/attendance). Every GET skips the 30-second response cache: the clock changes all the time.
const BASE = "/attendance";
const fresh = { _noCache: true };

export const getAttendanceStatus = () => client.get(`${BASE}/status`, fresh);
export const getMyAttendance = () => client.get(`${BASE}/me`, fresh);
export const clockIn = (body) => client.post(`${BASE}/me/clock-in`, body);
export const clockOut = (body) => client.post(`${BASE}/me/clock-out`, body || {});
export const startBreak = (type) => client.post(`${BASE}/me/break/start`, { type });
export const endBreak = (countAsWork = false) => client.post(`${BASE}/me/break/end`, { countAsWork });
export const reportIdle = (since) => client.post(`${BASE}/me/idle`, { since });
export const getMyLogs = (from, to) => client.get(`${BASE}/me/logs`, { ...fresh, params: { from, to } });
export const getMyRequests = () => client.get(`${BASE}/me/requests`, fresh);
export const requestCorrection = (body) => client.post(`${BASE}/me/corrections`, body);
export const requestLeave = (body) => client.post(`${BASE}/me/leave`, body);
export const cancelRequest = (id) => client.post(`${BASE}/me/requests/${id}/cancel`, {});
export const claimOvertime = (logId, note) => client.post(`${BASE}/me/logs/${logId}/overtime`, { note });
export const getBalances = () => client.get(`${BASE}/me/balances`, fresh);
export const getMyCallTimes = () => client.get(`${BASE}/me/call-times`, fresh);
export const getAttendanceCalendar = (from, to) => client.get(`${BASE}/calendar`, { ...fresh, params: { from, to } });

export const getApprovals = () => client.get(`${BASE}/approvals`, fresh);
export const decideRequest = (id, approve, note) => client.post(`${BASE}/approvals/requests/${id}`, { approve, note });
export const decideOvertime = (logId, approve, note) => client.post(`${BASE}/approvals/overtime/${logId}`, { approve, note });

export const getReport = (params) => client.get(`${BASE}/report`, { ...fresh, params });
export const exportReport = (params) => client.get(`${BASE}/report/export`, { ...fresh, params, responseType: "blob" });

export const getFloor = () => client.get(`${BASE}/floor`, fresh);
export const getAttendanceSettings = () => client.get(`${BASE}/settings`, fresh);
export const saveAttendanceSettings = (body) => client.put(`${BASE}/settings`, body);
export const addShift = (body) => client.post(`${BASE}/shifts`, body);
export const saveShift = (id, body) => client.put(`${BASE}/shifts/${id}`, body);
export const deleteShift = (id) => client.delete(`${BASE}/shifts/${id}`);
export const getCallTimes = (from, to) => client.get(`${BASE}/call-times`, { ...fresh, params: { from, to } });
export const addCallTime = (body) => client.post(`${BASE}/call-times`, body);
export const deleteCallTime = (id) => client.delete(`${BASE}/call-times/${id}`);

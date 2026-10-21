import client from "./client";

export const getDocs        = (workspaceId) => client.get(`/docs?workspaceId=${workspaceId}`);
export const getDoc         = (id)           => client.get(`/docs/${id}`);
export const createDoc      = (data)         => client.post("/docs", data);
export const updateDoc      = (id, data)     => client.put(`/docs/${id}`, data);
export const deleteDoc      = (id)           => client.delete(`/docs/${id}`);
export const searchDocs     = (q, wsId)      => client.get(`/docs/search?q=${encodeURIComponent(q)}&workspaceId=${wsId}`);
export const getRecentDocs  = (wsId)         => client.get(`/docs/recent?workspaceId=${wsId}`);
export const moveDoc        = (id, parentId) => client.patch(`/docs/${id}/move`, { parentId });
export const duplicateDoc   = (id)           => client.post(`/docs/${id}/duplicate`);
export const toggleFavorite = (id)           => client.post(`/docs/${id}/favorite`);
export const getFavorites   = (wsId)         => client.get(`/docs/favorites?workspaceId=${wsId}`);
export const getDocVersions = (id)           => client.get(`/docs/${id}/versions`);
export const restoreVersion = (id, ver)      => client.post(`/docs/${id}/versions/${ver}/restore`);
// Who can see the doc: audience (PRIVATE | DEPARTMENTS | WORKSPACE), departmentIds, sharedWith (emails)
export const updateDocAccess = (id, body) => client.put(`/docs/${id}/access`, body);
// A-8: Publishing
export const setDocVisibility = (id, visibility) => client.patch(`/docs/${id}/publish`, { visibility });
// A-12: Tags & category
export const updateDocTags    = (id, tags, category) => client.patch(`/docs/${id}/tags`, { tags, category });

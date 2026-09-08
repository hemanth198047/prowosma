import client from "./client";
export const getCustomFields = () => client.get("/custom-fields");
export const getCustomFieldsByEntity = (entityType) =>
  client.get(`/custom-fields/entity/${entityType}`);
export const createCustomField = (data) => client.post("/custom-fields", data);
export const updateCustomField = (id, data) =>
  client.put(`/custom-fields/${id}`, data);
export const deleteCustomField = (id) => client.delete(`/custom-fields/${id}`);

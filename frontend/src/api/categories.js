import client, { invalidateCache } from "./client";

const bust = () => invalidateCache("categories");

export const getCategories  = (params) => client.get("/categories", { params });
export const createCategory = async (data) => {
  const res = await client.post("/categories", data);
  bust();
  return res;
};
export const updateCategory = async (id, data) => {
  const res = await client.put(`/categories/${id}`, data);
  bust();
  return res;
};
export const deleteCategory = async (id) => {
  const res = await client.delete(`/categories/${id}`);
  bust();
  return res;
};

import client from "./client";

export const getTimeReport     = (params)   => client.get("/time/report", { params });
export const getInvoices       = ()         => client.get("/time/invoices");
export const createInvoice     = (data)     => client.post("/time/invoices", data);
export const updateInvoice     = (id, data) => client.put(`/time/invoices/${id}`, data);
export const deleteInvoice     = (id)       => client.delete(`/time/invoices/${id}`);
export const generateInvoice   = (data)     => client.post("/time/invoices/generate", data);

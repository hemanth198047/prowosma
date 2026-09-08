import { createContext, useContext } from "react";

export const ToastContext = createContext(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  return ctx || { show: () => {} };
}

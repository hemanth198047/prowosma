// Extracted from components/ConfirmDialog.jsx so that file has no
// non-component exports — react-refresh/only-export-components requires
// files that export a component to export *only* components, or Fast
// Refresh (HMR) can't reliably preserve state across edits.
import { createContext, useContext } from "react";

export const ConfirmContext = createContext(null);

/**
 * Usage:
 *   const confirm = useConfirm();
 *   const ok = await confirm({ title: "Delete project?", message: "...", danger: true });
 *   if (ok) { ... }
 */
export function useConfirm() {
  return useContext(ConfirmContext) || (() => Promise.resolve(false));
}

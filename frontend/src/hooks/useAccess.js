import { useContext } from "react";
import { AccessContext } from "../context/AccessContext";

/** What the person may see and do (department access). Defaults to "unrestricted" outside the provider. */
export const useAccess = () =>
  useContext(AccessContext) || {
    loading: false, restricted: false, enabled: false, mode: "ALL", profileName: "",
    departmentIds: [], departmentAdmin: false, capabilities: [], can: () => true,
  };

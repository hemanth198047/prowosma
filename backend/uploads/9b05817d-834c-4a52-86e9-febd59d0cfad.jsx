import { createContext, useState } from "react";
import client from "../api/client";

export const AuthContext = createContext(null);

function getInitialUser() {
  const token = localStorage.getItem("token");
  const userData = localStorage.getItem("user");
  if (token && userData) {
    client.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    return JSON.parse(userData);
  }
  return null;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(getInitialUser);
  const [loading] = useState(false);

  const loginUser = (userData, token) => {
    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify(userData));
    client.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    setUser(userData);
  };

  const logoutUser = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    delete client.defaults.headers.common["Authorization"];
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, loginUser, logoutUser }}>
      {children}
    </AuthContext.Provider>
  );
}

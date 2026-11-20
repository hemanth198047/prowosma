import { useState, useCallback } from "react";
import { ToastContext } from "./ToastContext";
import { CircleCheck as IcCircleCheck, CircleX as IcCircleX, Info as IcInfo, TriangleAlert as IcTriangleAlert } from "lucide-react";

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const show = useCallback((message, type = "info", duration = 3500) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);

  const remove = (id) =>
    setToasts((prev) => prev.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={"toast toast-" + t.type}>
            <span className="toast-icon">
              {t.type === "success" ? <IcCircleCheck size={16} strokeWidth={1.5} aria-hidden="true" />
                : t.type === "error" ? <IcCircleX size={16} strokeWidth={1.5} aria-hidden="true" />
                : t.type === "warning" ? <IcTriangleAlert size={16} strokeWidth={1.5} aria-hidden="true" />
                : <IcInfo size={16} strokeWidth={1.5} aria-hidden="true" />}
            </span>
            <span className="toast-message">{t.message}</span>
            <button className="toast-close" onClick={() => remove(t.id)}>
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

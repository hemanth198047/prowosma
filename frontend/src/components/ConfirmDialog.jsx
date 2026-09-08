import { useState, useCallback } from "react";
import { ConfirmContext } from "../hooks/useConfirm";

/**
 * Usage:
 *   const confirm = useConfirm();
 *   const ok = await confirm({ title: "Delete project?", message: "...", danger: true });
 *   if (ok) { ... }
 */
export function ConfirmProvider({ children }) {
  const [dialog, setDialog] = useState(null);

  const confirm = useCallback(({
    title,
    message,
    danger = false,
    confirmText = "Confirm",
    cancelText = "Cancel",
  }) => {
    return new Promise((resolve) => {
      setDialog({ title, message, danger, confirmText, cancelText, resolve });
    });
  }, []);

  const handleConfirm = () => { dialog?.resolve(true);  setDialog(null); };
  const handleCancel  = () => { dialog?.resolve(false); setDialog(null); };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {dialog && (
        <div
          onClick={handleCancel}
          style={{
            position:       "fixed",
            inset:          0,
            zIndex:         99999,
            display:        "flex",
            alignItems:     "center",
            justifyContent: "center",
            background:     "rgba(0, 0, 0, 0.45)",
            backdropFilter: "blur(2px)",
          }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (handleCancel)?.(e); } }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background:   "#fff",
              borderRadius: "14px",
              padding:      "32px 28px 24px",
              width:        "100%",
              maxWidth:     "420px",
              margin:       "0 16px",
              boxShadow:    "0 20px 60px rgba(0,0,0,0.2)",
              display:      "flex",
              flexDirection:"column",
              alignItems:   "center",
              gap:          "12px",
              textAlign:    "center",
            }} role="presentation"
          >
            {/* Icon */}
            <div style={{
              fontSize:     "36px",
              lineHeight:   1,
              marginBottom: "4px",
            }}>
              {dialog.danger ? "🗑️" : "❓"}
            </div>

            {/* Title */}
            <h3 style={{
              margin:     0,
              fontSize:   "18px",
              fontWeight: 700,
              color:      "#0f172a",
            }}>
              {dialog.title}
            </h3>

            {/* Message */}
            {dialog.message && (
              <p style={{
                margin:     0,
                fontSize:   "14px",
                color:      "#64748b",
                lineHeight: 1.6,
              }}>
                {dialog.message}
              </p>
            )}

            {/* Actions */}
            <div style={{
              display:       "flex",
              gap:           "10px",
              marginTop:     "8px",
              width:         "100%",
              justifyContent:"center",
            }}>
              <button
                onClick={handleCancel}
                style={{
                  padding:      "9px 20px",
                  borderRadius: "8px",
                  border:       "1px solid #e2e8f0",
                  background:   "#f8fafc",
                  color:        "#475569",
                  cursor:       "pointer",
                  fontWeight:   600,
                  fontSize:     "14px",
                  minWidth:     "90px",
                }}
              >
                {dialog.cancelText}
              </button>
              <button
                onClick={handleConfirm}
               
                style={{
                  padding:      "9px 20px",
                  borderRadius: "8px",
                  border:       "none",
                  background:   dialog.danger ? "#ef4444" : "#6366f1",
                  color:        "#fff",
                  cursor:       "pointer",
                  fontWeight:   600,
                  fontSize:     "14px",
                  minWidth:     "90px",
                }}
              >
                {dialog.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

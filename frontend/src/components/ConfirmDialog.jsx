import { useState, useCallback, useEffect, useRef } from "react";
import { ConfirmContext } from "../hooks/useConfirm";

/**
 * Usage:
 *   const confirm = useConfirm();
 *   const ok = await confirm({ title: "Delete project?", message: "...", danger: true });
 *   if (ok) { ... }
 *
 * Also used for plain messages (replacing the browser's alert()):
 *   await confirm({ title: "Your backup codes", message: codes, confirmText: "Done", cancelText: null });
 * cancelText: null shows a single button. Line breaks in `message` are kept,
 * and long messages scroll, so codes or a changelog stay readable and selectable.
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

  // Keyboard: focus goes into the dialog (to Cancel for destructive actions,
  // so Enter never deletes by accident), Escape cancels, and focus returns
  // to where it was afterwards.
  const confirmRef = useRef(null);
  const cancelRef  = useRef(null);
  useEffect(() => {
    if (!dialog) return undefined;
    const previous = document.activeElement;
    const target = dialog.danger && dialog.cancelText !== null ? cancelRef.current : confirmRef.current;
    target?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); dialog.cancelText === null ? handleConfirm() : handleCancel(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (previous && typeof previous.focus === "function") previous.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when a new dialog opens
  }, [dialog]);

  const multiline = typeof dialog?.message === "string" && dialog.message.includes("\n");

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {dialog && (
        <div
          // Only a click on the backdrop itself cancels; clicks inside the dialog don't.
          onClick={(e) => { if (e.target === e.currentTarget) handleCancel(); }}
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
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            aria-describedby={dialog.message ? "confirm-dialog-message" : undefined}
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
            }}
          >
            {/* Icon */}
            <div aria-hidden="true" style={{
              fontSize:     "36px",
              lineHeight:   1,
              marginBottom: "4px",
            }}>
              {dialog.danger ? "🗑️" : "❓"}
            </div>

            {/* Title */}
            <h3 id="confirm-dialog-title" style={{
              margin:     0,
              fontSize:   "18px",
              fontWeight: 700,
              color:      "#0f172a",
            }}>
              {dialog.title}
            </h3>

            {/* Message */}
            {dialog.message && (
              <p id="confirm-dialog-message" style={{
                margin:     0,
                fontSize:   "14px",
                color:      "#64748b",
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
                wordBreak:  "break-word",
                userSelect: "text",
                ...(multiline ? { textAlign: "left", width: "100%", maxHeight: "50vh", overflowY: "auto" } : {}),
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
              {dialog.cancelText !== null && <button
                ref={cancelRef}
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
              </button>}
              <button
                ref={confirmRef}
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

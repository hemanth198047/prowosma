import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, X } from "lucide-react";
import { cloneProject } from "../api/projects";
import { apiErrorMessage } from "../utils/apiError";
import "../styles/pages/project-clone.css";

/**
 * "Clone project": asks for the new name (filled in as "<name> (Copy)") and says what is and isn't copied.
 * Calls onCloned(newProject) after the copy is made; shows the server's reason in the dialog if it fails.
 */
export default function CloneProjectDialog({ project, onClose, onCloned }) {
  const [name, setName] = useState(`${project.name} (Copy)`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    const onKey = (e) => { if (e.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const trimmed = name.trim();
  const tooLong = trimmed.length > 200;

  const submit = async (e) => {
    e?.preventDefault();
    if (!trimmed) { setError("Give the new project a name."); return; }
    if (tooLong) return;
    setBusy(true); setError("");
    try {
      const res = await cloneProject(project.id, trimmed);
      onCloned(res.data);
    } catch (err) {
      setError(apiErrorMessage(err, "Couldn't clone the project. Please try again."));
      setBusy(false);
    }
  };

  return createPortal(
    <div className="cpd-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <form className="cpd" role="dialog" aria-modal="true" aria-labelledby="cpd-title" onSubmit={submit}>
        <div className="cpd-head">
          <div className="cpd-icon" aria-hidden="true"><Copy size={18} /></div>
          <div className="cpd-titles">
            <h2 id="cpd-title">Clone project</h2>
            <p>Make a new project based on <strong>{project.name}</strong>.</p>
          </div>
          <button type="button" className="cpd-x" onClick={onClose} disabled={busy} aria-label="Close"><X size={18} /></button>
        </div>

        <label className="cpd-field" htmlFor="cpd-name">New project name</label>
        <input id="cpd-name" ref={inputRef} className="cpd-input" value={name} maxLength={220}
          onChange={(e) => { setName(e.target.value); if (error) setError(""); }}
          aria-invalid={!!error || tooLong} aria-describedby="cpd-help" disabled={busy} />
        {tooLong && <p className="cpd-error" role="alert">Keep the name under 200 characters.</p>}
        {error && <p className="cpd-error" role="alert">{error}</p>}

        <div id="cpd-help" className="cpd-what">
          <div><span className="cpd-yes">Copied</span><span>Description, colour, budget, linked goal, and who can see it.</span></div>
          <div><span className="cpd-no">Not copied</span><span>Tasks, sub-projects, files and history. The copy starts as Active.</span></div>
        </div>

        <div className="cpd-foot">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !trimmed || tooLong}>{busy ? "Cloning…" : "Clone project"}</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

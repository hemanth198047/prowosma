import { useEffect, useRef, useState } from "react";
import SecretInput from "./ui/SecretInput";
import { listAIModels } from "../api/ai";
import { BACKUP_PRESETS, MAX_BACKUPS, presetOf, backupsForServer } from "../utils/backupProviders";
import { Plus as IcPlus, Trash2 as IcTrash, ShieldCheck as IcShield } from "lucide-react";

function Row({ row, index, onChange, onRemove }) {
  const preset = presetOf(row);
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState("");
  const req = useRef(0);
  const typed = (row.apiKey || "").trim();
  const custom = row.apiProvider === "CUSTOM";
  const ready = custom ? (row.apiBaseUrl || "").trim().length > 8 && (typed.length >= 8 || row.apiKeySaved) : typed.length >= 10 || row.apiKeySaved;

  useEffect(() => {
    if (!ready) return undefined;
    const id = ++req.current;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await listAIModels({ apiProvider: row.apiProvider, apiKey: typed, apiBaseUrl: row.apiBaseUrl || "", backupId: row.id || "" });
        if (id !== req.current) return;
        const list = res.data?.models || [];
        setModels(list);
        setNote(list.length ? "" : apiErrorMessage({ response: res }, "No models were returned for this key."));
      } catch {
        if (id === req.current) { setModels([]); setNote("Couldn't check this key right now."); }
      } finally {
        if (id === req.current) setLoading(false);
      }
    }, 700);
    return () => clearTimeout(t);
  }, [ready, row.apiProvider, row.apiBaseUrl, typed, row.id, row.apiKeySaved]);

  const pick = (presetId) => {
    const p = BACKUP_PRESETS.find((x) => x.id === presetId);
    onChange({ ...row, label: p.label, apiProvider: p.apiProvider, apiBaseUrl: p.url, model: "", apiKey: "", apiKeySaved: false });
  };

  const shownModels = ready ? models : [];
  const shownNote = ready ? note : "";
  const verified = ready && !loading && shownModels.length > 0;
  return (
    <div className="ai-backup-row" data-testid={`backup-${index}`}>
      <div className="ai-backup-head">
        <span className="ai-backup-num">{index + 1}</span>
        <label className="ai-backup-label" htmlFor={`backup-provider-${index}`}>Backup {index + 1}</label>
        <span className={`ai-backup-state ${verified ? "ok" : ""}`}>
          {loading ? "Checking key…" : verified ? `Key works · ${shownModels.length} models` : row.apiKeySaved || typed ? "Key saved" : "Needs a key"}
        </span>
        <button type="button" className="btn-secondary ai-backup-remove" onClick={onRemove} aria-label={`Remove backup ${index + 1}`}>
          <IcTrash size={14} strokeWidth={1.5} aria-hidden="true" /> Remove
        </button>
      </div>

      <div className="ai-backup-grid">
        <div className="form-group">
          <label htmlFor={`backup-provider-${index}`}>Service</label>
          <select id={`backup-provider-${index}`} value={preset.id} onChange={(e) => pick(e.target.value)}>
            {BACKUP_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label} — {p.tag}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor={`backup-key-${index}`}>API key</label>
          <SecretInput id={`backup-key-${index}`} value={row.apiKey || ""} onChange={(e) => onChange({ ...row, apiKey: e.target.value })}
            placeholder={row.apiKeySaved ? "Saved — leave blank to keep it" : preset.hint} />
        </div>
        <div className="form-group">
          <label htmlFor={`backup-model-${index}`}>Model</label>
          <select id={`backup-model-${index}`} value={row.model || ""} onChange={(e) => onChange({ ...row, model: e.target.value })}>
            <option value="">Automatic (recommended)</option>
            {row.model && !shownModels.includes(row.model) && <option value={row.model}>{row.model}</option>}
            {shownModels.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>

      {preset.id === "OTHER" && (
        <div className="form-group">
          <label htmlFor={`backup-url-${index}`}>Address of the service</label>
          <input id={`backup-url-${index}`} value={row.apiBaseUrl || ""} onChange={(e) => onChange({ ...row, apiBaseUrl: e.target.value })}
            placeholder="https://api.example.com/v1/chat/completions" />
        </div>
      )}
      {preset.keyUrl && (
        <p className="ai-backup-help">
          Get a key from <a href={preset.keyUrl} target="_blank" rel="noreferrer">{preset.label}</a>.
          {preset.id === "OPENROUTER" && " Only models marked free are used."}
        </p>
      )}
      {shownNote && <p className="ai-backup-help ai-backup-warn">{shownNote}</p>}
    </div>
  );
}

/**
 * Backup AI providers: used one after another, in this order, when the main one is rate-limited, out of quota, overloaded or rejects
 * its key — so people don't have to wait for an admin to switch anything. Saved together with the rest of the AI Settings.
 */
export default function BackupProviders({ rows, onChange }) {
  const update = (i, next) => onChange(rows.map((r, j) => (j === i ? next : r)));
  const add = () => onChange([...rows, { _k: Math.random().toString(36).slice(2), id: null, label: "Groq", apiProvider: "CUSTOM", apiBaseUrl: BACKUP_PRESETS[1].url, model: "", apiKey: "", apiKeySaved: false }]);
  return (
    <div className="ai-config-card ai-backup-card">
      <div className="ai-config-title">Backup AI providers</div>
      <div className="ai-config-note">
        Free AI plans have daily limits and sometimes say "too many requests". Add one to three backups and Prowosma switches to the
        next one by itself when the main provider can't answer — nobody has to wait or change a setting. Backups are tried in this order.
      </div>
      {rows.map((r, i) => (
        <Row key={r._k} row={r} index={i} onChange={(next) => update(i, next)} onRemove={() => onChange(rows.filter((_, j) => j !== i))} />
      ))}
      {rows.length < MAX_BACKUPS && (
        <button type="button" className="btn-secondary ai-backup-add" onClick={add}>
          <IcPlus size={14} strokeWidth={1.5} aria-hidden="true" /> Add a backup provider
        </button>
      )}
      <p className="ai-backup-privacy">
        <IcShield size={14} strokeWidth={1.5} aria-hidden="true" />
        Some free plans let the provider use what you send to improve their products. For confidential client meetings, make a paid key your main provider.
      </p>
    </div>
  );
}

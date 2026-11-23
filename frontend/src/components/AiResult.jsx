import { useState } from "react";
import { AlertTriangle, Info, Copy, Check, X } from "lucide-react";

const humanKey = (k) => String(k).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase());
const isPlain = (v) => v == null || ["string", "number", "boolean"].includes(typeof v);
const TITLE_KEYS = ["title", "name", "taskTitle", "goalTitle", "risk", "task", "focusTask", "label", "step", "date"];

/** Database ids mean nothing to a person: fields like taskId / dependsOnId, and values that look like an id, are never shown. */
const ID_KEY = /(^id$|_id$|[a-z]Ids?$)/;
const ID_VALUE = /^([0-9a-f]{24}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const shownEntries = (obj) => Object.entries(obj).filter(([k, v]) => !ID_KEY.test(k) && !(typeof v === "string" && ID_VALUE.test(v)));
const isDependency = (x) => x && typeof x === "object" && typeof x.taskTitle === "string" && typeof x.dependsOnTitle === "string";

/** Words a person would use for a value: booleans as Yes/No, nothing as a dash. */
const showValue = (v) => (v == null || v === "" ? "–" : v === true ? "Yes" : v === false ? "No" : String(v));

/** The same content as plain text, for Copy. */
export function toText(data, depth = 0) {
  const pad = "  ".repeat(depth);
  if (isPlain(data)) return pad + showValue(data);
  if (Array.isArray(data)) return data.map((x) => (isPlain(x) ? `${pad}• ${showValue(x)}` : toText(x, depth + 1))).join("\n");
  return shownEntries(data).map(([k, v]) => (isPlain(v) ? `${pad}${humanKey(k)}: ${showValue(v)}` : `${pad}${humanKey(k)}:\n${toText(v, depth + 1)}`)).join("\n");
}

function Value({ value, depth }) {
  if (isPlain(value)) return <p className="ai-r-text">{showValue(value)}</p>;
  if (Array.isArray(value)) {
    if (!value.length) return <p className="ai-r-text ai-r-muted">None</p>;
    if (value.every(isPlain)) return <ul className="ai-r-list">{value.map((x, i) => <li key={i}>{showValue(x)}</li>)}</ul>;
    return <div className="ai-r-cards">{value.map((x, i) => <Card key={i} item={x} depth={depth + 1} />)}</div>;
  }
  return <Fields data={value} depth={depth + 1} />;
}

/** "AB50 REEL  waits for  Reels Correction", then why, and how sure the AI is. */
function DependencyCard({ item }) {
  const conf = String(item.confidence || "").toUpperCase();
  return (
    <div className="ai-r-card ai-r-dep">
      <div className="ai-r-dep-line">
        <strong>{item.taskTitle}</strong>
        <span className="ai-r-dep-arrow">waits for</span>
        <strong>{item.dependsOnTitle}</strong>
        {conf && <span className={`ai-r-conf ai-r-conf--${conf.toLowerCase()}`}>{conf === "HIGH" ? "Very likely" : conf === "MEDIUM" ? "Likely" : conf === "LOW" ? "Possible" : conf}</span>}
      </div>
      {item.reason && <p className="ai-r-text ai-r-muted">{item.reason}</p>}
    </div>
  );
}

function Card({ item, depth }) {
  if (isDependency(item)) return <DependencyCard item={item} />;
  if (isPlain(item)) return <div className="ai-r-card"><p className="ai-r-text">{showValue(item)}</p></div>;
  if (Array.isArray(item)) return <div className="ai-r-card"><Value value={item} depth={depth} /></div>;
  const titleKey = TITLE_KEYS.find((k) => typeof item[k] === "string" && item[k]);
  const rest = shownEntries(item).filter(([k]) => k !== titleKey);
  return (
    <div className="ai-r-card">
      {titleKey && <div className="ai-r-card-title">{item[titleKey]}</div>}
      <Fields data={Object.fromEntries(rest)} depth={depth} compact />
    </div>
  );
}

function Fields({ data, depth = 0, compact = false }) {
  return (
    <div className={compact ? "ai-r-fields ai-r-fields--compact" : "ai-r-fields"}>
      {shownEntries(data).map(([k, v]) => (
        <div key={k} className="ai-r-field">
          <div className="ai-r-key">{humanKey(k)}</div>
          <Value value={v} depth={depth} />
        </div>
      ))}
    </div>
  );
}

const SETTINGS_KINDS = new Set(["NOT_CONFIGURED", "AUTH", "MODEL", "DISABLED", "BAD_ANSWER"]);

/**
 * What an AI feature answered, in words and lists instead of raw data. Three shapes:
 *  - {error, hint}  something stopped it: what happened and what to do (never a technical message)
 *  - {message}      nothing to report yet (for example, no tasks), said kindly
 *  - anything else  the answer itself, laid out as headings, paragraphs, bullet lists and cards
 */
export default function AiResult({ data, onClose, canOpenSettings = false, onOpenSettings }) {
  const [copied, setCopied] = useState(false);
  if (data == null) return null;

  const isObj = typeof data === "object" && !Array.isArray(data);
  const error = isObj && typeof data.error === "string" ? data : null;
  const onlyMessage = isObj && !error && typeof data.message === "string" && Object.keys(data).filter((k) => k !== "message").every((k) => Array.isArray(data[k]) && data[k].length === 0);

  const copy = async () => {
    try { await navigator.clipboard.writeText(toText(data)); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard blocked */ }
  };

  if (error) {
    return (
      <div className="ai-r-box ai-r-box--error" role="alert">
        <AlertTriangle size={18} aria-hidden="true" />
        <div className="ai-r-box-body">
          <strong>{error.error}</strong>
          {error.hint && <p>{error.hint}</p>}
          {canOpenSettings && SETTINGS_KINDS.has(error.kind) && onOpenSettings && (
            <button type="button" className="btn-secondary pg-btn" onClick={onOpenSettings}>Open AI Settings</button>
          )}
        </div>
        {onClose && <button type="button" className="ai-r-x" onClick={onClose} aria-label="Dismiss"><X size={14} aria-hidden="true" /></button>}
      </div>
    );
  }
  if (onlyMessage) {
    return (
      <div className="ai-r-box ai-r-box--info" role="status">
        <Info size={18} aria-hidden="true" />
        <div className="ai-r-box-body"><strong>{data.message}</strong></div>
        {onClose && <button type="button" className="ai-r-x" onClick={onClose} aria-label="Dismiss"><X size={14} aria-hidden="true" /></button>}
      </div>
    );
  }

  const body = isObj ? Object.fromEntries(Object.entries(data).filter(([k]) => k !== "message")) : data;
  return (
    <div className="ai-r-result">
      <div className="ai-r-head">
        <span>AI Response</span>
        <div className="ai-r-head-actions">
          <button type="button" className="ai-r-headbtn" onClick={copy}>{copied ? <><Check size={13} aria-hidden="true" />Copied</> : <><Copy size={13} aria-hidden="true" />Copy</>}</button>
          {onClose && <button type="button" className="ai-r-headbtn" onClick={onClose} aria-label="Close"><X size={14} aria-hidden="true" /></button>}
        </div>
      </div>
      <div className="ai-r-body">
        {isObj && typeof data.message === "string" && <p className="ai-r-note">{data.message}</p>}
        {isObj ? <Fields data={body} /> : <Value value={body} depth={0} />}
      </div>
    </div>
  );
}

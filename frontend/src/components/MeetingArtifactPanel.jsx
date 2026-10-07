import { useState, useEffect, useCallback } from "react";
import { useToast } from "./ToastContext";
import { useConfirm } from "../hooks/useConfirm";
import { apiErrorMessage } from "../utils/apiError";
import { inlineTokens, parseBlocks } from "../utils/markdownLite";
import { formatClock } from "../utils/meetingStatus";
import {
  getMeetingArtifacts, getArtifactVersions, getArtifactVersion, getArtifactDiff, saveArtifact, restoreArtifact,
  acceptPendingArtifact, dismissPendingArtifact, generateMeetingOutputs, getMeetingTranscript,
} from "../api/meetingAssistant";

const LABEL = { SUMMARY: "summary", MOM: "minutes of meeting", NOTES: "notes" };
const SOURCE = { AI: "Generated", USER_EDIT: "Edited", RESTORE: "Restored" };
const fmt = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "");

/** Renders generated Markdown as plain text; evidence markers become buttons that open the cited transcript lines. */
function Document({ markdown, onEvidence }) {
  return (
    <div className="ma-doc">
      {parseBlocks(markdown).map((b, i) => {
        const content = (text) => inlineTokens(text).map((t, j) => {
          if (t.t === "ev") {
            return (
              <button key={j} type="button" className="ma-ev" onClick={() => onEvidence(t.from, t.to)}
                aria-label={t.from === t.to ? `Show transcript line ${t.from}` : `Show transcript lines ${t.from} to ${t.to}`}>{t.v}</button>
            );
          }
          if (t.t === "bold") return <strong key={j}>{t.v}</strong>;
          if (t.t === "em") return <em key={j}>{t.v}</em>;
          return <span key={j}>{t.v}</span>;
        });
        if (b.type === "ul") return <ul key={i}>{b.items.map((it, k) => <li key={k}>{content(it)}</li>)}</ul>;
        if (b.type === "h1") return <h3 key={i} className="ma-doc-h1">{content(b.text)}</h3>;
        if (b.type === "h2") return <h4 key={i}>{content(b.text)}</h4>;
        if (b.type === "h3") return <h5 key={i}>{content(b.text)}</h5>;
        return <p key={i}>{content(b.text)}</p>;
      })}
    </div>
  );
}

export default function MeetingArtifactPanel({ session, type, aiReady, aiReason, onChanged }) {
  const { show: toast } = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState(undefined);       // undefined = loading, null = none yet
  const [loadError, setLoadError] = useState("");
  const [versions, setVersions] = useState([]);
  const [viewing, setViewing] = useState(null);      // an older version shown read-only
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [diff, setDiff] = useState(null);
  const [evidence, setEvidence] = useState(null);    // { from, to, lines }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const processing = session.status === "PROCESSING";

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await getMeetingArtifacts(session.id);
        if (live) { setData(res.data[type] ?? null); setLoadError(""); }
      } catch (e) { if (live) setLoadError(apiErrorMessage(e, "Couldn't load this document.")); }
    })();
    return () => { live = false; };
  }, [session.id, session.status, session.outputsGeneratedAt, session.transcriptReceivedAt, type, reload]);

  const refresh = useCallback(() => setReload((n) => n + 1), []);

  const run = async (fn, okMsg) => {
    setBusy(true); setError("");
    try { await fn(); if (okMsg) toast(okMsg, "success"); refresh(); await onChanged?.(); }
    catch (e) { setError(apiErrorMessage(e, "That didn't work. Please try again.")); }
    finally { setBusy(false); }
  };

  const showEvidence = async (from, to) => {
    try {
      const res = await getMeetingTranscript(session.id, { after: Math.max(0, from - 1), limit: Math.min(20, to - from + 1) });
      setEvidence({ from, to, lines: res.data.segments });
    } catch (e) { setError(apiErrorMessage(e, "Couldn't load those transcript lines.")); }
  };

  const loadVersions = async () => {
    try { setVersions((await getArtifactVersions(session.id, type)).data); } catch (e) { setError(apiErrorMessage(e, "Couldn't load the versions.")); }
  };

  const openVersion = async (n) => {
    if (!n) { setViewing(null); return; }
    try { setViewing((await getArtifactVersion(session.id, type, Number(n))).data); }
    catch (e) { setError(apiErrorMessage(e, "Couldn't open that version.")); }
  };

  const compare = async () => {
    try {
      const res = await getArtifactDiff(session.id, type, data.current.version, data.pending.version);
      setDiff(res.data);
    } catch (e) { setError(apiErrorMessage(e, "Couldn't compare the versions.")); }
  };

  const save = () => run(async () => {
    await saveArtifact(session.id, type, data.current.version, draft);
    setEditing(false);
  }, "Saved as a new version");

  const accept = async () => {
    const ok = await confirm({ title: "Use the newly generated version?",
      message: "It becomes the current version. Your current version stays in the history and can be restored.", confirmText: "Use new version" });
    if (ok) await run(async () => { await acceptPendingArtifact(session.id, type); setDiff(null); }, "New version is now current");
  };

  if (processing) return <p className="ma-hint" role="status">Generating the summary, minutes and notes… this page updates by itself.</p>;
  if (loadError) return <p className="ma-error" role="alert">{loadError}</p>;
  if (data === undefined) return <p className="ma-hint">Loading…</p>;

  if (data === null) {
    return (
      <div className="ma-empty">
        {session.canGenerate && aiReady ? (
          <>
            <p>The {LABEL[type]} hasn't been generated yet.</p>
            <button className="ma-btn primary" disabled={busy} onClick={() => run(() => generateMeetingOutputs(session.id), "Generating…")}>Generate summary, minutes and notes</button>
          </>
        ) : session.segmentCount > 0 && !aiReady ? (
          <p>The {LABEL[type]} can't be generated because AI isn't ready. {aiReason} <a href="/ai-settings">AI Settings</a></p>
        ) : (
          <p>No transcript has been collected for this meeting, so there is nothing to show here yet.</p>
        )}
        {error && <p className="ma-error" role="alert">{error}</p>}
      </div>
    );
  }

  const shown = viewing || data.current;
  const isCurrent = !viewing || viewing.version === data.current.version;
  return (
    <div>
      {data.stale && (
        <p className="ma-note warn" role="status">
          The transcript changed after this was written, so it may be out of date.
          {session.canGenerate && aiReady && <> <button className="ma-link" disabled={busy} onClick={() => run(() => generateMeetingOutputs(session.id), "Generating…")}>Generate again</button></>}
        </p>
      )}
      {data.pending && (
        <div className="ma-note ok" role="status">
          <strong>A newly generated version is ready to review.</strong> Your current version has not been changed.
          {session.canManage && (
            <div className="ma-actions">
              <button className="ma-btn" onClick={diff ? () => setDiff(null) : compare}>{diff ? "Hide changes" : "Compare"}</button>
              <button className="ma-btn primary" disabled={busy} onClick={accept}>Use new version</button>
              <button className="ma-btn" disabled={busy} onClick={() => run(() => dismissPendingArtifact(session.id, type), "Kept your version")}>Keep mine</button>
            </div>
          )}
        </div>
      )}
      {diff && (
        <ul className="ma-diff" aria-label="Changes in the new version">
          {diff.filter((d) => d.t !== " " || d.line.trim()).map((d, i) => (
            <li key={i} className={`ma-diff-${d.t === "+" ? "add" : d.t === "-" ? "del" : "same"}`}>
              <span className="ma-diff-mark">{d.t === "+" ? "Added:" : d.t === "-" ? "Removed:" : ""}</span> {d.line}
            </li>
          ))}
        </ul>
      )}

      <div className="ma-doc-bar">
        <span className="ma-hint">
          Version {shown.version} · {SOURCE[shown.source] || shown.source}{shown.createdBy && shown.createdBy !== "system" ? ` by ${shown.createdBy}` : ""} · {fmt(shown.createdAt)}
          {!isCurrent && " (older version)"}
        </span>
        <span className="ma-actions">
          <label className="ma-hint" htmlFor={`ma-ver-${type}`}>History</label>
          <select id={`ma-ver-${type}`} value={viewing ? viewing.version : ""} onFocus={loadVersions} onChange={(e) => openVersion(e.target.value)}>
            <option value="">Current (v{data.current.version})</option>
            {versions.filter((v) => v.version !== data.current.version).map((v) => (
              <option key={v.version} value={v.version}>v{v.version} — {SOURCE[v.source] || v.source} — {fmt(v.createdAt)}</option>
            ))}
          </select>
          {session.canManage && isCurrent && !editing && (
            <button className="ma-btn" onClick={() => { setDraft(data.current.markdown); setEditing(true); }}>Edit</button>)}
          {session.canManage && !isCurrent && (
            <button className="ma-btn" disabled={busy} onClick={() => run(async () => { await restoreArtifact(session.id, type, viewing.version); setViewing(null); }, "Restored as a new version")}>Restore this version</button>)}
        </span>
      </div>

      {editing ? (
        <div className="ma-field">
          <label htmlFor={`ma-edit-${type}`}>Edit the {LABEL[type]}</label>
          <textarea id={`ma-edit-${type}`} value={draft} onChange={(e) => setDraft(e.target.value)} style={{ minHeight: 260 }} />
          <p className="ma-hint">Keep the [#12] markers next to a statement to keep its link to the transcript. Saving creates a new version; nothing is lost.</p>
          <div className="ma-actions">
            <button className="ma-btn primary" disabled={busy || !draft.trim()} onClick={save}>Save</button>
            <button className="ma-btn" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <Document markdown={shown.markdown} onEvidence={showEvidence} />
      )}

      {evidence && (
        <section className="ma-evidence" aria-label="Transcript evidence">
          <div className="ma-row-top">
            <strong>Transcript lines {evidence.from === evidence.to ? evidence.from : `${evidence.from}–${evidence.to}`}</strong>
            <button className="ma-btn" onClick={() => setEvidence(null)}>Close</button>
          </div>
          <ol className="ma-transcript">
            {evidence.lines.map((l) => (
              <li key={l.seq} className="ma-line">
                <span className="ma-time">{formatClock(l.startMs) || `#${l.seq}`}</span>
                <span><span className={l.speaker ? "ma-speaker" : "ma-speaker unknown"}>{l.speaker || "Unknown speaker"}</span>{l.text}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
      {error && <p className="ma-error" role="alert">{error}</p>}
    </div>
  );
}

import { useState, useEffect, useCallback } from "react";
import { apiErrorMessage } from "../utils/apiError";
import { formatClock } from "../utils/meetingStatus";
import {
  extractMeetingActions, getMeetingActions, getMeetingActionsPreview, patchMeetingAction, decideMeetingAction, mergeMeetingAction,
  approveValidMeetingActions, resolveMeetingActionsDiff, patchProposedProject, decideProposedProject, getMeetingTranscript,
} from "../api/meetingAssistant";

const KIND = { COMMITMENT: ["Agreed", "success"], SUGGESTION: ["Suggested, not agreed", "progress"], UNRESOLVED: ["Not settled", "neutral"] };
const STATE = { PROPOSED: ["Needs review", "info"], APPROVED: ["Approved", "success"], REJECTED: ["Rejected", "neutral"], MERGED: ["Merged", "neutral"], WITHDRAWN: ["Withdrawn", "danger"] };
const CONF = { HIGH: "High confidence", MEDIUM: "Medium confidence", LOW: "Low confidence" };
const NOT_BUILT = "Creating tasks and projects in Prowosma isn't available yet. Approving only marks items as ready.";

function Chip({ tone, children }) { return <span className={`ma-chip ${tone}`}>{children}</span>; }

/* Shared loader: refetches when the meeting's action state changes or after any edit. */
function useActionsData(session, mode) {
  const [data, setData] = useState(undefined);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = mode === "preview" ? await getMeetingActionsPreview(session.id) : await getMeetingActions(session.id);
        const extra = mode === "preview" ? (await getMeetingActions(session.id)).data : null;
        if (live) { setData(mode === "preview" ? { preview: res.data, list: extra } : res.data); setError(""); }
      } catch (e) { if (live) setError(apiErrorMessage(e, "Couldn't load the actions.")); }
    })();
    return () => { live = false; };
  }, [session.id, session.actionsStatus, session.actionsExtractedAt, session.actionsPendingDiff, session.status, mode, tick]);
  return { data, error, reload: useCallback(() => setTick((n) => n + 1), []) };
}

function EvidenceChips({ evidence, onShow }) {
  return (
    <span className="ma-evrow">
      {evidence.map((n) => (
        <button key={n} type="button" className="ma-ev" onClick={() => onShow(n, n)} aria-label={`Show transcript line ${n}`}>[#{n}]</button>
      ))}
    </span>
  );
}

function ActionCard({ a, all, members, projects, proposals, canManage, busy, selected, onSelect, run, onShow, sessionId }) {
  const [kindLabel, kindTone] = KIND[a.kind] || KIND.UNRESOLVED;
  const [stLabel, stTone] = STATE[a.status] || STATE.PROPOSED;
  const eligible = members.filter((m) => m.role !== "VIEWER");
  const active = all.filter((x) => x.id !== a.id && x.status !== "MERGED");
  const patch = (data, ok) => run(() => patchMeetingAction(sessionId, a.id, data), ok);
  const blocking = a.reasons.filter((r) => r.blocking);
  const notes = a.reasons.filter((r) => !r.blocking);
  const ownerValue = a.owner.userId || "";
  const projectValue = a.project.state === "PROPOSED_NEW" ? `new:${a.project.proposedName}` : a.project.id || "";
  const locked = !canManage || a.status === "MERGED";
  const ownerLabel = a.owner.userId ? `${a.owner.name}${a.owner.basis === "SPEAKER_LABEL" ? " (the speaker)" : ""}` : "Unassigned";

  return (
    <li className="ma-row" aria-label={`Action: ${a.title}`}>
      <div className="ma-row-top">
        <label className="ma-check">
          <input type="checkbox" checked={selected} disabled={locked || a.status !== "PROPOSED"} onChange={(e) => onSelect(a.id, e.target.checked)} />
          <span className="ma-sr">Select {a.title}</span>
        </label>
        <strong className="ma-row-title" style={{ flex: 1 }}>{a.title}</strong>
        <span className="ma-chips">
          <Chip tone={kindTone}>{kindLabel}</Chip> <Chip tone={stTone}>{stLabel}</Chip> <Chip tone="neutral">{CONF[a.confidence]}</Chip>
        </span>
      </div>
      {a.description && <p className="ma-meta">{a.description}</p>}
      <EvidenceChips evidence={a.evidence} onShow={onShow} />

      <div className="ma-fields">
        <div className="ma-field">
          <label htmlFor={`own-${a.id}`}>Owner{a.owner.asSpoken ? ` (said: “${a.owner.asSpoken}”)` : ""}</label>
          <select id={`own-${a.id}`} value={ownerValue} disabled={locked || busy} onChange={(e) => patch({ ownerUserId: e.target.value || null }, "Owner updated")}>
            <option value="">Unassigned</option>
            {eligible.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <span className="ma-hint">{ownerLabel}</span>
          {!a.owner.userId && a.owner.candidates.length > 0 && !locked && (
            <span className="ma-hint">Could be:{" "}
              {a.owner.candidates.map((c) => (
                <button key={c.id} type="button" className="ma-link" disabled={busy} onClick={() => patch({ ownerUserId: c.id }, "Owner updated")}>{c.name}</button>
              ))}
            </span>
          )}
        </div>

        <div className="ma-field">
          <label htmlFor={`prj-${a.id}`}>Project</label>
          <select id={`prj-${a.id}`} value={projectValue} disabled={locked || busy}
            onChange={(e) => (e.target.value.startsWith("new:") ? patch({ proposedProject: e.target.value.slice(4) }, "Project updated") : patch({ projectId: e.target.value || null }, "Project updated"))}>
            <option value="">No project chosen</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            {proposals.filter((p) => p.status !== "REJECTED").map((p) => <option key={p.id} value={`new:${p.name}`}>New project: {p.name}</option>)}
          </select>
          {a.project.state === "PROPOSED_NEW" && <span className="ma-hint">A new project that needs approval first.</span>}
        </div>

        <div className="ma-field">
          <label htmlFor={`due-${a.id}`}>Due date{a.deadline.text ? ` (said: “${a.deadline.text}”)` : ""}</label>
          <input id={`due-${a.id}`} type="date" value={a.deadline.date || ""} disabled={locked || busy}
            onChange={(e) => patch({ deadlineDate: e.target.value || null }, "Due date updated")} />
          {a.deadline.note && <span className="ma-hint">{a.deadline.note}</span>}
        </div>

        <div className="ma-field">
          <label htmlFor={`pri-${a.id}`}>Priority</label>
          <select id={`pri-${a.id}`} value={a.priority} disabled={locked || busy} onChange={(e) => patch({ priority: e.target.value }, "Priority updated")}>
            {["LOW", "MEDIUM", "HIGH"].map((p) => <option key={p} value={p}>{p.charAt(0) + p.slice(1).toLowerCase()}</option>)}
          </select>
          <span className="ma-hint">{a.priorityBasis === "DEFAULT" ? "Default — priority wasn't discussed." : a.priorityBasis === "STATED" ? "Stated in the meeting." : "Set by a person."}</span>
        </div>
      </div>

      {(a.dependencies.length > 0 || a.acceptanceCriteria.length > 0) && (
        <p className="ma-meta">
          {a.dependencies.length > 0 && <>Depends on: {a.dependencies.join("; ")}. </>}
          {a.acceptanceCriteria.length > 0 && <>Done when: {a.acceptanceCriteria.join("; ")}.</>}
        </p>
      )}

      {blocking.length > 0 && <ul className="ma-reasons" aria-label="Needs attention">{blocking.map((r) => <li key={r.code}><strong>Needs attention:</strong> {r.message}</li>)}</ul>}
      {notes.length > 0 && <ul className="ma-reasons soft" aria-label="Notes">{notes.map((r) => <li key={r.code}>{r.message}</li>)}</ul>}

      {canManage && (
        <div className="ma-actions">
          {a.status === "PROPOSED" && (
            <button className="ma-btn primary" disabled={busy || !a.valid} title={a.valid ? "" : "Resolve the items above first"} onClick={() => run(() => decideMeetingAction(sessionId, a.id, "APPROVE"), "Approved")}>Approve</button>)}
          {(a.status === "PROPOSED" || a.status === "APPROVED") && (
            <button className="ma-btn danger" disabled={busy} onClick={() => run(() => decideMeetingAction(sessionId, a.id, "REJECT"), "Rejected")}>Reject</button>)}
          {["REJECTED", "WITHDRAWN", "MERGED"].includes(a.status) && (
            <button className="ma-btn" disabled={busy} onClick={() => run(() => decideMeetingAction(sessionId, a.id, "RESTORE"), "Restored")}>Restore</button>)}
          {a.kind !== "COMMITMENT" && a.status === "PROPOSED" && (
            <button className="ma-btn" disabled={busy} onClick={() => patch({ kind: "COMMITMENT" }, "Marked as agreed")} title="Use this if it really was agreed in the meeting">It was agreed</button>)}
          {a.duplicateOf && a.status === "PROPOSED" && (
            <button className="ma-btn" disabled={busy} onClick={() => patch({ notDuplicate: true }, "Keeping both")}>Keep both</button>)}
          {a.status === "PROPOSED" && active.length > 0 && (
            <span className="ma-merge">
              <label htmlFor={`mrg-${a.id}`} className="ma-hint">Merge into</label>
              <select id={`mrg-${a.id}`} value="" disabled={busy} onChange={(e) => e.target.value && run(() => mergeMeetingAction(sessionId, a.id, e.target.value), "Merged")}>
                <option value="">Choose…</option>
                {active.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
              </select>
            </span>)}
        </div>
      )}
    </li>
  );
}

function ProposedProjects({ proposals, canManage, busy, run, sessionId, onShow }) {
  if (!proposals.length) return <div className="ma-empty">No new projects are proposed. Actions are attached to existing projects.</div>;
  return (
    <ul className="ma-list">
      {proposals.map((p) => (
        <ProposalCard key={p.id} p={p} canManage={canManage} busy={busy} run={run} sessionId={sessionId} onShow={onShow} />
      ))}
    </ul>
  );
}

function ProposalCard({ p, canManage, busy, run, sessionId, onShow }) {
  const [name, setName] = useState(p.name);
  const [desc, setDesc] = useState(p.description || "");
  const [stLabel, stTone] = STATE[p.status] || STATE.PROPOSED;
  const dirty = name !== p.name || desc !== (p.description || "");
  return (
    <li className="ma-row" aria-label={`Proposed project: ${p.name}`}>
      <div className="ma-row-top"><strong className="ma-row-title">New project: {p.name}</strong><Chip tone={stTone}>{stLabel}</Chip></div>
      {p.rationale && <p className="ma-meta">{p.rationale}</p>}
      <EvidenceChips evidence={p.evidence} onShow={onShow} />
      {canManage && p.status !== "REJECTED" && (
        <>
          <div className="ma-field"><label htmlFor={`pn-${p.id}`}>Project name</label>
            <input id={`pn-${p.id}`} type="text" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="ma-field"><label htmlFor={`pd-${p.id}`}>Description (required)</label>
            <textarea id={`pd-${p.id}`} value={desc} onChange={(e) => setDesc(e.target.value)} style={{ minHeight: 70 }} /></div>
          {p.missingFields.length > 0 && <p className="ma-warn">Missing: {p.missingFields.join(", ")}.</p>}
        </>
      )}
      {canManage && (
        <div className="ma-actions">
          {dirty && <button className="ma-btn" disabled={busy} onClick={() => run(() => patchProposedProject(sessionId, p.id, { name, description: desc }), "Saved")}>Save changes</button>}
          {p.status === "PROPOSED" && !dirty && <button className="ma-btn primary" disabled={busy || p.missingFields.length > 0} onClick={() => run(() => decideProposedProject(sessionId, p.id, "APPROVE"), "Project approved")}>Approve project</button>}
          {p.status !== "REJECTED" && <button className="ma-btn danger" disabled={busy} onClick={() => run(() => decideProposedProject(sessionId, p.id, "REJECT"), "Project rejected")}>Reject</button>}
          {p.status === "REJECTED" && <button className="ma-btn" disabled={busy} onClick={() => run(() => decideProposedProject(sessionId, p.id, "RESTORE"), "Restored")}>Restore</button>}
        </div>
      )}
    </li>
  );
}

function useShared(session, reload, onChanged) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [evidence, setEvidence] = useState(null);
  const run = async (fn, ok) => {
    setBusy(true); setError("");
    try { await fn(); reload(); await onChanged?.(); return ok; }
    catch (e) { setError(apiErrorMessage(e, "That didn't work. Please try again.")); return null; }
    finally { setBusy(false); }
  };
  const showEvidence = async (from, to) => {
    try {
      const res = await getMeetingTranscript(session.id, { after: Math.max(0, from - 1), limit: Math.min(20, to - from + 1) });
      setEvidence({ from, to, lines: res.data.segments });
    } catch (e) { setError(apiErrorMessage(e, "Couldn't load those transcript lines.")); }
  };
  return { busy, error, evidence, setEvidence, run, showEvidence, setError };
}

function EvidenceBox({ evidence, onClose }) {
  if (!evidence) return null;
  return (
    <section className="ma-evidence" aria-label="Transcript evidence">
      <div className="ma-row-top"><strong>Transcript line {evidence.from === evidence.to ? evidence.from : `${evidence.from}–${evidence.to}`}</strong>
        <button className="ma-btn" onClick={onClose}>Close</button></div>
      <ol className="ma-transcript">
        {evidence.lines.map((l) => (
          <li key={l.seq} className="ma-line"><span className="ma-time">{formatClock(l.startMs) || `#${l.seq}`}</span>
            <span><span className={l.speaker ? "ma-speaker" : "ma-speaker unknown"}>{l.speaker || "Unknown speaker"}</span>{l.text}</span></li>
        ))}
      </ol>
    </section>
  );
}

/* ── Actions tab ───────────────────────────────────────────────────────── */
export function MeetingActionsPanel({ session, members = [], projects = [], aiReady, aiReason, onChanged }) {
  const { data, error: loadError, reload } = useActionsData(session, "actions");
  const sh = useShared(session, reload, onChanged);
  const [selected, setSelected] = useState(new Set());
  const canManage = !!session.canManage;
  const toggle = (id, on) => setSelected((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });

  if (loadError) return <p className="ma-error" role="alert">{loadError}</p>;
  if (data === undefined) return <p className="ma-hint">Loading…</p>;
  const running = session.actionsStatus === "RUNNING" || data.status === "RUNNING";
  const validCount = data.actions.filter((a) => a.status === "PROPOSED" && a.valid).length;
  const selectable = data.actions.filter((a) => selected.has(a.id) && a.status === "PROPOSED");

  const approveSelected = async () => {
    for (const a of selectable) await sh.run(() => decideMeetingAction(session.id, a.id, "APPROVE"));
    setSelected(new Set());
  };

  return (
    <div>
      {running && <p className="ma-hint" role="status">Extracting actions from the transcript… this updates by itself.</p>}
      {!running && session.actionsStatus === "FAILED" && (
        <p className="ma-error" role="alert">Action extraction failed. {session.actionsMessage}</p>)}
      {!running && data.actions.length === 0 && session.actionsStatus !== "FAILED" && (
        <div className="ma-empty">
          {data.status === "READY" ? <p>No actions were found in this meeting.</p> : <p>Actions haven't been extracted yet.</p>}
          {session.canExtract && aiReady && (
            <button className="ma-btn primary" disabled={sh.busy} onClick={() => sh.run(() => extractMeetingActions(session.id), "Extracting…")}>
              {data.status === "READY" ? "Extract again" : "Extract actions"}</button>)}
          {session.segmentCount > 0 && !aiReady && <p className="ma-hint">AI isn't ready: {aiReason} <a href="/ai-settings">AI Settings</a></p>}
        </div>
      )}
      {session.canExtract && aiReady && (session.actionsStatus === "FAILED" || data.actions.length > 0) && !running && (
        <p><button className="ma-btn" disabled={sh.busy} onClick={() => sh.run(() => extractMeetingActions(session.id), "Extracting…")}>
          {session.actionsStatus === "FAILED" ? "Try again" : "Analyse again"}</button></p>)}

      {data.pendingDiff && (
        <div className="ma-note ok" role="status">
          <strong>A new analysis found changes.</strong> {data.pendingDiff.new} new, {data.pendingDiff.stillPresent} still present, {data.pendingDiff.noLongerFound} no longer found.
          Nothing you reviewed has been changed.
          {canManage && (
            <div className="ma-actions">
              <button className="ma-btn primary" disabled={sh.busy} onClick={() => sh.run(() => resolveMeetingActionsDiff(session.id, true), "Changes applied")}>Apply changes</button>
              <button className="ma-btn" disabled={sh.busy} onClick={() => sh.run(() => resolveMeetingActionsDiff(session.id, false), "Changes discarded")}>Discard</button>
            </div>)}
        </div>
      )}
      {data.actions.length > 0 && (
        <>
          <p className="ma-hint">{NOT_BUILT} Owners are matched only on an exact, unique name; anything else stays unassigned for you to pick.</p>
          {canManage && (
            <div className="ma-actions">
              <button className="ma-btn primary" disabled={sh.busy || validCount === 0} onClick={() => sh.run(() => approveValidMeetingActions(session.id), "Approved")}>Approve all valid ({validCount})</button>
              <button className="ma-btn" disabled={sh.busy || selectable.length === 0} onClick={approveSelected}>Approve selected ({selectable.length})</button>
            </div>)}
          <ul className="ma-list" aria-label="Actions">
            {data.actions.map((a) => (
              <ActionCard key={a.id} a={a} all={data.actions} members={members} projects={projects} proposals={data.proposedProjects} canManage={canManage}
                busy={sh.busy} selected={selected.has(a.id)} onSelect={toggle} run={sh.run} onShow={sh.showEvidence} sessionId={session.id} />
            ))}
          </ul>
        </>
      )}
      <EvidenceBox evidence={sh.evidence} onClose={() => sh.setEvidence(null)} />
      {sh.error && <p className="ma-error" role="alert">{sh.error}</p>}
    </div>
  );
}

/* ── Projects and Tasks tab: what would be created ─────────────────────── */
export function MeetingProjectsTasksPanel({ session, onChanged }) {
  const { data, error: loadError, reload } = useActionsData(session, "preview");
  const sh = useShared(session, reload, onChanged);
  if (loadError) return <p className="ma-error" role="alert">{loadError}</p>;
  if (data === undefined) return <p className="ma-hint">Loading…</p>;
  const { preview, list } = data;
  const canManage = !!session.canManage;
  return (
    <div>
      <p className="ma-note" role="note">{NOT_BUILT} Nothing below exists in Prowosma yet.</p>
      <h4>New projects proposed from the discussion</h4>
      <ProposedProjects proposals={list.proposedProjects} canManage={canManage} busy={sh.busy} run={sh.run} sessionId={session.id} onShow={sh.showEvidence} />

      <h4>What will be created from approved actions</h4>
      {preview.tasks.length === 0 ? (
        <div className="ma-empty">No actions are approved yet.{preview.waitingForReview > 0 && ` ${preview.waitingForReview} are waiting for review in the Actions tab.`}</div>
      ) : (
        <ol className="ma-list" aria-label="Tasks that will be created">
          {preview.tasks.map((t) => (
            <li key={t.actionId} className="ma-row">
              <strong>{t.title}</strong>
              <p className="ma-meta">
                Assigned to: {t.assignee ? t.assignee.name : "Unassigned"} · Project: {t.project.name}{t.project.isNew ? " (new)" : ""} ·
                Due: {t.dueDate ? `${t.dueDate} (${t.timezone})` : "no date"} · Priority: {t.priority.toLowerCase()}{t.priorityBasis === "DEFAULT" ? " (default)" : ""}
              </p>
              <EvidenceChips evidence={t.evidence} onShow={sh.showEvidence} />
            </li>
          ))}
        </ol>
      )}
      {preview.projects.length > 0 && (
        <ul className="ma-list" aria-label="Projects that will be created">
          {preview.projects.map((p) => <li key={p.id} className="ma-row"><strong>New project: {p.name}</strong><p className="ma-meta">{p.description} — {p.taskCount} task(s)</p></li>)}
        </ul>
      )}
      <EvidenceBox evidence={sh.evidence} onClose={() => sh.setEvidence(null)} />
      {sh.error && <p className="ma-error" role="alert">{sh.error}</p>}
    </div>
  );
}

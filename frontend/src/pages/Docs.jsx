import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import client from "../api/client";
import { useDocCollab } from "../hooks/useDocCollab";
import { getDocs, createDoc, updateDoc, deleteDoc, searchDocs, getDocVersions, restoreVersion, setDocVisibility, updateDocTags } from "../api/docs";
import { getDecisionsByDoc } from "../api/decisions";
import { getTasks } from "../api/tasks";
import { useAuth } from "../hooks/useAuth";
import { useToast } from "../components/ToastContext";
import DocAccessModal from "../components/DocAccessModal";
import { useAccess } from "../hooks/useAccess";

import "../styles/pages/docs.css";
import { statusText } from "../utils/statusText";
import { useConfirm } from "../hooks/useConfirm";
// ═══════════════════════════════════════════════════════
// BLOCK SYSTEM
// ═══════════════════════════════════════════════════════
const BLOCK_MENU = [
  { type:"paragraph",    icon:"¶",   label:"Text",           hint:"Just start writing" },
  { type:"heading1",     icon:"H1",  label:"Heading 1",      hint:"Large section title" },
  { type:"heading2",     icon:"H2",  label:"Heading 2",      hint:"Medium section title" },
  { type:"heading3",     icon:"H3",  label:"Heading 3",      hint:"Small section title" },
  { type:"divider",      icon:"—",   label:"Divider",        hint:"Visual separator" },
  { type:"bulletList",   icon:"•",   label:"Bulleted list",  hint:"Unordered list" },
  { type:"numberedList", icon:"1.",  label:"Numbered list",  hint:"Ordered list" },
  { type:"todo",         icon:"☐",   label:"To-do",          hint:"Trackable checklist" },
  { type:"quote",        icon:"❝",   label:"Quote",          hint:"Highlight a quote" },
  { type:"callout",      icon:"💡",  label:"Callout",        hint:"Draw attention" },
  { type:"code",         icon:"</>", label:"Code",           hint:"Code snippet" },
  { type:"image",        icon:"🖼",  label:"Image",          hint:"Embed image from URL" },
  { type:"taskembed",    icon:"✅",  label:"Task",           hint:"Embed a task from this workspace" },
  { type:"goalembed",    icon:"🎯",  label:"Goal",           hint:"Embed a goal from this workspace" },
  { type:"decision",     icon:"⚖️",  label:"Decision",       hint:"Embed a decision record" },
  { type:"youtube",      icon:"▶",   label:"YouTube",        hint:"Embed a YouTube video" },
  { type:"figma",        icon:"✦",   label:"Figma",          hint:"Embed a Figma file or prototype" },
  { type:"loom",         icon:"⏺",   label:"Loom",           hint:"Embed a Loom video" },
  { type:"iframe",       icon:"⊞",   label:"Embed URL",      hint:"Embed any website or tool" },
  { type:"ai",           icon:"🤖",  label:"AI Write",       hint:"Generate content with AI" },
  { type:"database",     icon:"🗄",  label:"Database",       hint:"Create a linked relational table" },
  { type:"gallery",      icon:"🖼",  label:"Gallery",        hint:"Visual card grid view" },
];

let _blockId = Date.now();
function newBlock(type = "paragraph", content = "") {
  return { id: `b${++_blockId}`, type, content, checked: false };
}

function parseBlocks(raw) {
  if (!raw) return [newBlock()];
  if (Array.isArray(raw)) return raw.length ? raw : [newBlock()];
  if (typeof raw === "string") {
    if (raw.trim() === "" || raw === "[]") return [newBlock()];
    try { const p = JSON.parse(raw); return Array.isArray(p) && p.length ? p : [newBlock()]; }
    catch { return [newBlock("paragraph", raw)]; }
  }
  return [newBlock()];
}

function serializeBlocks(blocks) {
  return JSON.stringify(blocks);
}



// ═══════════════════════════════════════════════════════
// TASK PICKER — shown when /task is selected in slash menu
// ═══════════════════════════════════════════════════════
function TaskPicker({ onSelect, onClose, allTasks }) {
  const [q, setQ] = useState("");
  const filtered = (allTasks || [])
    .filter(t => t.title?.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 10);

  const statusColor = { TODO:"var(--brand-500)", IN_PROGRESS:"var(--warning)", DONE:"var(--success)" };

  return (
    <div className="modal-overlay" onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (onClose)?.(e); } }}>
      <div className="doc-task-picker" onClick={e => e.stopPropagation()} role="presentation">
        <div className="doc-task-picker-header">
          <span>🔗 Embed a task</span>
          <button onClick={onClose}>✕</button>
        </div>
        <input
         
          className="doc-task-picker-search"
          placeholder="Search tasks…"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        <div className="doc-task-picker-list">
          {filtered.length === 0
            ? <div className="doc-task-picker-empty">No tasks found</div>
            : filtered.map(t => (
                <button key={t.id} className="doc-task-picker-item" onClick={() => onSelect(t)}>
                  <span className="doc-task-picker-dot"
                    style={{ background: statusColor[t.status] || "var(--brand-500)" }} />
                  <span className="doc-task-picker-title">{t.title}</span>
                  <span className="doc-task-picker-status">{statusText(t.status)}</span>
                </button>
              ))
          }
        </div>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════
// A-13: GOAL PICKER — shown when /goal selected
// ═══════════════════════════════════════════════════════
function GoalPicker({ onSelect, onClose, allGoals }) {
  const [q, setQ] = useState("");
  const filtered = (allGoals || [])
    .filter(g => g.title?.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 10);
  return (
    <div className="task-picker-overlay" onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (onClose)?.(e); } }}>
      <div className="task-picker" onClick={e => e.stopPropagation()} role="presentation">
        <div className="task-picker-header">🎯 Pick a goal to embed</div>
        <input className="task-picker-search" placeholder="Search goals…"
          value={q} onChange={e => setQ(e.target.value)} />
        <div className="task-picker-list">
          {filtered.length === 0
            ? <div className="task-picker-empty">No goals found</div>
            : filtered.map(g => (
              <div key={g.id} className="task-picker-item" onClick={() => onSelect(g)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => onSelect(g))?.(e); } }}>
                <span className="task-picker-item-title">{g.title || "Untitled goal"}</span>
                <span className="task-picker-item-status">{g.progress ?? 0}%</span>
              </div>
            ))
          }
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// A-13: GOAL EMBED BLOCK
// ═══════════════════════════════════════════════════════
function GoalEmbedBlock({ goalId, allGoals, onRemove }) {
  const goal = allGoals?.find(g => g.id === goalId);
  if (!goal) return (
    <div className="doc-task-embed doc-task-embed--missing">
      <span>⚠️ Goal not found</span>
      <button onClick={onRemove} title="Remove embed">✕</button>
    </div>
  );
  const pct = goal.progress ?? 0;
  return (
    <div className="doc-task-embed doc-goal-embed">
      <div className="doc-task-embed-icon">🎯</div>
      <div className="doc-task-embed-info">
        <div className="doc-task-embed-title">{goal.title}</div>
        <div className="doc-goal-progress-bar">
          <div className="doc-goal-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="doc-task-embed-status">{pct}% complete</div>
      </div>
      <button className="doc-task-embed-remove" onClick={onRemove} title="Remove embed">✕</button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// A-10: EMBED BLOCK — YouTube, Figma, Loom, generic iframe
// ═══════════════════════════════════════════════════════
function EmbedBlock({ type, content, onChange, onRemove }) {
  const [editing, setEditing] = useState(!content);
  const [url, setUrl] = useState(content || "");

  const getEmbedUrl = (rawUrl, t) => {
    if (!rawUrl) return "";
    try {
      if (t === "youtube") {
        const u = new URL(rawUrl);
        const v = u.searchParams.get("v") || u.pathname.split("/").pop();
        return `https://www.youtube.com/embed/${v}`;
      }
      if (t === "loom") {
        return rawUrl.replace("loom.com/share/", "loom.com/embed/");
      }
      // figma and iframe: use as-is
      return rawUrl;
    } catch { return rawUrl; }
  };

  const embedUrl = getEmbedUrl(content, type);
  const label = { youtube: "YouTube", figma: "Figma", loom: "Loom", iframe: "URL" }[type] || "URL";
  const placeholder = {
    youtube: "https://youtube.com/watch?v=...",
    figma:   "https://www.figma.com/file/...",
    loom:    "https://www.loom.com/share/...",
    iframe:  "https://...",
  }[type] || "https://...";

  if (editing || !content) return (
    <div className="doc-embed-url-form">
      <span className="doc-embed-label">{label === "YouTube" ? "▶" : label === "Figma" ? "✦" : label === "Loom" ? "⏺" : "⊞"} Paste {label} link</span>
      <input className="doc-embed-url-input" value={url}
        onChange={e => setUrl(e.target.value)}
        placeholder={placeholder}
        onKeyDown={e => {
          if (e.key === "Enter" && url.trim()) { onChange(url.trim()); setEditing(false); }
          if (e.key === "Escape") onRemove();
        }} />
      <div className="doc-embed-url-actions">
        <button onClick={() => { if (url.trim()) { onChange(url.trim()); setEditing(false); } }}>Embed</button>
        <button onClick={onRemove}>Cancel</button>
      </div>
    </div>
  );

  return (
    <div className="doc-embed-block">
      <div className="doc-embed-toolbar">
        <span className="doc-embed-type-label">{label}</span>
        <button onClick={() => setEditing(true)}>✎ Edit URL</button>
        <button onClick={onRemove}>✕ Remove</button>
      </div>
      <iframe src={embedUrl} className="doc-embed-iframe"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen title={`${label} embed`} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// A-11: AI WRITE BLOCK — generates content via AI
// ═══════════════════════════════════════════════════════
function AIWriteBlock({ onGenerated, onRemove }) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setLoading(true); setError("");
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || "http://localhost:9090"}/api/ai/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("token")}` },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      const text = data?.data || data?.text || "";
      if (text) onGenerated(text);
      else setError("AI returned no content. Try a different prompt.");
    } catch { setError("Could not reach AI service."); }
    finally { setLoading(false); }
  };

  return (
    <div className="doc-ai-block">
      <div className="doc-ai-block-header">🤖 AI Write</div>
      <textarea className="doc-ai-block-input" rows={2}
        placeholder="What should I write? e.g. 'Summarize the risks of this approach' or 'Draft a meeting agenda for sprint planning'"
        value={prompt} onChange={e => setPrompt(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleGenerate(); } }} />
      {error && <div className="doc-ai-block-error">{error}</div>}
      <div className="doc-ai-block-actions">
        <button className="doc-ai-block-btn-primary" disabled={loading || !prompt.trim()} onClick={handleGenerate}>
          {loading ? "⏳ Generating…" : "✨ Generate"}
        </button>
        <button className="doc-ai-block-btn-cancel" onClick={onRemove}>Cancel</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// TASK EMBED BLOCK — renders an embedded task card
// ═══════════════════════════════════════════════════════
function TaskEmbedBlock({ taskId, allTasks, onOpenTask, onRemove }) {
  const task = allTasks?.find(t => t.id === taskId);
  const statusColor  = { TODO:"var(--brand-500)", IN_PROGRESS:"var(--warning)", DONE:"var(--success)" };
  const priorityColor= { LOW:"var(--success)", MEDIUM:"var(--warning)", HIGH:"var(--danger)" };

  if (!task) return (
    <div className="doc-task-embed doc-task-embed--missing">
      <span>⚠️ Task not found</span>
      <button onClick={onRemove} title="Remove embed">✕</button>
    </div>
  );

  return (
    <div className="doc-task-embed" onClick={() => onOpenTask?.(task)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => onOpenTask?.(task))?.(e); } }}>
      <div className="doc-task-embed-left">
        <span className="doc-task-embed-dot"
          style={{ background: statusColor[task.status] || "var(--brand-500)" }} />
      </div>
      <div className="doc-task-embed-body">
        <div className="doc-task-embed-title">{task.title}</div>
        {task.description && (
          <div className="doc-task-embed-desc">{task.description.slice(0,100)}{task.description.length > 100 ? "…" : ""}</div>
        )}
        <div className="doc-task-embed-meta">
          <span className="doc-task-embed-status"
            style={{ color: statusColor[task.status] }}>
            {statusText(task.status)}
          </span>
          {task.priority && (
            <span className="doc-task-embed-priority"
              style={{ color: priorityColor[task.priority] }}>
              {task.priority}
            </span>
          )}
          {task.dueDate && (
            <span className="doc-task-embed-due">
              📅 {new Date(task.dueDate).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>
      <button className="doc-task-embed-remove" title="Remove embed"
        onClick={e => { e.stopPropagation(); onRemove(); }}>✕</button>
    </div>
  );
}


// ═══════════════════════════════════════════════════════
// DECISION BLOCK — inline decision card inside a doc
// ═══════════════════════════════════════════════════════
const DEC_STATUS_META = {
  PROPOSED:   { label:"Proposed",   color:"#5B5FEE", bg:"rgba(99,102,241,0.12)" },
  DECIDED:    { label:"Decided",    color:"#1E8E5A", bg:"rgba(5,150,105,0.12)" },
  SUPERSEDED: { label:"Superseded", color:"#C17D22", bg:"rgba(217,119,6,0.12)" },
  REVERSED:   { label:"Reversed",   color:"#D64545", bg:"rgba(239,68,68,0.12)" },
};

function DecisionInlineForm({ docId, wsId, initial, onSave, onCancel }) {
  const [form, setForm] = useState(initial || {
    title:"", decision:"", rationale:"", owner:"", status:"DECIDED", impact:"MEDIUM"
  });
  const [saving, setSaving] = useState(false);
  const set = (k,v) => setForm(f => ({...f, [k]:v}));

  return (
    <div className="dec-inline-form" onClick={e => e.stopPropagation()} role="presentation">
      <div className="dec-inline-form-title">⚖️ {initial ? "Edit Decision" : "New Decision Record"}</div>
      <div className="form-group">
        <label htmlFor={"docs-title"}>Title *</label>
        <input value={form.title} onChange={e => set("title", e.target.value)}
          placeholder="What was decided?" id={"docs-title"} />
      </div>
      <div className="form-group">
        <label htmlFor={"docs-decision"}>Decision</label>
        <textarea rows={2} value={form.decision} onChange={e => set("decision", e.target.value)}
          placeholder="The actual decision made" id={"docs-decision"} />
      </div>
      <div className="form-group">
        <label htmlFor={"docs-rationale"}>Rationale</label>
        <textarea rows={2} value={form.rationale} onChange={e => set("rationale", e.target.value)}
          placeholder="Why this option was chosen" id={"docs-rationale"} />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label htmlFor={"docs-status"}>Status</label>
          <select value={form.status} onChange={e => set("status", e.target.value)} id={"docs-status"}>
            {Object.entries(DEC_STATUS_META).map(([k,v]) =>
              <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor={"docs-impact"}>Impact</label>
          <select value={form.impact} onChange={e => set("impact", e.target.value)} id={"docs-impact"}>
            {["LOW","MEDIUM","HIGH","CRITICAL"].map(i => <option key={i}>{i}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor={"docs-owner"}>Owner</label>
          <input value={form.owner} onChange={e => set("owner", e.target.value)}
            placeholder="Accountable person" id={"docs-owner"} />
        </div>
      </div>
      <div className="form-actions">
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button className="btn-primary"
          disabled={saving || !form.title.trim()}
          onClick={async () => {
            setSaving(true);
            try { await onSave({ ...form, docId, workspaceId: wsId }); }
            finally { setSaving(false); }
          }}>
          {saving ? "⏳…" : initial ? "Update" : "Save Decision"}
        </button>
      </div>
    </div>
  );
}

function DecisionEmbedBlock({ decisionId, docDecisions, onEdit, onRemove, onNavigate }) {
  const d = docDecisions?.find(dec => dec.id === decisionId);
  const sm = DEC_STATUS_META[d?.status] || DEC_STATUS_META.PROPOSED;

  if (!d) return (
    <div className="dec-embed dec-embed--missing">
      <span>⚠️ Decision not found</span>
      <button onClick={onRemove} title="Remove">✕</button>
    </div>
  );

  return (
    <div className="dec-embed" onClick={() => onNavigate && onNavigate(d)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => onNavigate && onNavigate(d))?.(e); } }}>
      <div className="dec-embed-left">
        <span className="dec-embed-icon">⚖️</span>
      </div>
      <div className="dec-embed-body">
        <div className="dec-embed-header">
          <span className="dec-embed-title">{d.title}</span>
          <span className="dec-embed-status" style={{background:sm.bg, color:sm.color}}>
            {sm.label}
          </span>
          {d.impact && <span className="dec-embed-impact">● {d.impact}</span>}
        </div>
        {d.decision  && <div className="dec-embed-text"><b>Decision: </b>{d.decision}</div>}
        {d.rationale && <div className="dec-embed-text"><b>Rationale: </b>{d.rationale}</div>}
        {d.owner     && <div className="dec-embed-owner">👤 {d.owner}</div>}
      </div>
      <div className="dec-embed-btns" onClick={e => e.stopPropagation()} role="presentation">
        <button title="Edit" onClick={() => onEdit(d)}>✎</button>
        <button title="Remove embed" onClick={onRemove}>✕</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// WIKI-LINK PICKER  — triggered by [[ in any block
// ═══════════════════════════════════════════════════════
function WikiLinkMenu({ query, onSelect, onClose, anchorRef, allDocs }) {
  const [cursor, setCursor] = useState(0);
  const [pos, setPos] = useState({ top: 200, left: 200 });
  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return allDocs.filter(d => !d.deleted && d.title?.toLowerCase().includes(q)).slice(0, 8);
  }, [query, allDocs]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- resets cursor when the search query changes
  useEffect(() => { setCursor(0); }, [query]);

  useLayoutEffect(() => {
    const rect = anchorRef?.current?.getBoundingClientRect?.();
    setPos({
      top:  rect ? rect.bottom + window.scrollY + 4 : 200,
      left: rect ? rect.left   + window.scrollX     : 200,
    });
  }, [anchorRef]);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setCursor(c => Math.min(c+1, filtered.length-1)); }
      if (e.key === "ArrowUp")   { e.preventDefault(); setCursor(c => Math.max(c-1, 0)); }
      if (e.key === "Enter")     { e.preventDefault(); if (filtered[cursor]) onSelect(filtered[cursor]); else onClose(); }
      if (e.key === "Escape")    { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [filtered, cursor, onSelect, onClose]);

  return (
    <div className="doc-wiki-menu" style={{ top: pos.top, left: pos.left }} onMouseDown={e => e.preventDefault()} role="presentation">
      <div className="doc-wiki-menu-label">🔗 Link to page</div>
      {filtered.length === 0
        ? <div className="doc-wiki-empty">No pages match "{query}"</div>
        : filtered.map((d, i) => (
            <div
              key={d.id}
              className={`doc-wiki-item${i === cursor ? " doc-wiki-item--active" : ""}`}
              onMouseDown={() => onSelect(d)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => onSelect(d))?.(e); } }}
            >
              <span className="doc-wiki-emoji">{d.emoji || "📄"}</span>
              <span className="doc-wiki-title">{d.title || "Untitled"}</span>
            </div>
          ))
      }
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// WIKI-LINK RENDERER  — renders [[PageTitle]] as chips
// Parses block content text and replaces [[...]] with
// clickable spans so users can navigate between pages.
// ═══════════════════════════════════════════════════════
function renderWithWikiLinks(text, allDocs, onOpenDoc) {
  if (!text || !text.includes("[[")) return text;
  const parts = text.split(/(\[\[[^\]]+\]\])/g);
  return parts.map((part, i) => {
    const m = part.match(/^\[\[(.+)\]\]$/);
    if (!m) return part;
    const pageTitle = m[1];
    const target = allDocs.find(d => d.title?.toLowerCase() === pageTitle.toLowerCase());
    return (
      <span
        key={i}
        className={`doc-wiki-chip${target ? "" : " doc-wiki-chip--broken"}`}
        title={target ? `Open: ${target.title}` : `Page not found: ${pageTitle}`}
        onClick={e => { e.stopPropagation(); if (target && onOpenDoc) onOpenDoc(target); }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (e => { e.stopPropagation(); if (target && onOpenDoc) onOpenDoc(target); })?.(e); } }}
      >
        {target ? target.emoji || "📄" : "❓"} {pageTitle}
      </span>
    );
  });
}

// ═══════════════════════════════════════════════════════
// BACKLINKS PANEL — shows which docs link to current doc
// ═══════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════
// A-12: DOC TAG PANEL — edit tags & category for a doc
// ═══════════════════════════════════════════════════════
const DOC_CATEGORIES = ["Engineering","Product","Design","HR","Finance","Marketing","Operations","Legal","General"];

function DocTagPanel({ doc, onSave, onClose }) {
  const [tags, setTags]         = useState((doc?.tags || []).join(", "));
  const [category, setCategory] = useState(doc?.category || "");
  const [saving, setSaving]     = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const tagList = tags.split(",").map(t => t.trim()).filter(Boolean);
    await onSave(tagList, category);
    setSaving(false);
  };

  return (
    <div className="doc-tag-panel">
      <div className="doc-tag-panel-header">
        <span>🏷 Tags &amp; Category</span>
        <button onClick={onClose} className="doc-tag-panel-close">✕</button>
      </div>
      <div className="doc-tag-panel-body">
        <div className="form-group">
          <label htmlFor={"docs-category"}>Category</label>
          <select value={category} onChange={e => setCategory(e.target.value)} id={"docs-category"}>
            <option value="">— None —</option>
            {DOC_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor={"docs-tags-comma-separated"}>Tags (comma separated)</label>
          <input value={tags} onChange={e => setTags(e.target.value)}
            placeholder="e.g. api, security, architecture" id={"docs-tags-comma-separated"} />
        </div>
        {(doc?.tags?.length > 0 || doc?.category) && (
          <div className="doc-tag-current">
            {doc?.category && <span className="doc-tag-category-badge">{doc.category}</span>}
            {doc?.tags?.map(t => <span key={t} className="doc-tag-badge">#{t}</span>)}
          </div>
        )}
      </div>
      <div className="doc-tag-panel-footer">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={saving} onClick={handleSave}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function BacklinksPanel({ activeDoc, allDocs, onOpenDoc }) {
  const backlinks = useMemo(() => {
    if (!activeDoc) return [];
    const title = activeDoc.title?.toLowerCase();
    if (!title) return [];
    return allDocs.filter(d => {
      if (d.id === activeDoc.id || d.deleted) return false;
      try {
        const blocks = JSON.parse(d.content || "[]");
        return blocks.some(b => b.content?.toLowerCase().includes(`[[${title}]]`));
      } catch { return false; }
    });
  }, [activeDoc, allDocs]);

  if (backlinks.length === 0) return null;

  return (
    <div className="doc-backlinks">
      <div className="doc-backlinks-header">
        <span className="doc-backlinks-icon">↩</span>
        <span className="doc-backlinks-label">{backlinks.length} backlink{backlinks.length !== 1 ? "s" : ""}</span>
      </div>
      <div className="doc-backlinks-list">
        {backlinks.map(d => (
          <button key={d.id} className="doc-backlink-item" onClick={() => onOpenDoc(d)}>
            <span>{d.emoji || "📄"}</span>
            <span>{d.title || "Untitled"}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// SLASH MENU
// ═══════════════════════════════════════════════════════
function SlashMenu({ query, onSelect, anchorRef }) {
  const filtered = useMemo(() =>
    BLOCK_MENU.filter(b =>
      b.label.toLowerCase().includes(query.toLowerCase()) ||
      b.type.toLowerCase().includes(query.toLowerCase())
    ), [query]);

  const [cursor, setCursor] = useState(0);
  const [pos, setPos] = useState({ top: 200, left: 200 });

  // eslint-disable-next-line react-hooks/set-state-in-effect -- resets cursor when the search query changes
  useEffect(() => { setCursor(0); }, [query]);

  useLayoutEffect(() => {
    const rect = anchorRef?.current?.getBoundingClientRect?.();
    setPos({
      top:  rect ? rect.bottom + window.scrollY + 4 : 200,
      left: rect ? rect.left   + window.scrollX     : 200,
    });
  }, [anchorRef]);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setCursor(c => Math.min(c+1, filtered.length-1)); }
      if (e.key === "ArrowUp")   { e.preventDefault(); setCursor(c => Math.max(c-1, 0)); }
      if (e.key === "Enter")     { e.preventDefault(); if (filtered[cursor]) onSelect(filtered[cursor].type); }
      if (e.key === "Escape")    { onSelect(null); }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [filtered, cursor, onSelect]);

  if (!filtered.length) return null;

  return (
    <div className="doc-slash-menu" style={{ top: pos.top, left: pos.left }} onMouseDown={e => e.preventDefault()} role="presentation">
      <div className="doc-slash-menu-label">Block type</div>
      {filtered.map((b, i) => (
        <div
          key={b.type}
          className={`doc-slash-item${i === cursor ? " doc-slash-item--active" : ""}`}
          onMouseDown={() => onSelect(b.type)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => onSelect(b.type))?.(e); } }}
        >
          <span className="doc-slash-icon">{b.icon}</span>
          <span className="doc-slash-text">
            <span className="doc-slash-name">{b.label}</span>
            <span className="doc-slash-hint">{b.hint}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// SINGLE BLOCK
// ═══════════════════════════════════════════════════════
function BlockRow({ block, index, total, onChange, onDelete, onAddAfter, onAddMultipleAfter, onMoveUp, onMoveDown, onFocus, focused, onRegisterRef, allDocs, onOpenDoc, allTasks, onOpenTask, allGoals, docDecisions, wsId, activeDocId, onDecisionCreated }) {
  const editRef  = useRef(null);

  const [slashQuery, setSlashQuery] = useState(null);
  const [wikiQuery,  setWikiQuery]  = useState(null); // null=closed, string=search query
  const [taskPicker, setTaskPicker]   = useState(false);
  const [decisionForm, setDecisionForm] = useState(false);  // show inline decision form
  const [goalPicker, setGoalPicker]     = useState(false);   // A-13: goal embed picker
  const [editingDecision, setEditingDecision] = useState(null);

  // Register this block's editable node into the parent's ref map
  // so BlockEditor can focus it after Enter creates a new block.
  const setEditRef = useCallback((el) => {
    editRef.current = el;
    if (onRegisterRef) onRegisterRef(block.id, el);
  }, [block.id, onRegisterRef]);

  // Set DOM text ONCE on mount, and again only when block.id or block.type
  // changes (i.e. a different block was loaded, or the slash-menu switched types).
  // We deliberately NEVER sync on block.content changes so React does not
  // fight the user's cursor and reverse their typing.
  const lastSyncKey = useRef(null);
  useEffect(() => {
    const key = block.id + "|" + block.type;
    if (lastSyncKey.current === key) return; // already synced for this block+type
    lastSyncKey.current = key;
    const el = editRef.current;
    if (!el) return;
    // innerText preserves \n as line breaks in contentEditable; textContent strips them
    el.innerText = block.content || '';
  });

  const handlePaste = (e) => {
    e.preventDefault();
    const clipData = e.clipboardData || window.clipboardData;
    let pastedText = clipData.getData("text/plain");

    if (!pastedText) {
      const html = clipData.getData("text/html");
      if (html) {
        const tmp = document.createElement("div");
        tmp.innerHTML = html;
        tmp.querySelectorAll("br").forEach(br => br.replaceWith("\n"));
        tmp.querySelectorAll("p,div,li,h1,h2,h3,h4,h5,h6").forEach(el => {
          el.insertAdjacentText("afterend", "\n");
        });
        pastedText = tmp.innerText || tmp.textContent || "";
      }
    }
    if (!pastedText) return;

    // Parse markdown lines into typed blocks
    const parseMarkdownLine = (line) => {
      if (/^#{3}\s+/.test(line)) return { type:"h3", content: line.replace(/^#{3}\s+/, "") };
      if (/^#{2}\s+/.test(line)) return { type:"h2", content: line.replace(/^#{2}\s+/, "") };
      if (/^#\s+/.test(line))    return { type:"h1", content: line.replace(/^#\s+/, "") };
      if (/^[*-]\s+/.test(line)) return { type:"bulletList", content: line.replace(/^[*-]\s+/, "") };
      if (/^\d+\.\s+/.test(line)) return { type:"numberedList", content: line.replace(/^\d+\.\s+/, "") };
      if (/^>\s+/.test(line))    return { type:"quote", content: line.replace(/^>\s+/, "") };
      if (/^---+$/.test(line.trim())) return { type:"divider", content: "" };
      if (/^```/.test(line))     return { type:"codeBlock", content: line.replace(/^```\w*/, "") };
      return { type:"text", content: line };
    };

    const lines = pastedText.split(/\r?\n/);
    // Remove blank lines but keep structure — group consecutive blanks as paragraph breaks
    const blocks = [];
    for (const raw of lines) {
      const line = raw.trimEnd();
      if (line === "" || line === "---") {
        if (line === "---") blocks.push({ type:"divider", content:"" });
        continue; // skip blank lines between sections
      }
      blocks.push(parseMarkdownLine(line));
    }

    if (blocks.length === 0) return;
    if (blocks.length === 1) {
      onChange({ ...block, ...blocks[0] });
      return;
    }
    // First block replaces current, rest become new blocks after it
    onChange({ ...block, ...blocks[0] });
    onAddMultipleAfter(block.id, blocks.slice(1));
  };

  const handleInput = (e) => {
    const text = e.currentTarget.innerText;
    if (text.startsWith("/")) {
      setSlashQuery(text.slice(1));
      setWikiQuery(null);
    } else {
      // Detect [[query for wiki-link picker
      const m = text.match(/\[\[([^\]]{0,60})$/);
      if (m) {
        setWikiQuery(m[1]);
        setSlashQuery(null);
      } else {
        setWikiQuery(null);
        setSlashQuery(null);
        onChange({ ...block, content: text });
      }
    }
  };

  const handleKeyDown = (e) => {
    if (slashQuery !== null) {
      if (["Enter","ArrowUp","ArrowDown","Escape"].includes(e.key)) return;
    }
    if (wikiQuery !== null) {
      if (["Enter","ArrowUp","ArrowDown","Escape"].includes(e.key)) return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const continueTypes = ["bulletList","numberedList","todo"];
      onAddAfter(block.id, continueTypes.includes(block.type) ? block.type : "paragraph");
    }
    if (e.key === "Backspace" && e.currentTarget.textContent === "") {
      if (total > 1) { e.preventDefault(); onDelete(block.id, "up"); }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "b") { e.preventDefault(); document.execCommand("bold"); }
    if ((e.metaKey || e.ctrlKey) && e.key === "i") { e.preventDefault(); document.execCommand("italic"); }
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      const url = prompt("Link URL:");
      if (url) document.execCommand("createLink", false, url);
    }
  };

  const handleWikiSelect = (doc) => {
    setWikiQuery(null);
    const el = editRef.current;
    if (!el) return;
    // Replace [[query with a wiki-link chip placeholder text  [[PageTitle]]
    const text = el.textContent;
    const newText = text.replace(/\[\[[^\]]{0,60}$/, `[[${doc.title}]]`);
    el.textContent = newText;
    // Move caret to end
    const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
    window.getSelection().removeAllRanges(); window.getSelection().addRange(r);
    onChange({ ...block, content: newText });
  };

  const handleSlashSelect = (type) => {
    setSlashQuery(null);
    if (!type) {
      if (editRef.current) { editRef.current.textContent = ""; editRef.current.focus(); }
      onChange({ ...block, content: "" });
      return;
    }
    if (type === "taskembed") {
      lastSyncKey.current = null;
      onChange({ ...block, type: "taskembed", content: "" });
      setTimeout(() => setTaskPicker(true), 30);
      return;
    }
    if (type === "decision") {
      lastSyncKey.current = null;
      onChange({ ...block, type: "decision", content: "" });
      setTimeout(() => setDecisionForm(true), 30);
      return;
    }
    // A-13: Goal embed
    if (type === "goalembed") {
      lastSyncKey.current = null;
      onChange({ ...block, type: "goalembed", content: "" });
      setTimeout(() => setGoalPicker(true), 30);
      return;
    }
    // A-10: Embed blocks
    if (["youtube","figma","loom","iframe"].includes(type)) {
      lastSyncKey.current = null;
      onChange({ ...block, type, content: "" });
      return;
    }
    // A-11: AI write
    if (type === "ai") {
      lastSyncKey.current = null;
      onChange({ ...block, type: "ai", content: "" });
      return;
    }
    // Force re-sync on next render by bumping the key
    lastSyncKey.current = null;
    onChange({ ...block, type, content: "" });
    setTimeout(() => {
      if (editRef.current) { editRef.current.textContent = ""; editRef.current.focus(); }
    }, 20);
  };

  // ── Task embed ──
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- opens the picker once when this block's type changes to an empty embed
    if (block.type === "taskembed" && !block.content) setTaskPicker(true);
    if (block.type === "decision"  && !block.content) setDecisionForm(true);
    if (block.type === "goalembed" && !block.content) setGoalPicker(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.type]);

  // ── A-13: Goal embed ──
  if (block.type === "goalembed") return (
    <div className={`doc-block doc-block--taskembed${focused ? " doc-block--focused" : ""}`}
      data-block-id={block.id}>
      {goalPicker && (
        <GoalPicker
          allGoals={allGoals}
          onClose={() => {
            setGoalPicker(false);
            if (!block.content) onChange({ ...block, type:"paragraph", content:"" });
          }}
          onSelect={g => {
            setGoalPicker(false);
            lastSyncKey.current = null;
            onChange({ ...block, content: g.id });
          }}
        />
      )}
      {block.content
        ? <GoalEmbedBlock
            goalId={block.content}
            allGoals={allGoals}
            onRemove={() => onChange({ ...block, type:"paragraph", content:"" })}
          />
        : <button className="doc-task-embed-placeholder"
            onClick={() => setGoalPicker(true)}>
            🎯 Click to select a goal to embed
          </button>
      }
    </div>
  );

  // ── A-10: Embed blocks (YouTube, Figma, Loom, iframe) ──
  if (["youtube","figma","loom","iframe"].includes(block.type)) return (
    <div className={`doc-block doc-block--embed${focused ? " doc-block--focused" : ""}`}
      data-block-id={block.id}>
      <EmbedBlock
        type={block.type}
        content={block.content}
        onChange={url => { lastSyncKey.current = null; onChange({ ...block, content: url }); }}
        onRemove={() => onChange({ ...block, type:"paragraph", content:"" })}
      />
    </div>
  );

  // ── A-11: AI write block ──
  if (block.type === "database") {
    const dbCols = block.props?.columns || [];
    const dbRows = block.props?.rows    || [];
    return (
      <div className="doc-db-block">
        <div className="doc-db-header">
          <span>🗄</span>
          <span className="doc-db-title" contentEditable suppressContentEditableWarning
            onBlur={e=>onChange({...block, props:{...block.props,title:e.target.textContent}})}>
            {block.props?.title||"Database"}
          </span>
          <button className="doc-db-add-col" onClick={()=>{
            const title=prompt("Column name:"); if(!title) return;
            onChange({...block, props:{...block.props,columns:[...dbCols,{id:Date.now().toString(),title,type:"text"}]}});
          }}>+ Col</button>
          <button className="doc-db-add-col" onClick={()=>{
            onChange({...block, props:{...block.props,rows:[...dbRows,{id:Date.now().toString()}]}});
          }}>+ Row</button>
        </div>
        <div className="doc-db-table-wrap">
          <table className="doc-db-table">
            <thead><tr>
              {dbCols.map(col=><th key={col.id} className="doc-db-th">{col.title}</th>)}
            </tr></thead>
            <tbody>
              {dbRows.map(row=>(
                <tr key={row.id}>
                  {dbCols.map(col=>(
                    <td key={col.id} className="doc-db-td">
                      <input value={row[col.id]||""} className="doc-db-cell"
                        onChange={e=>{
                          const rows=dbRows.map(r=>r.id===row.id?{...r,[col.id]:e.target.value}:r);
                          onChange({...block, props:{...block.props,rows}});
                        }} />
                    </td>
                  ))}
                </tr>
              ))}
              {dbRows.length===0&&<tr><td colSpan={dbCols.length||1}
                style={{textAlign:"center",padding:"12px",color:"#94a3b8",fontSize:"12px"}}>
                + Row to add data
              </td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (block.type === "gallery") {
    const items = block.props?.items || [];
    return (
      <div className="doc-gallery-block">
        <div className="doc-gallery-grid">
          {items.map((item,i)=>(
            <div key={i} className="doc-gallery-card">
              {item.imageUrl&&<img src={item.imageUrl} alt={item.title||""} className="doc-gallery-img"/>}
              <div className="doc-gallery-card-title">{item.title||"Card"}</div>
              {item.desc&&<div className="doc-gallery-card-desc">{item.desc}</div>}
            </div>
          ))}
        </div>
        <button className="btn-secondary" style={{fontSize:"11px",marginTop:"8px"}} onClick={()=>{
          const title=prompt("Card title:"); if(!title) return;
          const imageUrl=prompt("Image URL (optional):")||"";
          onChange({...block, props:{...block.props,items:[...items,{title,imageUrl,desc:""}]}});
        }}>+ Add Card</button>
      </div>
    );
  }

  if (block.type === "ai") return (
    <div className={`doc-block doc-block--ai${focused ? " doc-block--focused" : ""}`}
      data-block-id={block.id}>
      <AIWriteBlock
        onGenerated={text => {
          // Replace the ai block with a paragraph containing generated text
          onChange({ ...block, type:"paragraph", content: text });
        }}
        onRemove={() => onChange({ ...block, type:"paragraph", content:"" })}
      />
    </div>
  );

  if (block.type === "taskembed") return (
    <div className={`doc-block doc-block--taskembed${focused ? " doc-block--focused" : ""}`}
      data-block-id={block.id}>
      {taskPicker && (
        <TaskPicker
          allTasks={allTasks}
          onClose={() => {
            setTaskPicker(false);
            // If closed without selecting, revert to paragraph
            if (!block.content) onChange({ ...block, type:"paragraph", content:"" });
          }}
          onSelect={t => {
            setTaskPicker(false);
            lastSyncKey.current = null;
            onChange({ ...block, content: t.id });
          }}
        />
      )}
      {block.content
        ? <TaskEmbedBlock
            taskId={block.content}
            allTasks={allTasks}
            onOpenTask={onOpenTask}
            onRemove={() => onChange({ ...block, type:"paragraph", content:"" })}
          />
        : <button className="doc-task-embed-placeholder"
            onClick={() => setTaskPicker(true)}>
            ✅ Click to select a task to embed
          </button>
      }
      <div className="doc-block-actions">
        {index > 0       && <button title="Move up"    onMouseDown={e => { e.preventDefault(); onMoveUp(block.id); }}>↑</button>}
        {index < total-1 && <button title="Move down"  onMouseDown={e => { e.preventDefault(); onMoveDown(block.id); }}>↓</button>}
        <button title="Delete block" onMouseDown={e => { e.preventDefault(); onDelete(block.id, "up"); }}>🗑</button>
      </div>
    </div>
  );

  // ── Decision embed ──
  if (block.type === "decision") return (
    <div className={`doc-block doc-block--decision${focused ? " doc-block--focused" : ""}`}
      data-block-id={block.id}>
      {decisionForm && (
        <div className="modal-overlay" onClick={() => {
          setDecisionForm(false);
          if (!block.content) onChange({ ...block, type:"paragraph", content:"" });
        }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => {
          setDecisionForm(false);
          if (!block.content) onChange({ ...block, type:"paragraph", content:"" });
        })?.(e); } }}>
          <DecisionInlineForm
            docId={activeDocId}
            wsId={wsId}
            initial={editingDecision}
            onCancel={() => {
              setDecisionForm(false);
              setEditingDecision(null);
              if (!block.content && !editingDecision) onChange({ ...block, type:"paragraph", content:"" });
            }}
            onSave={async (payload) => {
              const { createDecision: _c, updateDecision: _u } = await import("../api/decisions");
              let saved;
              if (editingDecision) {
                const r = await _u(editingDecision.id, payload);
                saved = r.data?.data ?? r.data;
              } else {
                const r = await _c(payload);
                saved = r.data?.data ?? r.data;
                if (saved?.id) {
                  onChange({ ...block, content: saved.id });
                  onDecisionCreated?.(saved);
                }
              }
              if (editingDecision && onDecisionCreated) onDecisionCreated(saved);
              setDecisionForm(false);
              setEditingDecision(null);
            }}
          />
        </div>
      )}
      {block.content
        ? <DecisionEmbedBlock
            decisionId={block.content}
            docDecisions={docDecisions}
            onEdit={d => { setEditingDecision(d); setDecisionForm(true); }}
            onRemove={() => onChange({ ...block, type:"paragraph", content:"" })}
            onNavigate={() => window.location.href = "/decisions"}
          />
        : <button className="dec-embed-placeholder" onClick={() => setDecisionForm(true)}>
            ⚖️ Click to create a decision record
          </button>
      }
      <div className="doc-block-actions">
        {index > 0       && <button title="Move up"    onMouseDown={e => { e.preventDefault(); onMoveUp(block.id); }}>↑</button>}
        {index < total-1 && <button title="Move down"  onMouseDown={e => { e.preventDefault(); onMoveDown(block.id); }}>↓</button>}
        <button title="Delete block" onMouseDown={e => { e.preventDefault(); onDelete(block.id, "up"); }}>🗑</button>
      </div>
    </div>
  );

  // ── Divider ──
  if (block.type === "divider") return (
    <div className={`doc-block doc-block--divider${focused ? " doc-block--focused" : ""}`} onClick={() => onFocus(block.id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => onFocus(block.id))?.(e); } }}>
      <hr className="doc-divider-hr" />
      {focused && <div className="doc-block-actions"><button onClick={() => onDelete(block.id, "up")} title="Delete">🗑</button></div>}
    </div>
  );

  // ── Image ──
  if (block.type === "image") return (
    <div className={`doc-block doc-block--image${focused ? " doc-block--focused" : ""}`} onClick={() => onFocus(block.id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => onFocus(block.id))?.(e); } }}>
      {block.content
        ? <img src={block.content} alt="" className="doc-img" onError={e => { e.target.style.display="none"; }} />
        : <button className="doc-img-placeholder" onClick={() => {
            const url = prompt("Image URL (https://…):");
            if (url) onChange({ ...block, content: url });
          }}>🖼 Click to add image URL</button>
      }
    </div>
  );

  const placeholder =
    block.type === "paragraph"    ? "Type '/' for commands…" :
    block.type === "heading1"     ? "Heading 1"  :
    block.type === "heading2"     ? "Heading 2"  :
    block.type === "heading3"     ? "Heading 3"  :
    block.type === "quote"        ? "Quote…"     :
    block.type === "callout"      ? "Callout…"   :
    block.type === "bulletList"   ? "List item"  :
    block.type === "numberedList" ? "List item"  :
    block.type === "todo"         ? "To-do item" : "…";

  // Render [[wiki-links]] as chips when not focused, raw text when editing
  const hasWikiLink = block.content && block.content.includes("[[");
  const renderedContent = (hasWikiLink && !focused && allDocs)
    ? renderWithWikiLinks(block.content, allDocs, onOpenDoc)
    : null;

  const Wrapper = block.type === "code" ? "pre" : "div";

  return (
    <Wrapper
      className={`doc-block doc-block--${block.type}${focused ? " doc-block--focused" : ""}`}
      data-block-id={block.id}
    >
      {/* Left decorations */}
      {block.type === "todo" && (
        <input type="checkbox" checked={!!block.checked}
          onChange={() => onChange({ ...block, checked: !block.checked })}
          className="doc-todo-cb" />
      )}
      {block.type === "quote"        && <div className="doc-quote-line" />}
      {block.type === "callout"      && <span className="doc-callout-emoji">💡</span>}
      {block.type === "bulletList"   && <span className="doc-list-dot">•</span>}
      {block.type === "numberedList" && <span className="doc-list-num">{index + 1}.</span>}

      {/* Slash / wiki menus */}
      {slashQuery !== null && (
        <SlashMenu query={slashQuery} onSelect={handleSlashSelect} anchorRef={editRef} />
      )}
      {wikiQuery !== null && (
        <WikiLinkMenu query={wikiQuery} onSelect={handleWikiSelect}
          onClose={() => setWikiQuery(null)} anchorRef={editRef} allDocs={allDocs} />
      )}

      {/* When unfocused AND has wiki-links: show read-only chip layer */}
      {renderedContent && !focused ? (
        <div
          className="doc-block-input doc-block-rendered"
          onClick={() => onFocus(block.id)}
          style={block.type === "todo" && block.checked ? { textDecoration:"line-through", opacity:0.5 } : {}} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => onFocus(block.id))?.(e); } }}
        >
          {block.content === "" && (
            <span className="doc-block-placeholder">{placeholder}</span>
          )}
          {renderedContent}
        </div>
      ) : null}

      {/* Always-present contentEditable (hidden visually when chip layer shown) */}
      <div
        ref={setEditRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        tabIndex={0}
        className="doc-block-input"
        data-placeholder={!renderedContent || focused ? placeholder : ""}
        onInput={handleInput}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
        onFocus={() => onFocus(block.id)}
        onBlur={() => {
          // When blurring, sync DOM → state so chip layer shows updated content
          const text = editRef.current?.innerText ?? "";
          if (!text.startsWith("/")) onChange({ ...block, content: text });
        }}
        style={{
          ...(block.type === "todo" && block.checked ? { textDecoration:"line-through", opacity:0.5 } : {}),
          // When chip layer visible: keep editable in DOM but visually hidden
          // (do NOT use display:none — focus() won't work on hidden elements)
          ...(renderedContent && !focused ? { position:"absolute", left:0, top:0, width:"100%", height:"100%", opacity:0, pointerEvents:"none", zIndex:-1 } : {}),
        }}
      />

      {/* Block actions — only on hover/focus, NOT permanently */}
      <div className="doc-block-actions">
        {index > 0       && <button title="Move up"    onMouseDown={e => { e.preventDefault(); onMoveUp(block.id); }}>↑</button>}
        {index < total-1 && <button title="Move down"  onMouseDown={e => { e.preventDefault(); onMoveDown(block.id); }}>↓</button>}
        <button title="Delete block" onMouseDown={e => { e.preventDefault(); onDelete(block.id, "up"); }}>🗑</button>
      </div>
    </Wrapper>
  );
}

// ═══════════════════════════════════════════════════════
// BLOCK EDITOR
// ═══════════════════════════════════════════════════════
function BlockEditor({ content, onContentChange, allDocs, onOpenDoc, allTasks, onOpenTask, allGoals, docDecisions, wsId, activeDocId, onDecisionCreated }) {
  const [blocks, setBlocks] = useState(() => parseBlocks(content));
  const [focusedId, setFocusedId] = useState(null);
  const blockRefs = useRef({});
  const saveTimer = useRef(null);
  // Track which serialized content we last loaded so we only reload
  // when the doc actually switches, not on every autosave round-trip.
  const loadedContent = useRef(content);

  useEffect(() => {
    if (content !== loadedContent.current) {
      loadedContent.current = content;
      setBlocks(parseBlocks(content));
    }
  }, [content]);

  // Propagate to parent with debounce
  const push = useCallback((newBlocks) => {
    setBlocks(newBlocks);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => onContentChange(serializeBlocks(newBlocks)), 500);
  }, [onContentChange]);

  const update  = useCallback((updated) => push(blocks.map(b => b.id === updated.id ? updated : b)), [blocks, push]);

  const focusBlock = useCallback((id) => {
    setFocusedId(id);
    // Try immediately, then retry — React needs a tick to mount the new block
    const tryFocus = (attempts = 0) => {
      const el = blockRefs.current[id];
      if (el) {
        el.focus();
        try {
          const r = document.createRange();
          r.selectNodeContents(el);
          r.collapse(false);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
        } catch { /* selection API can throw on detached/empty nodes — ignore */ }
      } else if (attempts < 10) {
        setTimeout(() => tryFocus(attempts + 1), 20);
      }
    };
    tryFocus();
  }, []);

  const addAfter = useCallback((id, type) => {
    const idx = blocks.findIndex(b => b.id === id);
    const nb  = newBlock(type);
    const next = [...blocks];
    next.splice(idx + 1, 0, nb);
    push(next);
    // Focus after React renders the new block
    setTimeout(() => focusBlock(nb.id), 16);
  }, [blocks, push, focusBlock]);

  // Insert several fully-formed blocks (type + content) after a given
  // block in one atomic update — used by multi-line paste, where each
  // resulting block already carries its own text. addAfter() above only
  // creates one empty block at a time and reads from the same `blocks`
  // closure per call, so calling it in a tight loop for several blocks
  // would silently drop all but the last insertion.
  const addMultipleAfter = useCallback((id, newBlocksData) => {
    const idx = blocks.findIndex(b => b.id === id);
    const nbs = newBlocksData.map(nb => newBlock(nb.type, nb.content));
    const next = [...blocks];
    next.splice(idx + 1, 0, ...nbs);
    push(next);
    if (nbs.length) setTimeout(() => focusBlock(nbs[nbs.length - 1].id), 16);
  }, [blocks, push, focusBlock]);

  const del = useCallback((id, direction) => {
    const idx = blocks.findIndex(b => b.id === id);
    const next = blocks.filter(b => b.id !== id);
    if (next.length === 0) { const nb = newBlock(); push([nb]); setFocusedId(nb.id); return; }
    push(next);
    const target = direction === "up" ? next[Math.max(0, idx-1)] : next[Math.min(idx, next.length-1)];
    if (target) { setFocusedId(target.id); setTimeout(() => focusBlock(target.id), 20); }
  }, [blocks, push, focusBlock]);

  const moveUp   = useCallback((id) => { const i = blocks.findIndex(b=>b.id===id); if (i===0) return; const n=[...blocks]; [n[i-1],n[i]]=[n[i],n[i-1]]; push(n); }, [blocks, push]);
  const moveDown = useCallback((id) => { const i = blocks.findIndex(b=>b.id===id); if (i===blocks.length-1) return; const n=[...blocks]; [n[i],n[i+1]]=[n[i+1],n[i]]; push(n); }, [blocks, push]);

  const addBlock = () => { const nb = newBlock(); push([...blocks, nb]); setTimeout(() => { blockRefs.current[nb.id]?.focus(); setFocusedId(nb.id); }, 30); };

  return (
    <div className="doc-editor" onClick={e => { if (e.target === e.currentTarget) addBlock(); }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (e => { if (e.target === e.currentTarget) addBlock(); })?.(e); } }}>
      {blocks.map((block, idx) => (
        <BlockRow
          key={block.id}
          block={block}
          index={idx}
          total={blocks.length}
          focused={focusedId === block.id}
          onFocus={setFocusedId}
          onChange={update}
          onDelete={del}
          onAddAfter={addAfter}
          onAddMultipleAfter={addMultipleAfter}
          onMoveUp={moveUp}
          onMoveDown={moveDown}
          onRegisterRef={(id, el) => { blockRefs.current[id] = el; }}
          allDocs={allDocs}
          onOpenDoc={onOpenDoc}
          allTasks={allTasks}
          onOpenTask={onOpenTask}
          allGoals={allGoals}
          docDecisions={docDecisions}
          wsId={wsId}
          activeDocId={activeDocId}
          onDecisionCreated={onDecisionCreated}
        />
      ))}
      <div className="doc-add-block" onClick={addBlock} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (addBlock)?.(e); } }}>+ Click to add block</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// TEMPLATES
// ═══════════════════════════════════════════════════════
const TEMPLATES = [
  {
    key:"blank", emoji:"📄", label:"Blank page",
    blocks: () => [newBlock("paragraph")],
  },
  {
    key:"prd", emoji:"📋", label:"Product Requirements Doc",
    blocks: () => [
      newBlock("heading1","Product Requirements Document"),
      newBlock("heading2","Overview"),
      newBlock("paragraph","What are we building and why?"),
      newBlock("heading2","Goals"),
      newBlock("bulletList","Primary goal"),
      newBlock("bulletList","Secondary goal"),
      newBlock("heading2","User Stories"),
      newBlock("bulletList","As a [user], I want to [action] so that [benefit]"),
      newBlock("heading2","Acceptance Criteria"),
      newBlock("numberedList","Criterion 1"),
      newBlock("numberedList","Criterion 2"),
      newBlock("heading2","Out of Scope"),
      newBlock("paragraph",""),
      newBlock("heading2","Open Questions"),
      newBlock("todo","Question 1"),
    ],
  },
  {
    key:"meeting", emoji:"📝", label:"Meeting Notes",
    blocks: () => [
      newBlock("heading1","Meeting Notes"),
      newBlock("paragraph",`📅 ${new Date().toLocaleDateString("en-GB",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}`),
      newBlock("heading2","Attendees"),
      newBlock("bulletList",""),
      newBlock("heading2","Agenda"),
      newBlock("numberedList",""),
      newBlock("heading2","Notes"),
      newBlock("paragraph",""),
      newBlock("heading2","Decisions"),
      newBlock("callout","Key decisions made in this meeting"),
      newBlock("heading2","Action Items"),
      newBlock("todo",""),
      newBlock("todo",""),
    ],
  },
  {
    key:"retro", emoji:"🔄", label:"Retrospective",
    blocks: () => [
      newBlock("heading1","Sprint Retrospective"),
      newBlock("paragraph",`Sprint — ${new Date().toLocaleDateString()}`),
      newBlock("heading2","✅ What went well"),
      newBlock("bulletList",""),
      newBlock("heading2","⚠️ What to improve"),
      newBlock("bulletList",""),
      newBlock("heading2","💡 Ideas"),
      newBlock("bulletList",""),
      newBlock("heading2","🎯 Action items"),
      newBlock("todo",""),
    ],
  },
  {
    key:"okr", emoji:"🎯", label:"OKR Review",
    blocks: () => {
      const q = Math.ceil((new Date().getMonth()+1)/3);
      return [
        newBlock("heading1",`OKR Review — Q${q} ${new Date().getFullYear()}`),
        newBlock("heading2","Objective"),
        newBlock("paragraph",""),
        newBlock("heading2","Key Results"),
        newBlock("bulletList","KR1: "),
        newBlock("bulletList","KR2: "),
        newBlock("bulletList","KR3: "),
        newBlock("heading2","Progress Notes"),
        newBlock("paragraph",""),
        newBlock("heading2","Blockers"),
        newBlock("callout",""),
        newBlock("heading2","Next Steps"),
        newBlock("todo",""),
      ];
    },
  },
  {
    key:"sop", emoji:"📖", label:"SOP",
    blocks: () => [
      newBlock("heading1","Standard Operating Procedure"),
      newBlock("callout","Version 1.0 — Status: Draft"),
      newBlock("heading2","Purpose"),
      newBlock("paragraph",""),
      newBlock("heading2","Scope"),
      newBlock("paragraph",""),
      newBlock("heading2","Prerequisites"),
      newBlock("bulletList",""),
      newBlock("heading2","Steps"),
      newBlock("numberedList","Step 1"),
      newBlock("numberedList","Step 2"),
      newBlock("heading2","Exceptions & Notes"),
      newBlock("quote",""),
    ],
  },
];

function TemplatePicker({ onSelect, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (onClose)?.(e); } }}>
      <div className="doc-tpl-modal" onClick={e => e.stopPropagation()} role="presentation">
        <div className="doc-tpl-modal-header">
          <h2>New page</h2>
          <button className="doc-tpl-close" onClick={onClose}>✕</button>
        </div>
        <p className="doc-tpl-sub">Start from a template or blank page</p>
        <div className="doc-tpl-grid">
          {TEMPLATES.map(t => (
            <button key={t.key} className="doc-tpl-card" onClick={() => onSelect(t)}>
              <span className="doc-tpl-emoji">{t.emoji}</span>
              <span style={{
                fontSize:"11px", fontWeight:600, lineHeight:1.3,
                wordBreak:"break-word", overflowWrap:"break-word",
                whiteSpace:"normal", display:"block", width:"100%",
                textAlign:"center",
              }}>{t.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// DOC TREE
// ═══════════════════════════════════════════════════════
function buildTree(docs) {
  const byId = {};
  docs.forEach(d => (byId[d.id] = { ...d, children: [] }));
  const roots = [];
  docs.forEach(d => {
    if (d.parentId && byId[d.parentId]) byId[d.parentId].children.push(byId[d.id]);
    else roots.push(byId[d.id]);
  });
  return roots;
}

function TreeNode({ node, depth, activeId, onOpen, onNew, onDelete, onRename }) {
  const [open, setOpen] = useState(depth < 1);
  const hasKids = node.children?.length > 0;
  const isActive = node.id === activeId;

  return (
    <div>
      <div className="doc-tree-item-row" style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => onOpen(node)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => onOpen(node))?.(e); } }}>
        {/* Top row: chevron + icon + name */}
        <div className="doc-tree-item-top">
          <button className="doc-tree-chevron-btn"
            onClick={e => { e.stopPropagation(); setOpen(v=>!v); }}>
            {hasKids ? (open ? "▾" : "▸") : ""}
          </button>
          <span className="doc-tree-item-icon">{node.emoji || "📄"}</span>
          <span className={`doc-tree-item-name${isActive ? " active" : ""}`}>
            {node.title || "Untitled"}
          </span>
        </div>
        {/* Action buttons shown below on hover */}
        <div className="doc-tree-item-actions" onClick={e => e.stopPropagation()} role="presentation">
          <button onClick={e => { e.stopPropagation(); onNew(node.id); }}>+ Sub-page</button>
          <button onClick={e => { e.stopPropagation(); onRename(node); }}>✎ Rename</button>
          <button className="delete" onClick={e => { e.stopPropagation(); onDelete(node); }}>✕ Delete</button>
        </div>
      </div>
      {open && hasKids && node.children.map(c => (
        <TreeNode key={c.id} node={c} depth={depth+1} activeId={activeId}
          onOpen={onOpen} onNew={onNew} onDelete={onDelete} onRename={onRename} />
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// FORMAT TOOLBAR
// ═══════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════
// SLASH COMMAND LEGEND
// ═══════════════════════════════════════════════════════
const LEGEND_GROUPS = [
  {
    label: "Text & Structure",
    items: [
      { cmd:"/text",    icon:"¶",    label:"Text",          desc:"Plain paragraph" },
      { cmd:"/h1",      icon:"H1",   label:"Heading 1",     desc:"Large title" },
      { cmd:"/h2",      icon:"H2",   label:"Heading 2",     desc:"Medium title" },
      { cmd:"/h3",      icon:"H3",   label:"Heading 3",     desc:"Small title" },
      { cmd:"/divider", icon:"—",    label:"Divider",       desc:"Horizontal rule" },
      { cmd:"/quote",   icon:"❝",    label:"Quote",         desc:"Blockquote" },
      { cmd:"/callout", icon:"💡",   label:"Callout",       desc:"Highlighted note" },
    ],
  },
  {
    label: "Lists & Tasks",
    items: [
      { cmd:"/bullet",   icon:"•",   label:"Bullet list",   desc:"Unordered list" },
      { cmd:"/numbered", icon:"1.",  label:"Numbered list", desc:"Ordered list" },
      { cmd:"/todo",     icon:"☐",   label:"To-do",         desc:"Checkbox list" },
    ],
  },
  {
    label: "Code & Media",
    items: [
      { cmd:"/code",    icon:"</>",  label:"Code",          desc:"Code block with syntax" },
      { cmd:"/image",   icon:"🖼",   label:"Image",         desc:"Embed image from URL" },
      { cmd:"/youtube", icon:"▶",    label:"YouTube",       desc:"Embed YouTube video" },
      { cmd:"/figma",   icon:"✦",    label:"Figma",         desc:"Embed Figma design" },
      { cmd:"/loom",    icon:"⏺",    label:"Loom",          desc:"Embed Loom recording" },
      { cmd:"/iframe",  icon:"⊞",    label:"Embed URL",     desc:"Any website or tool" },
    ],
  },
  {
    label: "Workspace & AI",
    items: [
      { cmd:"/task",     icon:"✅",  label:"Task embed",    desc:"Embed a workspace task" },
      { cmd:"/goal",     icon:"🎯",  label:"Goal embed",    desc:"Embed a goal with progress" },
      { cmd:"/decision", icon:"⚖️",  label:"Decision",      desc:"Decision record" },
      { cmd:"/ai",       icon:"🤖",  label:"AI Write",      desc:"Generate content with AI" },
    ],
  },
];

function SlashCommandLegend({ onClose }) {
  return (
    <div className="slash-legend-overlay" onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (onClose)?.(e); } }}>
      <div className="slash-legend-panel" onClick={e => e.stopPropagation()} role="presentation">
        <div className="slash-legend-header">
          <div className="slash-legend-title">
            <kbd>/</kbd> Slash Commands
          </div>
          <div className="slash-legend-subtitle">
            Type <kbd>/</kbd> anywhere in the editor to insert any block
          </div>
          <button className="slash-legend-close" onClick={onClose}>✕</button>
        </div>
        <div className="slash-legend-body">
          {LEGEND_GROUPS.map(group => (
            <div key={group.label} className="slash-legend-group">
              <div className="slash-legend-group-label">{group.label}</div>
              <div className="slash-legend-items">
                {group.items.map(item => (
                  <div key={item.cmd} className="slash-legend-item">
                    <div className="slash-legend-icon">{item.icon}</div>
                    <div className="slash-legend-info">
                      <div className="slash-legend-item-label">{item.label}</div>
                      <div className="slash-legend-item-desc">{item.desc}</div>
                    </div>
                    <kbd className="slash-legend-cmd">{item.cmd}</kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FormatBar({ showLegend, onToggleLegend }) {
  const cmd = (c, v) => { document.execCommand(c, false, v ?? undefined); };
  return (
    <div className="doc-format-bar">
      <button onMouseDown={e => { e.preventDefault(); cmd("bold"); }}          title="Bold (⌘B)"><strong>B</strong></button>
      <button onMouseDown={e => { e.preventDefault(); cmd("italic"); }}        title="Italic (⌘I)"><em>I</em></button>
      <button onMouseDown={e => { e.preventDefault(); cmd("underline"); }}     title="Underline (⌘U)"><u>U</u></button>
      <button onMouseDown={e => { e.preventDefault(); cmd("strikeThrough"); }} title="Strike"><s>S</s></button>
      <div className="doc-format-sep" />
      <button onMouseDown={e => { e.preventDefault(); cmd("insertUnorderedList"); }} title="Bullet list">• List</button>
      <button onMouseDown={e => { e.preventDefault(); cmd("insertOrderedList"); }}   title="Numbered list">1. List</button>
      <div className="doc-format-sep" />
      <button onMouseDown={e => {
        e.preventDefault();
        const url = prompt("Link URL:");
        if (url) cmd("createLink", url);
      }} title="Link">🔗</button>
      <div className="doc-format-sep" />
      <button
        className={`doc-format-legend-btn${showLegend ? " active" : ""}`}
        onMouseDown={e => { e.preventDefault(); onToggleLegend(); }}
        title="Show all slash commands">
        <kbd>/</kbd> Commands
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// BREADCRUMB
// ═══════════════════════════════════════════════════════
function DocBreadcrumb({ doc, allDocs, onNavigate }) {
  const path = [];
  let cur = doc;
  while (cur) {
    path.unshift(cur);
    cur = allDocs.find(d => d.id === cur.parentId);
  }
  return (
    <nav className="doc-breadcrumb">
      <button className="doc-bc-root" onClick={() => onNavigate(null)}>📚 Docs</button>
      {path.map(d => (
        <span key={d.id} className="doc-bc-seg">
          <span className="doc-bc-sep">/</span>
          <button className="doc-bc-item" onClick={() => onNavigate(d)}>{d.emoji} {d.title || "Untitled"}</button>
        </span>
      ))}
    </nav>
  );
}

// ═══════════════════════════════════════════════════════
// EMOJI PICKER
// ═══════════════════════════════════════════════════════
const EMOJIS = "📄📋📝📖🗒️📓📔📒📕📗📘📙📚📃📜🗂️🗃️💡🎯🚀⚡🔥✅❌⚠️🔍🔒🏆💰🤖🌐📊📈🎨🛠️📌📎🔖💬🗣️💻🖥️🖱️⌨️🖨️📡🛡️🔐🧪🔬🧬🌿🌱🌍🏗️🏢🏦".split(/(?<=\p{Emoji_Presentation}|\p{Emoji}\uFE0F)/u).filter(Boolean);

function EmojiPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position:"relative", display:"inline-block" }}>
      <button className="doc-emoji-btn" onClick={() => setOpen(v => !v)} title="Change icon">{value || "📄"}</button>
      {open && (
        <div className="doc-emoji-picker">
          {EMOJIS.map(em => (
            <button key={em} onClick={() => { onChange(em); setOpen(false); }}>{em}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// WORD COUNT
// ═══════════════════════════════════════════════════════
function wordCount(content) {
  if (!content) return 0;
  try {
    const blocks = JSON.parse(content);
    return blocks.map(b => b.content || "").join(" ").trim().split(/\s+/).filter(Boolean).length;
  } catch { return 0; }
}


// ═══════════════════════════════════════════════════════
// DIFF HELPER — simple word-level diff for version view
// Returns array of { text, type: "same"|"added"|"removed" }
// ═══════════════════════════════════════════════════════
function diffWords(oldText, newText) {
  if (!oldText && !newText) return [];
  if (!oldText) return [{ text: newText, type: "added" }];
  if (!newText) return [{ text: oldText, type: "removed" }];

  const oldWords = oldText.split(/\s+/);
  const newWords = newText.split(/\s+/);
  // Simple LCS-based word diff (O(n²) — acceptable for doc preview)
  const m = oldWords.length, n = newWords.length;
  const dp = Array.from({length: m+1}, () => new Array(n+1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = oldWords[i-1] === newWords[j-1]
        ? dp[i-1][j-1] + 1
        : Math.max(dp[i-1][j], dp[i][j-1]);

  let i = m, j = n;
  const ops = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldWords[i-1] === newWords[j-1]) {
      ops.unshift({ text: oldWords[i-1], type: "same" }); i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
      ops.unshift({ text: newWords[j-1], type: "added" }); j--;
    } else {
      ops.unshift({ text: oldWords[i-1], type: "removed" }); i--;
    }
  }
  return ops;
}

function extractText(content) {
  if (!content) return "";
  try {
    const blocks = JSON.parse(content);
    return blocks.map(b => b.content || "").join(" ").trim();
  } catch { return content; }
}

// ═══════════════════════════════════════════════════════
// VERSION HISTORY PANEL
// ═══════════════════════════════════════════════════════
function VersionHistoryPanel({ versions, loading, restoringVersion, activeDoc, currentContent, onRestore, onClose }) {
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [showDiff, setShowDiff] = useState(false);

  const diffResult = useMemo(() => {
    if (!selectedVersion || !showDiff) return null;
    const oldText = extractText(selectedVersion.content);
    const newText = extractText(currentContent);
    return diffWords(oldText, newText);
  }, [selectedVersion, showDiff, currentContent]);

  const formatDate = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleDateString([], { day:"numeric", month:"short", year:"numeric" })
      + " " + d.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
  };

  return (
    <div className="doc-vh-overlay" onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (onClose)?.(e); } }}>
      <div className="doc-vh-panel" onClick={e => e.stopPropagation()} role="presentation">

        {/* Header */}
        <div className="doc-vh-header">
          <div className="doc-vh-header-left">
            <span className="doc-vh-title">🕐 Version history</span>
            <span className="doc-vh-doc-name">{activeDoc?.emoji} {activeDoc?.title || "Untitled"}</span>
          </div>
          <button className="doc-vh-close" onClick={onClose}>✕</button>
        </div>

        <div className="doc-vh-body">
          {/* Version list */}
          <div className="doc-vh-list">
            {loading && <div className="doc-vh-loading">Loading versions…</div>}
            {!loading && versions.length === 0 && (
              <div className="doc-vh-empty">
                <div style={{fontSize:32,marginBottom:8}}>📋</div>
                <div>No version history yet.</div>
                <div style={{fontSize:12,marginTop:4,opacity:.7}}>Versions are saved automatically as you edit.</div>
              </div>
            )}
            {versions.map(v => (
              <div
                key={v.id}
                className={`doc-vh-item${selectedVersion?.id === v.id ? " doc-vh-item--active" : ""}`}
                onClick={() => { setSelectedVersion(v); setShowDiff(false); }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => { setSelectedVersion(v); setShowDiff(false); })?.(e); } }}
              >
                <div className="doc-vh-item-top">
                  <span className="doc-vh-version-num">v{v.versionNumber}</span>
                  <span className="doc-vh-label">{v.changeLabel || "Auto-save"}</span>
                </div>
                <div className="doc-vh-item-meta">
                  <span className="doc-vh-date">{formatDate(v.createdAt)}</span>
                  {v.savedBy && v.savedBy !== "anonymous" && (
                    <span className="doc-vh-author">by {v.savedBy.split("@")[0]}</span>
                  )}
                  <span className="doc-vh-words">{v.wordCount} words</span>
                </div>
                {selectedVersion?.id === v.id && (
                  <div className="doc-vh-item-actions">
                    <button
                      className="doc-vh-btn-diff"
                      onClick={e => { e.stopPropagation(); setShowDiff(d => !d); }}
                    >
                      {showDiff ? "Hide diff" : "View diff"}
                    </button>
                    <button
                      className="doc-vh-btn-restore"
                      disabled={restoringVersion === v.versionNumber}
                      onClick={e => { e.stopPropagation(); onRestore(v.versionNumber); }}
                    >
                      {restoringVersion === v.versionNumber ? "⏳ Restoring…" : "↩ Restore"}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Diff / preview pane */}
          {selectedVersion && (
            <div className="doc-vh-preview">
              <div className="doc-vh-preview-header">
                <span>v{selectedVersion.versionNumber} — {selectedVersion.emoji} {selectedVersion.title}</span>
                <span className="doc-vh-preview-words">{selectedVersion.wordCount} words</span>
              </div>

              {showDiff && diffResult ? (
                <div className="doc-vh-diff">
                  <div className="doc-vh-diff-legend">
                    <span className="doc-vh-diff-added">+ Added</span>
                    <span className="doc-vh-diff-removed">- Removed</span>
                    <span className="doc-vh-diff-same">Unchanged</span>
                    <span className="doc-vh-diff-note">(comparing v{selectedVersion.versionNumber} → current)</span>
                  </div>
                  <div className="doc-vh-diff-text">
                    {diffResult.map((op, i) => (
                      <span key={i} className={`doc-vh-diff-${op.type}`}>{op.text} </span>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="doc-vh-preview-content">
                  {(() => {
                    try {
                      const blocks = JSON.parse(selectedVersion.content || "[]");
                      return blocks.map((b, i) => (
                        <div key={i} className={`doc-vh-block doc-vh-block--${b.type}`}>
                          {b.type === "divider" ? <hr /> : (b.content || "")}
                        </div>
                      ));
                    } catch { return <div>{selectedVersion.content}</div>; }
                  })()}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════
export default function Docs() {
  const { activeWorkspace, user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [sp, setSp] = useSearchParams();
  const wsId = activeWorkspace?.id;

  const [allDocs, setAllDocs]           = useState([]);
  const [allTasks, setAllTasks]         = useState([]);
  const [allGoals, setAllGoals]         = useState([]);
  const [tree, setTree]                 = useState([]);
  const [activeDoc, setActiveDoc]       = useState(null);
  const [title, setTitle]               = useState("");
  const [emoji, setEmoji]               = useState("📄");
  const [content, setContent]           = useState("[]");
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [savedAt, setSavedAt]           = useState(null);
  const [searchQ, setSearchQ]           = useState("");
  const [searchRes, setSearchRes]       = useState(null);
  const [sidebarOpen, setSidebarOpen]   = useState(true);
  const [showTpl, setShowTpl]           = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [docDecisions, setDocDecisions]   = useState([]);
  const [showPublish, setShowPublish]   = useState(false);
  const [showDocAccess, setShowDocAccess] = useState(false);
  const { enabled: accessEnabled } = useAccess();
  const [showTagPanel, setShowTagPanel] = useState(false);
  const [showSlashLegend, setShowSlashLegend] = useState(false);

  // A-9: Collaborative editing
  const {
    isConnected: collabConnected,
    collaborators,
    incomingEdit,
    sendEdit,
  } = useDocCollab(activeDoc?.id || null, user?.email || user?.name || "");
  const [versions, setVersions]         = useState([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [restoringVersion, setRestoringVersion] = useState(null);

  const saveTimer  = useRef(null);
  const titleTimer = useRef(null);

  // A-9: Apply remote edit — update content state AND force BlockEditor remount
  // via collabKey so its internal blocks state is guaranteed to reset with fresh content
  const [collabKey, setCollabKey] = useState(0);
  const [showInlineComments, setShowInlineComments] = useState(false);
  useEffect(() => {
    if (!incomingEdit?.content) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- applies an incoming real-time collab edit when it arrives
    setContent(incomingEdit.content);
    setCollabKey(k => k + 1); // force BlockEditor remount with new content
  }, [incomingEdit]);

  // ── load docs ──────────────────────────────────────────
  // Load tasks for task-embed blocks
  useEffect(() => {
    getTasks().then(r => {
      const list = Array.isArray(r.data) ? r.data : (r.data?.data ?? []);
      setAllTasks(list);
    }).catch(() => {});
  }, [wsId]);

  // Load goals for goal-embed blocks (A-13)
  useEffect(() => {
    if (!wsId) return;
    import("../api/goals").then(({ getGoals }) => {
      getGoals().then(r => {
        const list = Array.isArray(r.data) ? r.data : (r.data?.data ?? []);
        setAllGoals(list);
      }).catch(() => {});
    });
  }, [wsId]);

  // ── open doc ────────────────────────────────────────────
  const openDoc = useCallback((doc, pushUrl = true) => {
    setActiveDoc(doc);
    setTitle(doc.title  || "");
    setEmoji(doc.emoji  || "📄");
    setContent(doc.content || "[]");
    setSavedAt(null);
    if (pushUrl) setSp({ id: doc.id });
    setSearchRes(null);
    setSearchQ("");
    // Load decisions linked to this doc
    if (doc.id && doc.id !== "__demo__") {
      getDecisionsByDoc(doc.id)
        .then(r => setDocDecisions(Array.isArray(r.data?.data) ? r.data.data : Array.isArray(r.data) ? r.data : []))
        .catch(() => setDocDecisions([]));
    }
  }, [setSp]);

  const loadDocs = useCallback(async () => {
    if (!wsId) return;
    setLoading(true);
    try {
      const r = await getDocs(wsId);
      const list = r.data?.data ?? r.data ?? [];
      const normalized = Array.isArray(list) ? list : [];
      setAllDocs(normalized);
      setTree(buildTree(normalized));
      // Open from URL param, or auto-open first doc if none selected
      const urlId = sp.get("id");
      if (urlId) {
        const found = normalized.find(d => d.id === urlId);
        if (found) { openDoc(found, false); return; }
      }
      // No URL id — auto-open first root-level doc
      if (normalized.length > 0) {
        const first = normalized.find(d => !d.parentId) || normalized[0];
        openDoc(first, true);
      }
    } catch {
      // Backend not up yet – seed demo doc so editor is usable
      const demo = {
        id:"__demo__", title:"Getting Started", emoji:"👋", parentId:null, workspaceId:wsId,
        content: serializeBlocks([
          newBlock("heading1","Welcome to Prowosma Docs 👋"),
          newBlock("paragraph","This is your team's knowledge base. Write anything here."),
          newBlock("heading2","What you can do"),
          newBlock("bulletList","Type / to open the block command menu"),
          newBlock("bulletList","Use Ctrl+B for bold, Ctrl+I for italic"),
          newBlock("bulletList","Press Enter to create a new block"),
          newBlock("bulletList","Backspace on an empty block to delete it"),
          newBlock("heading2","Block types"),
          newBlock("callout","💡 Tip — Headings, bullet lists, numbered lists, to-dos, quotes, code blocks, callouts, images, and dividers"),
          newBlock("heading2","Getting started"),
          newBlock("todo","Create your first real page using + New page"),
          newBlock("todo","Try the PRD template"),
          newBlock("todo","Invite a team member and share a doc"),
        ])
      };
      setAllDocs([demo]);
      setTree([demo]);
      openDoc(demo, false);
    } finally { setLoading(false); }
    // sp is read fresh inside via sp.get("id") at call-time by design;
    // it isn't meant to be a reload trigger — only wsId/openDoc are.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId, openDoc]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard load-on-mount pattern
  useEffect(() => { loadDocs(); }, [loadDocs]);

  // ── auto-save helper ────────────────────────────────────
  const persist = useCallback(async (id, payload) => {
    if (!id || id === "__demo__") return;
    setSaving(true);
    try {
      await updateDoc(id, payload);
      setSavedAt(new Date());
      setAllDocs(prev => {
        const next = prev.map(d => d.id === id ? { ...d, ...payload } : d);
        setTree(buildTree(next));
        return next;
      });
    } catch { toast?.show("Save failed", "error"); }
    finally { setSaving(false); }
  }, [toast]);

  // ── title change ────────────────────────────────────────
  const handleTitle = (val) => {
    setTitle(val);
    if (!activeDoc) return;
    clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => persist(activeDoc.id, { title: val, emoji, content }), 700);
  };

  // ── emoji change ────────────────────────────────────────
  const handleEmoji = (em) => {
    setEmoji(em);
    if (!activeDoc) return;
    persist(activeDoc.id, { title, emoji: em, content });
  };

  // ── content change ──────────────────────────────────────
  const handleContent = useCallback((val) => {
    setContent(val);
    if (!activeDoc) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(activeDoc.id, { title, emoji, content: val }), 900);
    // A-9: Broadcast raw blocks JSON string to all other tabs
    sendEdit(val);
  }, [activeDoc, title, emoji, persist, sendEdit]);

  // ── create doc ──────────────────────────────────────────
  const createNewDoc = async (parentId, tpl) => {
    if (!wsId) return;
    const template = tpl || TEMPLATES[0];
    const payload  = {
      workspaceId: wsId,
      parentId:    parentId || null,
      title:       template.label === "Blank page" ? "Untitled" : template.label,
      emoji:       template.emoji,
      content:     serializeBlocks(template.blocks()),
    };
    setShowTpl(false);
    try {
      const r   = await createDoc(payload);
      const doc = r.data?.data ?? r.data;
      if (doc?.id) {
        setAllDocs(prev => { const next = [...prev, doc]; setTree(buildTree(next)); return next; });
        openDoc(doc);
        toast?.show("Page created", "success");
      }
    } catch {
      // offline fallback; catch block of a click-triggered save handler, not render
      // eslint-disable-next-line react-hooks/purity
      const fake = { ...payload, id:`local_${Date.now()}` };
      setAllDocs(prev => { const next = [...prev, fake]; setTree(buildTree(next)); return next; });
      openDoc(fake);
    }
  };

  // ── delete doc ──────────────────────────────────────────
  const handleDelete = async (doc) => {
    if (!(await confirm({ title: `Delete "${doc.title || "Untitled"}"?`, message: "This cannot be undone.", danger: true, confirmText: "Delete" }))) return;
    if (doc.id !== "__demo__") {
      try { await deleteDoc(doc.id); }
      catch { toast?.show("Failed to delete page", "error"); return; }
    }
    setAllDocs(prev => { const next = prev.filter(d => d.id !== doc.id); setTree(buildTree(next)); return next; });
    if (activeDoc?.id === doc.id) { setActiveDoc(null); setSp({}); }
    toast?.show("Page deleted", "success");
  };

  // ── rename doc ──────────────────────────────────────────
  const handleRename = async (doc) => {
    const n = prompt("Rename page:", doc.title || "");
    if (!n || n === doc.title) return;
    if (doc.id !== "__demo__") {
      try { await updateDoc(doc.id, { title: n }); }
      catch { toast?.show("Failed to rename page", "error"); return; }
    }
    setAllDocs(prev => { const next = prev.map(d => d.id === doc.id ? { ...d, title: n } : d); setTree(buildTree(next)); return next; });
    if (activeDoc?.id === doc.id) setTitle(n);
  };

  // ── search ──────────────────────────────────────────────
  const loadVersions = async (docId) => {
    setVersionsLoading(true);
    try {
      const r = await getDocVersions(docId);
      const list = r.data?.data ?? r.data ?? [];
      setVersions(Array.isArray(list) ? list : []);
    } catch { setVersions([]); }
    finally { setVersionsLoading(false); }
  };

  const handleShowVersions = () => {
    if (!activeDoc) return;
    setShowVersions(true);
    loadVersions(activeDoc.id);
  };

  const handleRestoreVersion = async (versionNumber) => {
    if (!activeDoc) return;
    if (!(await confirm({ title: `Restore to version ${versionNumber}?`, message: "Current content will be replaced.", confirmText: "Restore" }))) return;
    setRestoringVersion(versionNumber);
    try {
      const r = await restoreVersion(activeDoc.id, versionNumber);
      const doc = r.data?.data ?? r.data;
      if (doc) {
        setContent(doc.content || "[]");
        setTitle(doc.title || "");
        setEmoji(doc.emoji || "📄");
        setAllDocs(prev => { const next = prev.map(d => d.id === doc.id ? doc : d); setTree(buildTree(next)); return next; });
        setSavedAt(new Date());
        toast?.show(`Restored to version ${versionNumber}`, "success");
        setShowVersions(false);
        // Reload versions list
        loadVersions(activeDoc.id);
      }
    } catch { toast?.show("Restore failed", "error"); }
    finally { setRestoringVersion(null); }
  };

  const handleOpenTask = (task) => {
    // Open tasks page with the task highlighted
    window.location.href = `/tasks?highlight=${task.id}`;
  };

  const handleSearch = async (q) => {
    setSearchQ(q);
    if (!q.trim()) { setSearchRes(null); return; }
    // client-side fallback search
    const local = allDocs.filter(d => d.title?.toLowerCase().includes(q.toLowerCase()));
    setSearchRes(local);
    try {
      const r = await searchDocs(q, wsId);
      const res = r.data?.data ?? r.data ?? [];
      setSearchRes(Array.isArray(res) ? res : local);
    } catch { /* search is best-effort — local results already shown */ }
  };

  const wc = wordCount(content);
  const saveLabel = saving ? "⏳ Saving…" : savedAt ? `✓ Saved ${savedAt.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}` : activeDoc ? "● Unsaved" : "";

  // ── render ──────────────────────────────────────────────
  if (loading) return (
    <div className="docs-loading">
      <div className="docs-spinner" />
      <span>Loading knowledge base…</span>
    </div>
  );

  return (
    <div className="docs-page">

      {/* ── SIDEBAR ─────────────────────────────────── */}
      <aside className={`docs-sidebar${sidebarOpen ? "" : " docs-sidebar--closed"}`}>
        <div className="docs-sb-header">
          {sidebarOpen && <span className="docs-sb-title">📚 Docs</span>}
          <button className="docs-sb-toggle" onClick={() => setSidebarOpen(v=>!v)} title="Toggle sidebar">
            {sidebarOpen ? "‹" : "›"}
          </button>
        </div>

        {sidebarOpen && (
          <>
            <div className="docs-sb-search-wrap">
              <input
                className="docs-sb-search"
                placeholder="Search pages…"
                value={searchQ}
                onChange={e => handleSearch(e.target.value)}
              />
            </div>

            <button className="docs-new-page-btn" onClick={() => setShowTpl(true)}>
              + New page
            </button>

            {/* Search results */}
            {searchRes !== null ? (
              <div className="docs-tree">
                <div className="docs-tree-label">Results ({searchRes.length})</div>
                {searchRes.length === 0
                  ? <div className="docs-tree-empty">No pages found</div>
                  : searchRes.map(d => (
                      <button key={d.id}
                        className={`docs-search-row${activeDoc?.id === d.id ? " active" : ""}`}
                        onClick={() => openDoc(d)}>
                        {d.emoji || "📄"} {d.title || "Untitled"}
                      </button>
                    ))
                }
              </div>
            ) : (
              <div className="docs-tree">
                <div className="docs-tree-label">Pages</div>
                {tree.length === 0
                  ? <div className="docs-tree-empty">No pages yet.<br/>Click + New page.</div>
                  : tree.map(node => (
                      <TreeNode key={node.id} node={node} depth={0}
                        activeId={activeDoc?.id}
                        onOpen={openDoc}
                        onNew={pid => createNewDoc(pid, TEMPLATES[0])}
                        onDelete={handleDelete}
                        onRename={handleRename}
                      />
                    ))
                }
              </div>
            )}
          </>
        )}
      </aside>

      {/* ── EDITOR ──────────────────────────────────── */}
      <main className="docs-main">
        {activeDoc ? (
          <>
            <div className="docs-editor-wrap">

              {/* Top bar */}
              <div className="docs-topbar">
                <DocBreadcrumb doc={activeDoc} allDocs={allDocs} onNavigate={d => d ? openDoc(d) : setActiveDoc(null)} />
                <div className="docs-topbar-right">
                  <span className="docs-wc">{wc} {wc === 1 ? "word" : "words"}</span>
                  <span className={`docs-save-label${saving ? " saving" : savedAt ? " saved" : ""}`}>{saveLabel}</span>

                  {/* A-9: Collaborator presence avatars */}
                  {collaborators.length > 0 && (
                    <div className="collab-presence-bar">
                      {collaborators.slice(0, 5).map(c => (
                        <div key={c.sessionId}
                          className="collab-avatar"
                          title={`${c.user} is editing${c.blockId ? " block " + c.blockId.slice(0,8) : ""}`}
                          style={{ background: c.color, borderColor: c.color, position:"relative" }}>
                          {(c.user || "?").slice(0, 2).toUpperCase()}
                          {c.blockId && (
                            <span style={{position:"absolute",bottom:-14,left:"50%",transform:"translateX(-50%)",
                              fontSize:"8px",fontWeight:700,color:c.color,whiteSpace:"nowrap",
                              background:"#fff",borderRadius:"3px",padding:"1px 3px",
                              border:`1px solid ${c.color}44`,lineHeight:1}}>
                              editing
                            </span>
                          )}
                        </div>
                      ))}
                      {collaborators.length > 5 && (
                        <div className="collab-avatar collab-avatar-more">
                          +{collaborators.length - 5}
                        </div>
                      )}
                    </div>
                  )}
                  {collabConnected && activeDoc && (
                    <div className="collab-status" title="Real-time collaboration active">
                      <span className="collab-status-dot" />
                      Live
                    </div>
                  )}
                  {/* Who can see this doc (departments / sharing), shown once access control is on */}
                  {accessEnabled && activeDoc && activeDoc.id !== "__demo__" && (
                    <button className="docs-history-btn" onClick={() => setShowDocAccess(true)} title="Who can see this document">
                      👥 Access
                    </button>
                  )}
                  {/* A-8: Publish toggle */}
                  <button className={`docs-history-btn${activeDoc?.visibility === "PUBLIC" ? " docs-btn-published" : ""}`}
                    onClick={() => setShowPublish(v => !v)} title="Publish settings">
                    {activeDoc?.visibility === "PUBLIC" ? "🌐 Published" : "🔒 Private"}
                  </button>
                  {/* A-12: Tags button */}
                  <button className="docs-history-btn" onClick={() => setShowTagPanel(v => !v)} title="Tags & category">
                    🏷 Tags
                  </button>

                  {/* Knowledge freshness indicator */}
                  {activeDoc && (() => {
                    const updatedAt = activeDoc.updatedAt ? new Date(activeDoc.updatedAt) : null;
                    if (!updatedAt) return null;
                    // eslint-disable-next-line react-hooks/purity -- display-only "days since" badge, no visible drift
                    const daysSince = Math.floor((Date.now() - updatedAt.getTime()) / 86400000);
                    const isStale = daysSince > 90 || activeDoc.stale;
                    const isAgeing = daysSince > 30;
                    if (!isStale && !isAgeing) return null;
                    return (
                      <button className="docs-history-btn"
                        style={{color:isStale?"var(--danger)":"var(--warning)",
                          background:isStale?"rgba(239,68,68,.08)":"rgba(245,158,11,.08)"}}
                        title={`Last updated ${daysSince} days ago`}
                        onClick={async()=>{
                          await client.patch(`/docs/${activeDoc.id}/freshness`,
                            {stale:false, reviewAt: new Date(Date.now()+90*86400000).toISOString()});
                          toast.show("Doc marked as reviewed. Next review in 90 days.", "success");
                        }}>
                        {isStale ? "⚠️ Stale" : "🕐 Ageing"} ({daysSince}d)
                      </button>
                    );
                  })()}

                  {/* Inline comments toggle */}
                  <button className="docs-history-btn"
                    onClick={() => setShowInlineComments && setShowInlineComments(v => !v)}
                    title="Inline comments">
                    💬 Comments
                    {activeDoc?.inlineComments?.filter(c=>!c.resolved).length > 0 && (
                      <span style={{fontSize:"9px",background:"var(--danger)",color:"#fff",
                        borderRadius:"99px",padding:"1px 5px",marginLeft:"4px"}}>
                        {activeDoc.inlineComments.filter(c=>!c.resolved).length}
                      </span>
                    )}
                  </button>
                  <button className="docs-history-btn" onClick={handleShowVersions} title="Version history">
                    🕐 History
                  </button>
                </div>
              </div>

              {/* Document header */}
              <div className="docs-header">
                <EmojiPicker value={emoji} onChange={handleEmoji} />
                <input
                  className="docs-title"
                  value={title}
                  onChange={e => handleTitle(e.target.value)}
                  placeholder="Untitled"
                  onKeyDown={e => e.key === "Enter" && e.preventDefault()}
                />
              </div>

              {/* A-12: Tag display row — shown below title when tags/category exist */}
              {(activeDoc?.category || activeDoc?.tags?.length > 0) && (
                <div className="doc-tags-row">
                  {activeDoc.category && (
                    <span className="doc-tag-category-chip">{activeDoc.category}</span>
                  )}
                  {activeDoc.tags?.map(t => (
                    <span key={t} className="doc-tag-chip">#{t}</span>
                  ))}
                  <button className="doc-tags-edit-btn" onClick={() => setShowTagPanel(v => !v)}
                    title="Edit tags">✎</button>
                </div>
              )}

              {/* Format toolbar */}
              <FormatBar showLegend={showSlashLegend} onToggleLegend={() => setShowSlashLegend(v => !v)} />

              {/* Block editor */}
              {showSlashLegend && (
                <SlashCommandLegend onClose={() => setShowSlashLegend(false)} />
              )}
              <div className="docs-editor-body">
              <div className="docs-blocks-wrap">
              <BlockEditor key={`editor-${activeDoc?.id}-${collabKey}`} content={content} onContentChange={handleContent} allDocs={allDocs} onOpenDoc={openDoc} allTasks={allTasks} onOpenTask={handleOpenTask} allGoals={allGoals} docDecisions={docDecisions} wsId={wsId} activeDocId={activeDoc?.id} onDecisionCreated={d => setDocDecisions(prev => [d, ...prev])} />
              </div>{/* /docs-blocks-wrap */}
              </div>{/* /docs-editor-body */}

              {showDocAccess && activeDoc && (
                <DocAccessModal
                  doc={activeDoc}
                  onClose={() => setShowDocAccess(false)}
                  onSaved={(d) => {
                    if (!d) return;
                    setAllDocs(prev => prev.map(x => x.id === d.id ? { ...x, audience: d.audience, departmentIds: d.departmentIds, sharedWith: d.sharedWith } : x));
                    setActiveDoc(x => x ? { ...x, audience: d.audience, departmentIds: d.departmentIds, sharedWith: d.sharedWith } : x);
                  }}
                />
              )}
              {/* A-8: Publish panel */}
              {showPublish && (
                <div className="doc-publish-panel">
                  <div className="doc-publish-title">🌐 Publishing</div>
                  <div className="doc-publish-options">
                    {["PRIVATE","TEAM","PUBLIC"].map(v => (
                      <button key={v}
                        className={`doc-publish-opt${activeDoc?.visibility === v ? " active" : ""}`}
                        onClick={async () => {
                          const res = await setDocVisibility(activeDoc.id, v);
                          const updated = res?.data?.data ?? res?.data ?? {};
                          const slug = updated.publishedSlug || null;
                          setAllDocs(prev => prev.map(d => d.id === activeDoc.id ? { ...d, visibility: v, publishedSlug: slug } : d));
                          setActiveDoc(d => ({ ...d, visibility: v, publishedSlug: slug }));
                          toast?.show(`Visibility set to ${v}`, "success");
                        }}>
                        {v === "PRIVATE" ? "🔒 Private" : v === "TEAM" ? "👥 Team" : "🌐 Public"}
                      </button>
                    ))}
                  </div>
                  {activeDoc?.visibility === "PUBLIC" && (
                    <div className="doc-publish-link">
                      {activeDoc?.publishedSlug ? (
                        <>
                          <span className="doc-publish-link-label">Public link</span>
                          <div className="doc-publish-link-row">
                            <code className="doc-publish-slug">/docs/p/{activeDoc.publishedSlug}</code>
                            <button className="doc-publish-copy-btn"
                              onClick={() => {
                                navigator.clipboard.writeText(window.location.origin + "/docs/p/" + activeDoc.publishedSlug);
                                toast?.show("Link copied!", "success");
                              }}>
                              📋 Copy
                            </button>
                          </div>
                        </>
                      ) : (
                        <span className="doc-publish-link-label" style={{color:"#94a3b8"}}>Generating link…</span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* A-12: Tags panel */}
              {showTagPanel && (
                <DocTagPanel
                  doc={activeDoc}
                  onSave={async (tags, category) => {
                    await updateDocTags(activeDoc.id, tags, category);
                    setAllDocs(prev => prev.map(d => d.id === activeDoc.id ? { ...d, tags, category } : d));
                    setActiveDoc(d => ({ ...d, tags, category }));
                    toast?.show("Tags saved", "success");
                    setShowTagPanel(false);
                  }}
                  onClose={() => setShowTagPanel(false)}
                />
              )}

              {/* Backlinks panel */}
              <BacklinksPanel activeDoc={activeDoc} allDocs={allDocs} onOpenDoc={openDoc} />
            </div>

            {/* Inline comments panel */}
            {showInlineComments && activeDoc && (
              <div style={{position:"absolute",right:0,top:0,bottom:0,width:320,
                background:"var(--bg-card)",borderLeft:"1px solid var(--border)",
                zIndex:50,overflowY:"auto",display:"flex",flexDirection:"column"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                  padding:"14px 16px",borderBottom:"1px solid var(--border)",
                  fontWeight:800,fontSize:"14px"}}>
                  💬 Inline Comments
                  <button style={{background:"none",border:"none",cursor:"pointer",fontSize:"18px"}}
                    onClick={()=>setShowInlineComments(false)}>✕</button>
                </div>
                <div style={{flex:1,padding:"12px",display:"flex",flexDirection:"column",gap:"10px"}}>
                  {(activeDoc.inlineComments||[]).length === 0 && (
                    <div style={{fontSize:"13px",color:"#94a3b8",textAlign:"center",padding:"24px 0"}}>
                      No inline comments yet. Select text in the document to add a comment.
                    </div>
                  )}
                  {(activeDoc.inlineComments||[]).map(c=>(
                    <div key={c.id} style={{background:c.resolved?"var(--gray-50)":"rgba(99,102,241,.04)",
                      border:`1px solid ${c.resolved?"var(--border)":"rgba(99,102,241,.2)"}`,
                      borderRadius:"var(--radius-md)",padding:"10px"}}>
                      {c.selectedText && (
                        <div style={{fontSize:"11px",color:"#94a3b8",
                          borderLeft:"3px solid var(--brand-500)",paddingLeft:"8px",marginBottom:"6px",
                          fontStyle:"italic"}}>
                          "{c.selectedText.slice(0,80)}{c.selectedText.length>80?"…":""}"
                        </div>
                      )}
                      <div style={{fontSize:"13px",color:"#334155",marginBottom:"6px"}}>
                        {c.comment}
                      </div>
                      <div style={{display:"flex",justifyContent:"space-between",
                        fontSize:"10px",color:"#94a3b8"}}>
                        <span>💬 {c.authorEmail}</span>
                        {!c.resolved && (
                          <button style={{fontSize:"10px",background:"none",border:"1px solid var(--border)",
                            borderRadius:"4px",cursor:"pointer",padding:"1px 7px",color:"#1E8E5A"}}
                            onClick={async()=>{
                              await client.patch(`/docs/${activeDoc.id}/comments/${c.id}/resolve`);
                              // Reload doc to refresh inline comments
                              window.location.reload();
                            }}>Resolve</button>
                        )}
                        {c.resolved && <span style={{color:"#1E8E5A",fontWeight:700}}>✓ Resolved</span>}
                      </div>
                      {(c.replies||[]).map(r=>(
                        <div key={r.id} style={{marginTop:"8px",paddingTop:"8px",
                          borderTop:"1px solid var(--border)",fontSize:"12px",color:"#475569"}}>
                          ↩ <strong>{r.authorEmail}:</strong> {r.comment}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                {/* Add new inline comment */}
                <div style={{padding:"12px",borderTop:"1px solid var(--border)"}}>
                  <textarea rows={3} placeholder="Add a comment…"
                    id="new-inline-comment"
                    style={{width:"100%",fontSize:"13px",resize:"none"}} />
                  <button className="btn-primary" style={{width:"100%",marginTop:"8px",fontSize:"12px"}}
                    onClick={async()=>{
                      const el = document.getElementById("new-inline-comment");
                      if (!el?.value?.trim()) return;
                      const comment = { comment:el.value.trim(), blockId:"", selectedText:"" };
                      await client.post(`/docs/${activeDoc.id}/comments`, comment);
                      el.value="";
                      // Reload to see new comment
                      window.location.reload();
                    }}>Post Comment</button>
                </div>
              </div>
            )}

            {/* Version history panel — portal-style overlay, sibling to editor */}
            {showVersions && (
              <VersionHistoryPanel
                versions={versions}
                loading={versionsLoading}
                restoringVersion={restoringVersion}
                activeDoc={activeDoc}
                currentContent={content}
                onRestore={handleRestoreVersion}
                onClose={() => setShowVersions(false)}
              />
            )}
          </>
        ) : allDocs.length === 0 ? (
          /* True empty state — no docs exist at all */
          <div className="docs-empty-state">
            <div className="docs-empty-icon">📚</div>
            <h2>Knowledge base</h2>
            <p>Docs, wikis, SOPs, meeting notes, OKR reviews — all in one place.</p>
            <button className="btn btn-primary" style={{marginTop:16}} onClick={() => setShowTpl(true)}>
              + Create your first page
            </button>
            <div className="docs-tpl-shortcuts">
              {TEMPLATES.slice(1).map(t => (
                <button key={t.key} className="docs-tpl-shortcut" onClick={() => createNewDoc(null, t)}>
                  {t.emoji} {t.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Docs exist but none selected — show a page picker */
          <div className="docs-select-state">
            <div className="docs-select-icon">👈</div>
            <h2>Select a page</h2>
            <p>Choose a page from the sidebar, or create a new one.</p>
            <div className="docs-select-list">
              {allDocs.slice(0, 8).map(d => (
                <button key={d.id} className="docs-select-item" onClick={() => openDoc(d)}>
                  <span className="docs-select-emoji">{d.emoji || "📄"}</span>
                  <span className="docs-select-title">{d.title || "Untitled"}</span>
                </button>
              ))}
            </div>
            <button className="btn btn-primary" style={{marginTop:20}} onClick={() => setShowTpl(true)}>
              + New page
            </button>
          </div>
        )}
      </main>

      {showTpl && (
        <TemplatePicker
          onSelect={t => createNewDoc(null, t)}
          onClose={() => setShowTpl(false)}
        />
      )}
    </div>
  );
}

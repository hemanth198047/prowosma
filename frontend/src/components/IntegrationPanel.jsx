import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useIntegrations } from "../hooks/useIntegrations";
import { useToast } from "./ToastContext";

// ── Confluence page picker modal ──────────────────────────────────────────
function ConfluencePickerModal({ onSelect, onClose, searchConfluence, confluenceSpaces }) {
  const { show: showToast } = useToast();
  const [query,   setQuery]   = useState("");
  const [results, setResults] = useState([]);
  const [spaces,  setSpaces]  = useState([]);
  const [tab,     setTab]     = useState("search"); // search | spaces | create
  const [loading, setLoading] = useState(false);
  const [newPage, setNewPage] = useState({ spaceKey:"", title:"", content:"" });

  useEffect(() => {
    confluenceSpaces().then(setSpaces).catch(() => {});
  }, [confluenceSpaces]);

  const doSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try { setResults(await searchConfluence(query)); }
    catch { setResults([]); }
    finally { setLoading(false); }
  };

  return createPortal(
    <>
      <div onClick={onClose} style={{ position:"fixed", inset:0,
        background:"rgba(0,0,0,.5)", zIndex:99998 }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (onClose)?.(e); } }} />
      <div style={{ position:"fixed", top:"50%", left:"50%",
        transform:"translate(-50%,-50%)", width:"calc(100vw - 40px)", maxWidth:560,
        maxHeight:"85vh", background:"#fff", borderRadius:"16px",
        display:"flex", flexDirection:"column", zIndex:99999,
        boxShadow:"0 20px 60px rgba(0,0,0,.25)", overflow:"hidden" }}>

        {/* Header */}
        <div style={{ padding:"16px 20px", borderBottom:"1px solid #e8ecf2",
          display:"flex", alignItems:"center", gap:"10px", flexShrink:0,
          background:"linear-gradient(135deg,#0052CC12,#0052CC06)" }}>
          <span style={{ fontSize:"22px" }}>📘</span>
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:800, fontSize:"15px", color:"#0f172a" }}>
              Confluence
            </div>
            <div style={{ fontSize:"11px", color:"#64748b" }}>
              Search pages or create a new one
            </div>
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none",
            cursor:"pointer", fontSize:"18px", color:"#94a3b8" }}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display:"flex", borderBottom:"1px solid #e8ecf2", flexShrink:0 }}>
          {[["search","Search"],["spaces","Spaces"],["create","Create Page"]].map(([k,l])=>(
            <button key={k} onClick={()=>setTab(k)}
              style={{ flex:1, padding:"10px", border:"none", cursor:"pointer",
                fontSize:"12px", fontWeight:700, transition:"all .12s",
                background: tab===k?"#fff":"#f8fafc",
                color: tab===k?"#0052CC":"#64748b",
                borderBottom: tab===k?"2px solid #0052CC":"2px solid transparent" }}>
              {l}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex:1, minHeight:0, overflowY:"auto", padding:"16px" }}>

          {tab === "search" && (
            <div>
              <div style={{ display:"flex", gap:"8px", marginBottom:"12px" }}>
                <input value={query} onChange={e=>setQuery(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&doSearch()}
                  placeholder="Search Confluence pages…"
                  style={{ flex:1, padding:"9px 12px", borderRadius:"8px",
                    border:"1.5px solid #e2e8f0", fontSize:"13px", outline:"none" }}
                  onFocus={e=>e.target.style.borderColor="#0052CC"}
                  onBlur={e=>e.target.style.borderColor="#e2e8f0"} />
                <button onClick={doSearch} disabled={loading}
                  style={{ padding:"9px 18px", borderRadius:"8px", border:"none",
                    background:"#0052CC", color:"#fff", fontWeight:700,
                    fontSize:"12px", cursor:"pointer" }}>
                  {loading ? "…" : "Search"}
                </button>
              </div>
              {results.length === 0 && !loading && (
                <div style={{ textAlign:"center", padding:"24px", color:"#94a3b8",
                  fontSize:"13px" }}>
                  {query ? "No results found" : "Type a keyword to search Confluence"}
                </div>
              )}
              {results.map((r,i) => {
                const title   = r.title || "Untitled";
                const space   = r.space?.name || r.space?.key || "";
                const viewUrl = r._links?.webui ? (r._links?.base||"") + r._links.webui : "#";
                return (
                  <div key={i} style={{ display:"flex", alignItems:"center", gap:"10px",
                    padding:"10px 12px", borderRadius:"10px", cursor:"pointer",
                    border:"1px solid #e8ecf2", marginBottom:"6px", background:"#fafbfc",
                    transition:"all .12s" }}
                    onMouseEnter={e=>{ e.currentTarget.style.background="#eff6ff"; e.currentTarget.style.borderColor="#bfdbfe"; }}
                    onMouseLeave={e=>{ e.currentTarget.style.background="#fafbfc"; e.currentTarget.style.borderColor="#e8ecf2"; }}>
                    <span style={{ fontSize:"18px", flexShrink:0 }}>📄</span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontWeight:700, fontSize:"13px", color:"#1e293b",
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {title}
                      </div>
                      {space && <div style={{ fontSize:"11px", color:"#64748b" }}>{space}</div>}
                    </div>
                    <div style={{ display:"flex", gap:"5px", flexShrink:0 }}>
                      <a href={viewUrl} target="_blank" rel="noreferrer"
                        onClick={e=>e.stopPropagation()}
                        style={{ padding:"4px 10px", borderRadius:"6px",
                          border:"1px solid #e2e8f0", background:"#fff",
                          fontSize:"11px", color:"#64748b", textDecoration:"none" }}>
                        Open ↗
                      </a>
                      <button onClick={()=>onSelect({ title, url:viewUrl, id:r.id, type:"confluence" })}
                        style={{ padding:"4px 10px", borderRadius:"6px", border:"none",
                          background:"#0052CC", color:"#fff", fontSize:"11px",
                          fontWeight:700, cursor:"pointer" }}>
                        Link
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tab === "spaces" && (
            <div>
              <div style={{ fontSize:"12px", color:"#64748b", marginBottom:"10px" }}>
                Your Confluence spaces — click to browse
              </div>
              {spaces.length === 0 && (
                <div style={{ textAlign:"center", padding:"24px", color:"#94a3b8" }}>
                  Loading spaces…
                </div>
              )}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px" }}>
                {spaces.map((s,i) => (
                  <div key={i} style={{ padding:"12px", borderRadius:"10px",
                    border:"1px solid #e8ecf2", background:"#fafbfc", cursor:"pointer",
                    transition:"all .12s" }}
                    onMouseEnter={e=>{ e.currentTarget.style.background="#eff6ff"; e.currentTarget.style.borderColor="#bfdbfe"; }}
                    onMouseLeave={e=>{ e.currentTarget.style.background="#fafbfc"; e.currentTarget.style.borderColor="#e8ecf2"; }}
                    onClick={()=>{
                      const spaceUrl = s._links?.webui ? "https://prowosma.atlassian.net/wiki"+s._links.webui : null;
                      if (onSelect) onSelect({ type:"space", id:s.key, key:s.key, title:s.name, name:s.name, url:spaceUrl });
                      if (spaceUrl) window.open(spaceUrl, "_blank");
                    }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (()=>{
                      const spaceUrl = s._links?.webui ? "https://prowosma.atlassian.net/wiki"+s._links.webui : null;
                      if (onSelect) onSelect({ type:"space", id:s.key, key:s.key, title:s.name, name:s.name, url:spaceUrl });
                      if (spaceUrl) window.open(spaceUrl, "_blank");
                    })?.(e); } }}>
                    <div style={{ fontWeight:700, fontSize:"12px", color:"#1e293b" }}>
                      {s.name}
                    </div>
                    <div style={{ fontSize:"10px", color:"#94a3b8", marginTop:"2px" }}>
                      {s.key} · {s.type}
                    </div>
                    <div style={{ fontSize:"10px", color:"#3b82f6", marginTop:"4px" }}>
                      Click to open →
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "create" && (
            <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
              <div style={{ padding:"10px 12px", background:"#eff6ff",
                borderRadius:"8px", border:"1px solid #bfdbfe",
                fontSize:"12px", color:"#1d4ed8" }}>
                ℹ️ Creates a new page in your Confluence space and links it here.
              </div>
              <div>
                <label style={{ fontSize:"12px", fontWeight:700, color:"#374151",
                  display:"block", marginBottom:"4px" }} htmlFor={"integration-panel-space-key"}>Space Key</label>
                <select value={newPage.spaceKey}
                  onChange={e=>setNewPage(p=>({...p,spaceKey:e.target.value}))}
                  style={{ width:"100%", padding:"9px 10px", borderRadius:"8px",
                    border:"1.5px solid #e2e8f0", fontSize:"13px", boxSizing:"border-box" }} id={"integration-panel-space-key"}>
                  <option value="">Select a space…</option>
                  {spaces.map(s=>(
                    <option key={s.key} value={s.key}>{s.name} ({s.key})</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize:"12px", fontWeight:700, color:"#374151",
                  display:"block", marginBottom:"4px" }} htmlFor={"integration-panel-page-title"}>Page Title</label>
                <input value={newPage.title}
                  onChange={e=>setNewPage(p=>({...p,title:e.target.value}))}
                  placeholder="e.g. Project Brief — Q3 2026"
                  style={{ width:"100%", padding:"9px 12px", borderRadius:"8px",
                    border:"1.5px solid #e2e8f0", fontSize:"13px",
                    boxSizing:"border-box", outline:"none" }}
                  onFocus={e=>e.target.style.borderColor="#0052CC"}
                  onBlur={e=>e.target.style.borderColor="#e2e8f0"} id={"integration-panel-page-title"} />
              </div>
              <div>
                <label style={{ fontSize:"12px", fontWeight:700, color:"#374151",
                  display:"block", marginBottom:"4px" }} htmlFor={"integration-panel-initial-content"}>Initial Content</label>
                <textarea rows={4} value={newPage.content}
                  onChange={e=>setNewPage(p=>({...p,content:e.target.value}))}
                  placeholder="Page content (plain text or HTML)…"
                  style={{ width:"100%", padding:"9px 12px", borderRadius:"8px",
                    border:"1.5px solid #e2e8f0", fontSize:"12px",
                    boxSizing:"border-box", outline:"none", resize:"vertical",
                    lineHeight:1.5 }}
                  onFocus={e=>e.target.style.borderColor="#0052CC"}
                  onBlur={e=>e.target.style.borderColor="#e2e8f0"} id={"integration-panel-initial-content"} />
              </div>
              <button
                onClick={async()=>{
                  if(!newPage.spaceKey||!newPage.title){ showToast("Space and title required", "warning"); return; }
                  try {
                    const pg = await window.__confluenceCreate(newPage.spaceKey,newPage.title,newPage.content);
                    const viewUrl = pg._links ? (pg._links.base||"")+pg._links.webui : "#";
                    onSelect({ title:newPage.title, url:viewUrl, id:pg.id, type:"confluence" });
                  } catch(e){ showToast(e.message, "error"); }
                }}
                style={{ padding:"10px", borderRadius:"9px", border:"none",
                  background:"#0052CC", color:"#fff", fontWeight:800,
                  fontSize:"13px", cursor:"pointer" }}>
                Create & Link Page
              </button>
            </div>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}

// ── Slack send modal ──────────────────────────────────────────────────────
function SlackSendModal({ context, onClose, slackNotify }) {
  const { show: showToast } = useToast();
  const [title,   setTitle]   = useState(context?.title || "");
  const [message, setMessage] = useState(context?.message || "");
  const [color,   setColor]   = useState("#6366f1");
  const [sending, setSending] = useState(false);
  const [sent,    setSent]    = useState(false);

  const send = async () => {
    setSending(true);
    try {
      await slackNotify(title, message, color);
      setSent(true);
      setTimeout(onClose, 1200);
    } catch(e) { showToast(e.message, "error"); }
    finally { setSending(false); }
  };

  return createPortal(
    <>
      <div onClick={onClose} style={{ position:"fixed", inset:0,
        background:"rgba(0,0,0,.45)", zIndex:99998 }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (onClose)?.(e); } }} />
      <div style={{ position:"fixed", top:"50%", left:"50%",
        transform:"translate(-50%,-50%)", width:"calc(100vw - 40px)", maxWidth:480,
        background:"#fff", borderRadius:"16px", zIndex:99999,
        boxShadow:"0 20px 60px rgba(0,0,0,.2)", overflow:"hidden" }}>
        <div style={{ padding:"16px 20px", borderBottom:"1px solid #e8ecf2",
          background:"linear-gradient(135deg,#4A154B12,transparent)",
          display:"flex", alignItems:"center", gap:"10px" }}>
          <span style={{ fontSize:"22px" }}>💬</span>
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:800, fontSize:"15px", color:"#0f172a" }}>Send to Slack</div>
            <div style={{ fontSize:"11px", color:"#64748b" }}>Post a message to your configured channel</div>
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none",
            cursor:"pointer", fontSize:"18px", color:"#94a3b8" }}>✕</button>
        </div>
        <div style={{ padding:"20px", display:"flex", flexDirection:"column", gap:"12px" }}>
          <div>
            <label style={{ fontSize:"12px", fontWeight:700, color:"#374151",
              display:"block", marginBottom:"4px" }} htmlFor={"integration-panel-title"}>Title</label>
            <input value={title} onChange={e=>setTitle(e.target.value)}
              style={{ width:"100%", padding:"9px 12px", borderRadius:"8px",
                border:"1.5px solid #e2e8f0", fontSize:"13px", boxSizing:"border-box" }} id={"integration-panel-title"} />
          </div>
          <div>
            <label style={{ fontSize:"12px", fontWeight:700, color:"#374151",
              display:"block", marginBottom:"4px" }} htmlFor={"integration-panel-message"}>Message</label>
            <textarea rows={4} value={message} onChange={e=>setMessage(e.target.value)}
              style={{ width:"100%", padding:"9px 12px", borderRadius:"8px",
                border:"1.5px solid #e2e8f0", fontSize:"12px",
                boxSizing:"border-box", resize:"vertical", lineHeight:1.5 }} id={"integration-panel-message"} />
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
            <span style={{ fontSize:"12px", fontWeight:700, color:"#374151" }} id="integration-panel-colour-label">Colour</span>
            <div role="radiogroup" aria-labelledby="integration-panel-colour-label" style={{ display: "contents" }}>
            {["#6366f1","#10b981","#f59e0b","#ef4444","#0ea5e9"].map(c=>(
              <div key={c} onClick={()=>setColor(c)}
                style={{ width:22, height:22, borderRadius:"50%", background:c,
                  cursor:"pointer", border: color===c?"3px solid #1e293b":"2px solid transparent",
                  flexShrink:0 }} role="radio" aria-checked={color===c} tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (()=>setColor(c))?.(e); } }} />
            ))}
            </div>
          </div>
          {sent && (
            <div style={{ padding:"10px", borderRadius:"8px", background:"#f0fdf4",
              border:"1px solid #86efac", color:"#15803d", fontWeight:700, fontSize:"13px" }}>
              ✓ Sent to Slack!
            </div>
          )}
          <div style={{ display:"flex", gap:"8px", justifyContent:"flex-end" }}>
            <button onClick={onClose}
              style={{ padding:"9px 18px", borderRadius:"8px", border:"1px solid #e2e8f0",
                background:"#fff", fontSize:"13px", fontWeight:600, cursor:"pointer" }}>
              Cancel
            </button>
            <button onClick={send} disabled={sending||sent}
              style={{ padding:"9px 24px", borderRadius:"8px", border:"none",
                background:"#4A154B", color:"#fff", fontSize:"13px",
                fontWeight:800, cursor:"pointer", opacity:sending||sent?.85:1 }}>
              {sent?"✓ Sent!":sending?"Sending…":"Send"}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// IntegrationPanel — Drop-in panel for any entity (task, project, doc, goal)
// Usage: <IntegrationPanel entity={{ type:"task", id, title }} />
// ═══════════════════════════════════════════════════════════════════════════
export default function IntegrationPanel({ entity, compact = false }) {
  const { isConnected, searchConfluence, confluenceSpaces,
          createConfluencePage, slackNotify } = useIntegrations();

  const [showConfluence, setShowConfluence] = useState(false);
  const [showSlack,      setShowSlack]      = useState(false);
  const [linkedPages,    setLinkedPages]    = useState(() => {
    try { return JSON.parse(localStorage.getItem(`cf_links_${entity?.id}`) || "[]"); }
    catch { return []; }
  });

  const handleConfluenceSelect = (page) => {
    // Normalize: spaces use 'name', pages use 'title'
    const normalized = {
      ...page,
      id:    page.id    || page.key || page.url,
      title: page.title || page.name || page.key || "Untitled",
      url:   page.url   || null,
    };
    const updated = [...linkedPages.filter(p=>p.id!==normalized.id), normalized];
    setLinkedPages(updated);
    localStorage.setItem(`cf_links_${entity?.id}`, JSON.stringify(updated));
    setShowConfluence(false);
  };

  const removeLink = (id) => {
    const updated = linkedPages.filter(p=>p.id!==id);
    setLinkedPages(updated);
    localStorage.setItem(`cf_links_${entity?.id}`, JSON.stringify(updated));
  };

  // Expose createConfluencePage for the create-in-modal button
  useEffect(() => {
    window.__confluenceCreate = createConfluencePage;
    return () => { delete window.__confluenceCreate; };
  }, [createConfluencePage]);

  const hasAny = isConnected("CONFLUENCE") || isConnected("SLACK") || isConnected("GITHUB");
  if (!hasAny) return null;

  if (compact) {
    // Compact pill row for inline use in task/project cards
    return (
      <div style={{ display:"flex", gap:"5px", alignItems:"center", flexWrap:"wrap" }}>
        {linkedPages.map(p => (
          <a key={p.id} href={p.url} target="_blank" rel="noreferrer"
            style={{ display:"flex", alignItems:"center", gap:"4px",
              padding:"2px 8px", borderRadius:"999px", fontSize:"10px",
              fontWeight:700, textDecoration:"none",
              background:"#eff6ff", color:"#1d4ed8", border:"1px solid #bfdbfe" }}>
            {(p.title||p.name||p.key||"").slice(0,20)}
          </a>
        ))}
        {isConnected("CONFLUENCE") && (
          <button onClick={()=>setShowConfluence(true)}
            title="Link Confluence page"
            style={{ padding:"2px 8px", borderRadius:"999px", border:"1px dashed #bfdbfe",
              background:"#fff", fontSize:"10px", fontWeight:700,
              color:"#0052CC", cursor:"pointer" }}>
            + 📘
          </button>
        )}
        {isConnected("SLACK") && (
          <button onClick={()=>setShowSlack(true)}
            title="Share to Slack"
            style={{ padding:"2px 8px", borderRadius:"999px", border:"1px dashed #c4b5fd",
              background:"#fff", fontSize:"10px", fontWeight:700,
              color:"#4A154B", cursor:"pointer" }}>
            💬
          </button>
        )}
        {showConfluence && (
          <ConfluencePickerModal
            onSelect={handleConfluenceSelect}
            onClose={()=>setShowConfluence(false)}
            searchConfluence={searchConfluence}
            confluenceSpaces={confluenceSpaces} />
        )}
        {showSlack && (
          <SlackSendModal
            context={{ title: entity?.title || "", message:`Update on ${entity?.type}: ${entity?.title}` }}
            onClose={()=>setShowSlack(false)}
            slackNotify={slackNotify} />
        )}
      </div>
    );
  }

  // Full panel
  return (
    <div style={{ background:"#fff", border:"1px solid #e8ecf2", borderRadius:"12px",
      padding:"14px", marginTop:"12px" }}>
      <div style={{ fontSize:"11px", fontWeight:800, color:"#64748b",
        textTransform:"uppercase", letterSpacing:".06em", marginBottom:"12px" }}>
        Integrations
      </div>

      {/* Confluence section */}
      {isConnected("CONFLUENCE") && (
        <div style={{ marginBottom:"14px" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
            marginBottom:"8px" }}>
            <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
              <span style={{ fontSize:"16px" }}>📘</span>
              <span style={{ fontWeight:700, fontSize:"13px", color:"#0052CC" }}>Confluence</span>
            </div>
            <button onClick={()=>setShowConfluence(true)}
              style={{ padding:"4px 12px", borderRadius:"7px", border:"none",
                background:"#0052CC", color:"#fff", fontSize:"11px",
                fontWeight:700, cursor:"pointer" }}>
              + Link Page
            </button>
          </div>
          {linkedPages.length === 0 ? (
            <div style={{ fontSize:"12px", color:"#94a3b8", padding:"8px",
              background:"#f8fafc", borderRadius:"8px", textAlign:"center",
              border:"1px dashed #e2e8f0" }}>
              No pages linked yet — click "+ Link Page" to attach a Confluence doc
            </div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:"5px" }}>
              {linkedPages.map(p => (
                <div key={p.id} style={{ display:"flex", alignItems:"center", gap:"8px",
                  padding:"7px 10px", borderRadius:"8px",
                  background:"#eff6ff", border:"1px solid #bfdbfe" }}>
                  <span style={{ fontSize:"14px" }}>📄</span>
                  {p.url ? (
                    <a href={p.url} target="_blank" rel="noreferrer"
                      style={{ flex:1, fontSize:"12px", fontWeight:700,
                        color:"#1d4ed8", textDecoration:"none",
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {p.title||p.name||p.key}
                    </a>
                  ) : (
                    <span style={{ flex:1, fontSize:"12px", fontWeight:700,
                      color:"#1d4ed8", overflow:"hidden",
                      textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {p.title||p.name||p.key}
                    </span>
                  )}
                  <button onClick={()=>removeLink(p.id)}
                    style={{ background:"none", border:"none", cursor:"pointer",
                      color:"#94a3b8", fontSize:"13px", padding:"0 2px" }}>✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Slack section */}
      {isConnected("SLACK") && (
        <div>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
              <span style={{ fontSize:"16px" }}>💬</span>
              <span style={{ fontWeight:700, fontSize:"13px", color:"#4A154B" }}>Slack</span>
            </div>
            <button onClick={()=>setShowSlack(true)}
              style={{ padding:"4px 12px", borderRadius:"7px", border:"none",
                background:"#4A154B", color:"#fff", fontSize:"11px",
                fontWeight:700, cursor:"pointer" }}>
              Share Update
            </button>
          </div>
        </div>
      )}

      {showConfluence && (
        <ConfluencePickerModal
          onSelect={handleConfluenceSelect}
          onClose={()=>setShowConfluence(false)}
          searchConfluence={searchConfluence}
          confluenceSpaces={confluenceSpaces} />
      )}
      {showSlack && (
        <SlackSendModal
          context={{ title: entity?.title || "", message:`Update on ${entity?.type}: ${entity?.title}` }}
          onClose={()=>setShowSlack(false)}
          slackNotify={slackNotify} />
      )}
    </div>
  );
}

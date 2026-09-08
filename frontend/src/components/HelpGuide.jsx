import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";

const HELP_PDF_URL = "/Prowosma_Help_Guide.pdf";

const SECTIONS = [
  { icon:"🏠", label:"Dashboard",      desc:"Command center, charts, AI insight" },
  { icon:"⚡", label:"Work",           desc:"Projects, Tasks, Goals, Kanban, Sprints, Gantt, Calendar, Deploy, Graph" },
  { icon:"📚", label:"Knowledge",      desc:"Docs, Decisions, Meetings, SOPs" },
  { icon:"📈", label:"Insights",       desc:"Analytics, KPIs, ROI, Portfolio, Reports, Scenarios, Time" },
  { icon:"🔀", label:"Automate",       desc:"BPM Studio, Automations, Integrations, Import" },
  { icon:"💬", label:"Collaborate",    desc:"Channels" },
  { icon:"👥", label:"Team",           desc:"Members, Activity Log" },
  { icon:"⚙️", label:"Configure",     desc:"Categories, Custom Fields, Workspace, Admin, Developer" },
  { icon:"🤖", label:"AI",            desc:"AI Assistant, AI Intelligence, AI Settings" },
  { icon:"🔍", label:"Topbar",        desc:"Search, Design Switcher, Font Switcher, Dark Mode, Notifications" },
];

export default function HelpGuide() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = HELP_PDF_URL;
    a.download = "Prowosma_Help_Guide.pdf";
    a.click();
  };

  const handleOpen = () => {
    window.open(HELP_PDF_URL, "_blank");
  };

  return (
    <div className="hg-wrap" ref={ref}>
      {/* Trigger */}
      <button
        className="hg-trigger"
        onClick={() => setOpen(o => !o)}
        title="Help Guide"
        aria-label="Open help guide"
      >
        <span className="hg-trigger-inner">
          <svg className="hg-icon" width="15" height="15" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2.2"
            strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span className="hg-trigger-label">Help</span>
        </span>
      </button>

      {open && (
        <div className="hg-panel">

          {/* Header */}
          <div className="hg-header">
            <div className="hg-header-left">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                stroke="#6366f1" strokeWidth="2.2" strokeLinecap="round">
                <circle cx="12" cy="12" r="10"/>
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <div>
                <div className="hg-title">Prowosma Help Guide</div>
                <div className="hg-subtitle">Complete feature reference · {SECTIONS.length} sections</div>
              </div>
            </div>
            <button className="hg-close" onClick={() => setOpen(false)}>✕</button>
          </div>

          {/* PDF preview banner */}
          <div className="hg-pdf-banner">
            <div className="hg-pdf-icon">📄</div>
            <div className="hg-pdf-info">
              <div className="hg-pdf-name">Prowosma_Help_Guide.pdf</div>
              <div className="hg-pdf-meta">All {SECTIONS.length} sections · Detailed how-to guides · Tips & tricks</div>
            </div>
            <div className="hg-pdf-actions">
              <button className="hg-btn-view" onClick={handleOpen}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                View PDF
              </button>
              <button className="hg-btn-download" onClick={handleDownload}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Download
              </button>
            </div>
          </div>

          {/* Section index */}
          <div className="hg-section-label">What's covered</div>
          <div className="hg-sections">
            {SECTIONS.map((s, i) => (
              <button
                key={i}
                className="hg-section-item"
                onClick={() => { handleOpen(); setOpen(false); }}
                title={s.desc}
              >
                <span className="hg-section-icon">{s.icon}</span>
                <div className="hg-section-info">
                  <div className="hg-section-name">{s.label}</div>
                  <div className="hg-section-desc">{s.desc}</div>
                </div>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="hg-section-arrow"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            ))}
          </div>

          {/* Footer */}
          <div className="hg-footer">
            <span>Need more help?</span>
            <button className="hg-footer-link" style={{background:"none",border:"none",cursor:"pointer",padding:0,font:"inherit"}}
              onClick={() => { window.open("mailto:support@prowosma.app?subject=Prowosma%20Support", "_self"); }}>
              Contact support →
            </button>
            <span style={{color:"var(--gray-300)"}}>·</span>
            <button className="hg-footer-link" style={{background:"none",border:"none",cursor:"pointer",padding:0,font:"inherit"}}
              onClick={() => { setOpen(false); setOpen(false); navigate("/licensing"); }}>
              View plans →
            </button>
          </div>

        </div>
      )}
    </div>
  );
}

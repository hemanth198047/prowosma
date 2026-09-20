import { useState, useRef } from "react";
import PageHeader from "../components/PageHeader";
import client from "../api/client";
import { apiErrorMessage } from "../utils/apiError";

const SECTIONS = [
  { key:"projects", icon:"📁", label:"Projects",  color:"#3b82f6", desc:"Name, status, category, due date, budget, linked goal" },
  { key:"goals",    icon:"🎯", label:"Goals",     color:"#10b981", desc:"Title, status, progress, level, owner, quarter, confidence" },
  { key:"tasks",    icon:"✅", label:"Tasks",     color:"#f59e0b", desc:"Title, status, priority, project link, due date, story points, tags" },
];

export default function ImportExport() {
  const [tab, setTab]             = useState("import"); // "import" | "export"
  const [file, setFile]           = useState(null);
  const [dragging, setDragging]   = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [result, setResult]       = useState(null); // import result
  const [error, setError]         = useState(null);
  const inputRef = useRef();

  // ── Drop zone ─────────────────────────────────────────────────────────────
  const onDrop = (e) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) pickFile(f);
  };
  const pickFile = (f) => {
    if (!f.name.endsWith(".xlsx") && !f.name.endsWith(".xls")) {
      setError("Only .xlsx files are supported."); return;
    }
    setFile(f); setResult(null); setError(null);
  };

  // ── Import ────────────────────────────────────────────────────────────────
  const handleImport = async () => {
    if (!file) return;
    setImporting(true); setResult(null); setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await client.post("/import-export/import", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setResult(res.data);
      setFile(null);
    } catch (e) {
      setError(apiErrorMessage(e, e.message || "Import failed"));
    } finally { setImporting(false); }
  };

  // ── Export ────────────────────────────────────────────────────────────────
  const handleExport = async () => {
    setExporting(true); setError(null);
    try {
      const res = await client.get("/import-export/export", { responseType:"blob" });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `prowosma-export-${new Date().toISOString().slice(0,10)}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      setError("Export failed. Please try again.");
    } finally { setExporting(false); }
  };

  const handleTemplate = async () => {
    try {
      const res = await client.get("/import-export/template", { responseType:"blob" });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a"); a.href = url;
      a.download = "prowosma-import-template.xlsx"; a.click();
      window.URL.revokeObjectURL(url);
    } catch { setError("Could not download template."); }
  };

  return (
    <div>
      <PageHeader icon="📦" title="Import / Export"
        description="Bulk-import projects, goals and tasks from Excel — or export your entire workspace for backup and migration" />

      {/* Tab switcher */}
      <div style={{ display:"flex", gap:"0", marginBottom:"24px", borderRadius:"12px",
        background:"#f1f5f9", padding:"4px", width:"fit-content" }}>
        {["import","export"].map(t => (
          <button key={t} onClick={() => { setTab(t); setResult(null); setError(null); setFile(null); }}
            style={{ padding:"8px 28px", borderRadius:"9px", border:"none", cursor:"pointer",
              fontSize:"13px", fontWeight:700, transition:"all .15s",
              background: tab===t ? "#fff" : "transparent",
              color: tab===t ? "#1e293b" : "#64748b",
              boxShadow: tab===t ? "0 1px 4px rgba(0,0,0,.1)" : "none" }}>
            {t === "import" ? "⬆️ Import" : "⬇️ Export"}
          </button>
        ))}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 340px", gap:"20px", alignItems:"start" }}>

        {/* ── MAIN PANEL ── */}
        <div>
          {tab === "import" ? (
            <div>
              {/* Drop zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => inputRef.current?.click()}
                style={{
                  border: `2px dashed ${dragging ? "#6366f1" : file ? "#10b981" : "#cbd5e1"}`,
                  borderRadius:"16px", padding:"48px 24px", textAlign:"center",
                  cursor:"pointer", transition:"all .2s",
                  background: dragging ? "#f0f0ff" : file ? "#f0fdf4" : "#fafbfc",
                  marginBottom:"16px",
                }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => inputRef.current?.click())?.(e); } }}>
                <input ref={inputRef} type="file" accept=".xlsx,.xls"
                  style={{ display:"none" }}
                  onChange={(e) => e.target.files[0] && pickFile(e.target.files[0])} />
                {file ? (
                  <div>
                    <div style={{ fontSize:"40px", marginBottom:"10px" }}>✅</div>
                    <div style={{ fontWeight:800, fontSize:"16px", color:"#059669", marginBottom:"4px" }}>
                      {file.name}
                    </div>
                    <div style={{ fontSize:"12px", color:"#64748b" }}>
                      {(file.size / 1024).toFixed(1)} KB — ready to import
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); setFile(null); setResult(null); }}
                      style={{ marginTop:"10px", padding:"4px 12px", borderRadius:"6px",
                        border:"1px solid #e2e8f0", background:"#fff", fontSize:"11px",
                        cursor:"pointer", color:"#64748b" }}>
                      ✕ Remove
                    </button>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize:"48px", marginBottom:"12px" }}>📂</div>
                    <div style={{ fontWeight:700, fontSize:"16px", color:"#1e293b", marginBottom:"6px" }}>
                      Drop your Excel file here
                    </div>
                    <div style={{ fontSize:"13px", color:"#64748b", marginBottom:"16px" }}>
                      or click to browse — .xlsx files only
                    </div>
                    <div style={{ display:"inline-flex", padding:"6px 16px",
                      background:"#6366f1", color:"#fff", borderRadius:"8px",
                      fontSize:"12px", fontWeight:700 }}>
                      Choose File
                    </div>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div style={{ display:"flex", gap:"10px", marginBottom:"16px" }}>
                <button onClick={handleImport} disabled={!file || importing}
                  style={{ flex:1, padding:"12px", borderRadius:"10px", border:"none",
                    background: file && !importing ? "linear-gradient(135deg,#6366f1,#8b5cf6)" : "#e2e8f0",
                    color: file && !importing ? "#fff" : "#94a3b8",
                    fontSize:"14px", fontWeight:800, cursor: file ? "pointer" : "default",
                    transition:"all .15s", display:"flex", alignItems:"center",
                    justifyContent:"center", gap:"8px" }}>
                  {importing ? (
                    <><span style={{ width:16, height:16, border:"2px solid rgba(255,255,255,.4)",
                      borderTopColor:"#fff", borderRadius:"50%",
                      animation:"spin .7s linear infinite", display:"inline-block" }} />
                    Importing...</>
                  ) : "⬆️ Import Now"}
                </button>
                <button onClick={handleTemplate}
                  style={{ padding:"12px 20px", borderRadius:"10px",
                    border:"1.5px solid #e2e8f0", background:"#fff",
                    fontSize:"13px", fontWeight:700, cursor:"pointer",
                    color:"#374151", display:"flex", alignItems:"center", gap:"6px" }}>
                  📥 Get Template
                </button>
              </div>

              {/* Result */}
              {result && (
                <div style={{ borderRadius:"12px", overflow:"hidden",
                  border:`1.5px solid ${result.success ? "#86efac" : "#fca5a5"}`,
                  background: result.success ? "#f0fdf4" : "#fff1f2" }}>
                  <div style={{ padding:"14px 16px",
                    background: result.success ? "#dcfce7" : "#fee2e2",
                    display:"flex", alignItems:"center", gap:"10px" }}>
                    <span style={{ fontSize:"22px" }}>{result.success ? "🎉" : "⚠️"}</span>
                    <span style={{ fontWeight:800, fontSize:"14px",
                      color: result.success ? "#15803d" : "#b91c1c" }}>
                      {result.success ? "Import completed successfully!" : "Import completed with errors"}
                    </span>
                  </div>
                  <div style={{ padding:"16px", display:"grid",
                    gridTemplateColumns:"repeat(3,1fr)", gap:"10px" }}>
                    {[
                      { label:"Projects created", value:result.projectsCreated, color:"#3b82f6", icon:"📁" },
                      { label:"Goals created",    value:result.goalsCreated,    color:"#10b981", icon:"🎯" },
                      { label:"Tasks created",    value:result.tasksCreated,    color:"#f59e0b", icon:"✅" },
                    ].map(s => (
                      <div key={s.label} style={{ textAlign:"center", padding:"12px",
                        background:"#fff", borderRadius:"10px",
                        border:`1px solid ${s.color}22` }}>
                        <div style={{ fontSize:"24px", marginBottom:"4px" }}>{s.icon}</div>
                        <div style={{ fontSize:"24px", fontWeight:800, color:s.color }}>{s.value}</div>
                        <div style={{ fontSize:"11px", color:"#64748b", fontWeight:600 }}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                  {result.errors?.length > 0 && (
                    <div style={{ padding:"0 16px 16px" }}>
                      <div style={{ fontSize:"12px", fontWeight:700, color:"#b91c1c",
                        marginBottom:"6px" }}>
                        {result.errors.length} row error{result.errors.length>1?"s":""}:
                      </div>
                      <div style={{ background:"#fff", borderRadius:"8px",
                        border:"1px solid #fca5a5", padding:"10px",
                        maxHeight:"140px", overflowY:"auto" }}>
                        {result.errors.map((e,i) => (
                          <div key={i} style={{ fontSize:"11px", color:"#b91c1c",
                            padding:"2px 0", borderBottom:"1px solid #fee2e2" }}>
                            {e}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {error && (
                <div style={{ padding:"12px 16px", borderRadius:"10px",
                  background:"#fff1f2", border:"1px solid #fca5a5",
                  color:"#b91c1c", fontSize:"13px", fontWeight:600 }}>
                  ⚠️ {error}
                </div>
              )}
            </div>
          ) : (
            /* EXPORT TAB */
            <div>
              <div style={{ background:"#fff", border:"1px solid #e8ecf2",
                borderRadius:"16px", padding:"28px", textAlign:"center",
                marginBottom:"16px" }}>
                <div style={{ fontSize:"56px", marginBottom:"14px" }}>📊</div>
                <div style={{ fontWeight:800, fontSize:"18px", color:"#1e293b",
                  marginBottom:"8px" }}>
                  Export Your Entire Workspace
                </div>
                <div style={{ fontSize:"13px", color:"#64748b", maxWidth:"400px",
                  margin:"0 auto 24px", lineHeight:1.7 }}>
                  Downloads all your projects, goals and tasks into a single Excel workbook.
                  Perfect for backups, migrations, or sharing with your team.
                </div>
                <button onClick={handleExport} disabled={exporting}
                  style={{ padding:"14px 36px", borderRadius:"12px", border:"none",
                    background:"linear-gradient(135deg,#059669,#0d9488)",
                    color:"#fff", fontSize:"15px", fontWeight:800, cursor:"pointer",
                    display:"inline-flex", alignItems:"center", gap:"10px",
                    boxShadow:"0 4px 16px rgba(5,150,105,.3)", transition:"all .15s" }}>
                  {exporting ? (
                    <><span style={{ width:18, height:18, border:"2px solid rgba(255,255,255,.4)",
                      borderTopColor:"#fff", borderRadius:"50%",
                      animation:"spin .7s linear infinite", display:"inline-block" }} />
                    Preparing download...</>
                  ) : "⬇️ Download Excel"}
                </button>
              </div>

              <div style={{ background:"#f8fafc", border:"1px solid #e2e8f0",
                borderRadius:"12px", padding:"16px" }}>
                <div style={{ fontSize:"12px", fontWeight:800, color:"#64748b",
                  letterSpacing:".06em", textTransform:"uppercase", marginBottom:"12px" }}>
                  What's included in the export
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
                  {[
                    { sheet:"Projects", icon:"📁", color:"#3b82f6",
                      fields:"Name, description, status, color, category, linked goal, parent project, due date, budget, currency" },
                    { sheet:"Goals", icon:"🎯", color:"#10b981",
                      fields:"Title, description, status, progress, level, owner, quarter, confidence, target date, parent goal" },
                    { sheet:"Tasks", icon:"✅", color:"#f59e0b",
                      fields:"Title, description, status, priority, project ID, due date, story points, type, severity, tags" },
                    { sheet:"Instructions", icon:"📋", color:"#6366f1",
                      fields:"Full column reference guide for re-importing" },
                  ].map(s => (
                    <div key={s.sheet} style={{ display:"flex", gap:"12px",
                      padding:"10px 12px", background:"#fff", borderRadius:"9px",
                      border:`1px solid ${s.color}22` }}>
                      <div style={{ width:32, height:32, borderRadius:"8px",
                        background:`${s.color}18`, display:"flex", alignItems:"center",
                        justifyContent:"center", fontSize:"16px", flexShrink:0 }}>
                        {s.icon}
                      </div>
                      <div>
                        <div style={{ fontWeight:700, fontSize:"13px", color:"#1e293b" }}>
                          {s.sheet} sheet
                        </div>
                        <div style={{ fontSize:"11px", color:"#94a3b8", marginTop:"2px" }}>
                          {s.fields}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {error && (
                <div style={{ marginTop:"12px", padding:"12px 16px", borderRadius:"10px",
                  background:"#fff1f2", border:"1px solid #fca5a5",
                  color:"#b91c1c", fontSize:"13px", fontWeight:600 }}>
                  ⚠️ {error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── RIGHT PANEL — Format guide ── */}
        <div style={{ position:"sticky", top:"80px" }}>
          <div style={{ background:"#fff", border:"1px solid #e8ecf2",
            borderRadius:"14px", padding:"18px", marginBottom:"12px" }}>
            <div style={{ fontSize:"12px", fontWeight:800, color:"#475569",
              letterSpacing:".06em", textTransform:"uppercase", marginBottom:"14px" }}>
              📋 Sheets & Columns
            </div>
            {SECTIONS.map(sec => (
              <div key={sec.key} style={{ marginBottom:"14px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:"7px",
                  marginBottom:"7px" }}>
                  <span style={{ fontSize:"15px" }}>{sec.icon}</span>
                  <span style={{ fontWeight:800, fontSize:"12px", color:sec.color,
                    textTransform:"uppercase", letterSpacing:".04em" }}>
                    {sec.label}
                  </span>
                </div>
                <div style={{ fontSize:"11px", color:"#64748b", lineHeight:1.6,
                  paddingLeft:"22px" }}>
                  {sec.desc}
                </div>
              </div>
            ))}
          </div>

          <div style={{ background:"linear-gradient(135deg,#0a1628,#0f2044)",
            border:"1.5px solid rgba(59,130,246,.4)", borderRadius:"14px",
            padding:"16px", color:"#e2e8f0" }}>
            <div style={{ fontSize:"12px", fontWeight:800, color:"#38bdf8",
              letterSpacing:".06em", textTransform:"uppercase", marginBottom:"10px" }}>
              💡 Tips
            </div>
            {[
              "Download the template first to see the correct format.",
              "The first row must be the column header — don't modify it.",
              "Import Goals before Tasks if you want to link them via IDs.",
              "Rows with blank name / title are silently skipped.",
              "Export your current data, edit it in Excel, then re-import.",
              "IDs in projectId / linkedGoalId must match existing records.",
            ].map((tip, i) => (
              <div key={i} style={{ display:"flex", gap:"8px", marginBottom:"8px",
                fontSize:"11px", lineHeight:1.5 }}>
                <span style={{ color:"#38bdf8", flexShrink:0, marginTop:"1px" }}>→</span>
                <span style={{ color:"#94a3b8" }}>{tip}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform:rotate(360deg); } }`}</style>
    </div>
  );
}

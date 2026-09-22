import { useState } from "react";
import { unwrapList } from "../api/client";
import { bulkImportTasks } from "../api/tasks";
import { getProjects } from "../api/projects";
import { useEffect } from "react";
import PageHeader from "../components/PageHeader";
import { useToast } from "../components/ToastContext";

// Field mappings for Asana CSV format
const NOTION_MAP = {
  "Name": "title", "Status": "status", "Assignee": "assignee",
  "Due date": "dueDate", "Tags": "tags", "Priority": "priority",
  "Notes": "description",
};
const MONDAY_MAP = {
  "Name": "title", "Status": "status", "Person": "assignee",
  "Date": "dueDate", "Tags": "tags", "Priority": "priority",
  "Notes": "description", "Column": "status",
};
const ASANA_MAP = {
  "Task Name": "title", "Name": "title",
  "Notes": "description", "Description": "description",
  "Assignee": "assignee", "Due Date": "dueDate",
  "Priority": "priority", "Status": "status",
  "Tags": "tags", "Section/Column": "status",
};

// Field mappings for ClickUp CSV format
const CLICKUP_MAP = {
  "Task Name": "title", "Task name": "title",
  "Description": "description", "Assignee": "assignee",
  "Due Date": "dueDate", "Priority": "priority",
  "Status": "status", "Tags": "tags",
};

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map(line => {
    const vals = [];
    let cur = "", inQuote = false;
    for (const ch of line) {
      if (ch === '"') inQuote = !inQuote;
      else if (ch === "," && !inQuote) { vals.push(cur); cur = ""; }
      else cur += ch;
    }
    vals.push(cur);
    const row = {};
    headers.forEach((h, i) => row[h] = (vals[i] || "").trim().replace(/^"|"$/g, ""));
    return row;
  }).filter(r => Object.values(r).some(v => v));
}

function mapRow(row, mapping, projectId) {
  const mapped = {};
  for (const [csvKey, appKey] of Object.entries(mapping)) {
    if (row[csvKey] !== undefined && row[csvKey] !== "") {
      mapped[appKey] = row[csvKey];
    }
  }
  // Normalize
  if (mapped.status) {
    const s = mapped.status.toLowerCase();
    mapped.status = s.includes("done") || s.includes("complete") || s.includes("closed")
      ? "DONE" : s.includes("progress") || s.includes("doing") || s.includes("active")
      ? "IN_PROGRESS" : "TODO";
  }
  if (mapped.priority) {
    const p = mapped.priority.toLowerCase();
    mapped.priority = p.includes("high") || p.includes("urgent") ? "HIGH"
      : p.includes("low") ? "LOW" : "MEDIUM";
  }
  if (!mapped.title) return null;
  if (projectId) mapped.projectId = projectId;
  return mapped;
}

const SAMPLE_CSV = `Task Name,Description,Status,Priority,Due Date
Design landing page,Create mockups for the new landing page,In Progress,High,2026-07-01
Set up CI/CD pipeline,Configure GitHub Actions,Todo,Medium,2026-07-15
Write API documentation,Document all REST endpoints,Todo,Low,
Fix login bug,Users can't log in on mobile,Done,High,2026-06-20`;

export default function Importer() {
  const [step, setStep]         = useState("upload");  // upload | preview | done
  const [source, setSource]     = useState("csv");      // csv | asana | clickup | json
  const [rawText, setRawText]   = useState("");
  const [parsed, setParsed]     = useState([]);
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult]     = useState(null);
  const [error, setError]       = useState("");
  const { show: showToast }     = useToast();

  useEffect(() => {
    getProjects().then(r => setProjects(unwrapList(r))).catch(() => {});
  }, []);

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setRawText(ev.target.result);
    reader.readAsText(file);
  };

  const handleParse = () => {
    setError("");
    try {
      let rows = [];
      if (source === "json") {
        const parsed = JSON.parse(rawText);
        rows = Array.isArray(parsed) ? parsed : [parsed];
      } else {
        const csvRows = parseCSV(rawText);
        const mapping = source === "asana"   ? ASANA_MAP
          : source === "clickup" ? CLICKUP_MAP
          : source === "notion"  ? NOTION_MAP
          : source === "monday"  ? MONDAY_MAP
          : ASANA_MAP;
        rows = csvRows.map(r => mapRow(r, mapping, projectId)).filter(Boolean);
      }
      if (!rows.length) { setError("No valid rows found. Check the file format."); return; }
      setParsed(rows);
      setStep("preview");
    } catch (e) {
      setError("Failed to parse file: " + e.message);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      const toImport = parsed.map(r => ({ ...r, projectId: projectId || r.projectId }));
      const res = await bulkImportTasks(toImport);
      setResult(unwrapList(res));
      setStep("done");
      showToast(`Imported ${res.data.created} tasks`, "success");
    } catch (e) {
      setError("Import failed: " + (e.response?.data?.message || e.message));
    } finally {
      setImporting(false);
    }
  };

  const reset = () => {
    setStep("upload"); setRawText(""); setParsed([]);
    setResult(null); setError(""); setProjectId("");
  };

  return (
    <div>
      <PageHeader
        icon="📥"
        title="Import Tasks"
        description="Import tasks from Asana, ClickUp, Notion, Monday.com, or any CSV/JSON file"
      />

      {/* Step indicator */}
      <div className="importer-steps">
        {["upload", "preview", "done"].map((s, i) => (
          <div key={s} className={`importer-step${step === s ? " active" : step > s ? " done-step" : ""}`}>
            <div className="importer-step-num">{i + 1}</div>
            <div className="importer-step-label">
              {s === "upload" ? "Upload File" : s === "preview" ? "Preview & Map" : "Done"}
            </div>
            {i < 2 && <div className="importer-step-line" />}
          </div>
        ))}
      </div>

      {/* Step 1: Upload */}
      {step === "upload" && (
        <div className="importer-card">
          <div className="importer-source-row">
            {["asana","clickup","notion","monday","csv","json"].map(s => (
              <button key={s}
                className={`importer-source-btn${source === s ? " active" : ""}`}
                onClick={() => setSource(s)}>
                {s === "asana" ? "🟥 Asana CSV" : s === "clickup" ? "🟣 ClickUp CSV"
                  : s === "notion" ? "⬛ Notion CSV" : s === "monday" ? "🔴 Monday.com CSV"
                  : s === "csv" ? "📄 Generic CSV" : "📋 JSON"}
              </button>
            ))}
          </div>

          <div className="form-group">
            <label htmlFor={"importer-target-project-optional"}>Target Project (optional)</label>
            <select value={projectId} onChange={e => setProjectId(e.target.value)} id={"importer-target-project-optional"}>
              <option value="">— No specific project —</option>
              {projects.filter(p => !p.parentProjectId).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor={"importer-upload-file"}>Upload File</label>
            <div className="importer-file-area">
              <input type="file" accept={source === "json" ? ".json" : ".csv,.txt"}
                onChange={handleFile} style={{ marginBottom:"10px" }} id={"importer-upload-file"} />
              <div style={{ fontSize:"12px", color:"var(--gray-400)" }}>
                {source === "asana" ? "Export from Asana: Project → Export → CSV" :
                 source === "clickup" ? "Export from ClickUp: List → Export → CSV" :
                 source === "notion" ? "Export from Notion: Database → ⋯ → Export → CSV (current view)" :
                 source === "monday" ? "Export from Monday.com: Board → ⋮ → Export board data → Excel/CSV" :
                 source === "json" ? "JSON array of task objects [{title, description, status, priority}]" :
                 "CSV with columns: Task Name, Description, Status, Priority, Due Date"}
              </div>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor={"importer-or-paste-raw-text"}>Or paste raw text</label>
            <textarea rows={8} className="importer-textarea"
              value={rawText} onChange={e => setRawText(e.target.value)}
              placeholder={`Paste CSV or JSON here…\n\nExample CSV:\n${SAMPLE_CSV}`} id={"importer-or-paste-raw-text"} />
          </div>

          {error && <div className="auth-error">⚠ {error}</div>}

          <div style={{ display:"flex", gap:"10px" }}>
            <button className="btn-secondary" onClick={() => { setRawText(SAMPLE_CSV); setSource("csv"); }}>
              Load Sample Data
            </button>
            <button className="btn-primary" disabled={!rawText.trim()} onClick={handleParse}>
              Preview Import →
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Preview */}
      {step === "preview" && (
        <div className="importer-card">
          <div className="importer-preview-header">
            <span className="importer-preview-count">
              {parsed.length} task{parsed.length !== 1 ? "s" : ""} ready to import
            </span>
            <button className="btn-secondary" style={{ fontSize:"12px" }} onClick={reset}>
              ← Back
            </button>
          </div>

          <div className="importer-preview-table-wrap">
            <table className="importer-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {parsed.slice(0, 50).map((row, i) => (
                  <tr key={i}>
                    <td className="importer-table-num">{i + 1}</td>
                    <td className="importer-table-title">{row.title}</td>
                    <td>
                      <span className={`importer-status importer-status-${(row.status||"TODO").toLowerCase()}`}>
                        {row.status || "TODO"}
                      </span>
                    </td>
                    <td>
                      <span className={`importer-priority importer-priority-${(row.priority||"MEDIUM").toLowerCase()}`}>
                        {row.priority || "MEDIUM"}
                      </span>
                    </td>
                    <td className="importer-table-desc">{row.description || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parsed.length > 50 && (
              <div style={{ padding:"8px 16px", fontSize:"12px", color:"var(--gray-400)", textAlign:"center" }}>
                Showing first 50 of {parsed.length} rows
              </div>
            )}
          </div>

          {error && <div className="auth-error">⚠ {error}</div>}

          <div style={{ display:"flex", gap:"10px", marginTop:"16px" }}>
            <button className="btn-secondary" onClick={reset}>← Start Over</button>
            <button className="btn-primary" disabled={importing} onClick={handleImport}>
              {importing ? "⏳ Importing…" : `🚀 Import ${parsed.length} Tasks`}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Done */}
      {step === "done" && result && (
        <div className="importer-card importer-done-card">
          <div className="importer-done-icon">✅</div>
          <h2 className="importer-done-title">Import Complete</h2>
          <div className="importer-done-stats">
            <div className="importer-done-stat">
              <span className="importer-done-num" style={{ color:"var(--success)" }}>{result.created}</span>
              <span className="importer-done-label">Tasks created</span>
            </div>
            {result.skipped > 0 && (
              <div className="importer-done-stat">
                <span className="importer-done-num" style={{ color:"var(--warning)" }}>{result.skipped}</span>
                <span className="importer-done-label">Skipped</span>
              </div>
            )}
          </div>
          <div style={{ display:"flex", gap:"10px", justifyContent:"center" }}>
            <button className="btn-secondary" onClick={reset}>Import More</button>
            <button className="btn-primary" onClick={() => window.location.href = "/tasks"}>
              View Tasks →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

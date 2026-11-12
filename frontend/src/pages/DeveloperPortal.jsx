import { useState, useEffect } from "react";
import { unwrapList } from "../api/client";
import PageHeader from "../components/PageHeader";
import {
  getWebhooks, createWebhook, updateWebhook, deleteWebhook, testWebhook, regenSecret,
  getApiKeys,  createApiKey,  revokeApiKey,  deleteApiKey,
} from "../api/developer";
import "../styles/pages/developer.css";
import { useConfirm } from "../hooks/useConfirm";

const ALL_EVENTS = [
  "TASK_CREATED", "TASK_UPDATED", "TASK_COMPLETED", "TASK_DELETED",
  "TASK_STATUS_CHANGED", "TASK_PRIORITY_CHANGED", "TASK_COMMENTED",
  "PROJECT_CREATED", "PROJECT_UPDATED", "PROJECT_DELETED",
  "GOAL_CREATED", "GOAL_PROGRESS_CHANGED", "GOAL_COMPLETED",
];

const ALL_SCOPES = [
  "read:tasks", "write:tasks",
  "read:projects", "write:projects",
  "read:goals", "write:goals",
  "read:team", "read:analytics",
];

// ── Webhook form ──────────────────────────────────────────────
function WebhookForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(
    initial || { name: "", url: "", events: ["*"], active: true }
  );
  const [saving, setSaving] = useState(false);
  const all = form.events?.includes("*");

  const toggleEvent = (e) => {
    if (all) {
      setForm(f => ({ ...f, events: ALL_EVENTS.filter(x => x !== e) }));
    } else if (form.events.includes(e)) {
      const next = form.events.filter(x => x !== e);
      setForm(f => ({ ...f, events: next.length ? next : ["*"] }));
    } else {
      setForm(f => ({ ...f, events: [...f.events, e] }));
    }
  };

  const submit = async () => {
    if (!form.name.trim() || !form.url.trim()) return;
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  return (
    <div className="dev-form-overlay" onClick={onCancel} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (onCancel)?.(e); } }}>
      <div className="dev-form" onClick={e => e.stopPropagation()} role="presentation">
        <h3 className="dev-form-title">{initial ? "Edit Webhook" : "New Webhook"}</h3>

        <div className="form-group">
          <label htmlFor={"developer-portal-name"}>Name</label>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Slack Notifications" id={"developer-portal-name"} />
        </div>
        <div className="form-group">
          <label htmlFor={"developer-portal-endpoint-url"}>Endpoint URL</label>
          <input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
            placeholder="https://your-server.com/hooks/prowosma" id={"developer-portal-endpoint-url"} />
        </div>

        <div className="form-group">
          <label htmlFor={"developer-portal-events-to-send"}>Events to send</label>
          <div className="dev-event-grid">
            <label className="dev-event-chip dev-event-all">
              <input type="checkbox" checked={all}
                onChange={() => setForm(f => ({ ...f, events: all ? [] : ["*"] }))} id={"developer-portal-events-to-send"} />
              ✦ All events
            </label>
            {ALL_EVENTS.map(ev => (
              <label key={ev} className={`dev-event-chip ${(all || form.events?.includes(ev)) ? "checked" : ""}`}>
                <input type="checkbox"
                  checked={all || form.events?.includes(ev)}
                  onChange={() => toggleEvent(ev)} />
                {ev.replace(/_/g, " ").toLowerCase()}
              </label>
            ))}
          </div>
        </div>

        <div className="form-group" style={{ flexDirection: "row", alignItems: "center", gap: "10px" }}>
          <input type="checkbox" id="wh-active" checked={form.active}
            onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
          <label htmlFor="wh-active" style={{ margin: 0 }}>Active</label>
        </div>

        <div className="form-actions">
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={saving}>
            {saving ? "Saving…" : "Save Webhook"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── API Key form ──────────────────────────────────────────────
function ApiKeyForm({ onSave, onCancel }) {
  const [form, setForm] = useState({ name: "", scopes: ["read:tasks", "read:projects"] });
  const [saving, setSaving] = useState(false);

  const toggleScope = (s) => {
    setForm(f => ({
      ...f,
      scopes: f.scopes.includes(s) ? f.scopes.filter(x => x !== s) : [...f.scopes, s],
    }));
  };

  const submit = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  return (
    <div className="dev-form-overlay" onClick={onCancel} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (onCancel)?.(e); } }}>
      <div className="dev-form" onClick={e => e.stopPropagation()} role="presentation">
        <h3 className="dev-form-title">Create API Key</h3>
        <div className="form-group">
          <label htmlFor={"developer-portal-key-name"}>Key Name</label>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="e.g. CI/CD Pipeline, Mobile App" id={"developer-portal-key-name"} />
        </div>
        <div className="form-group">
          <fieldset style={{ border: "none", margin: 0, padding: 0 }}>
            <legend style={{ padding: 0, marginBottom: 4 }}>Permissions (scopes)</legend>
            <div className="dev-event-grid">
              {ALL_SCOPES.map(s => (
                <label key={s} className={`dev-event-chip ${form.scopes.includes(s) ? "checked" : ""}`}>
                  <input type="checkbox" checked={form.scopes.includes(s)} onChange={() => toggleScope(s)} />
                  {s}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="form-actions">
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={saving}>
            {saving ? "Creating…" : "Create Key"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── New key reveal modal ──────────────────────────────────────
function NewKeyModal({ apiKey, onClose }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(apiKey.key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="dev-form-overlay" onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (onClose)?.(e); } }}>
      <div className="dev-form" onClick={e => e.stopPropagation()} role="presentation">
        <h3 className="dev-form-title">API Key Created</h3>
        <div className="dev-key-reveal-banner">
          Copy this key now. It will never be shown again.
        </div>
        <div className="dev-key-reveal-box">
          <code className="dev-key-code">{apiKey.key}</code>
          <button className="btn-secondary" style={{ fontSize: "12px" }} onClick={copy}>
            {copied ? "✓ Copied" : "Copy"}
          </button>
        </div>
        <p style={{ fontSize: "12px", color: "var(--gray-500)", marginTop: "12px" }}>
          Store this key securely. Use it in the <code>Authorization: Bearer {"<key>"}</code> header.
        </p>
        <div className="form-actions">
          <button className="btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────
export default function DeveloperPortal() {
  const confirm = useConfirm();
  const [tab, setTab]             = useState("webhooks");
  const [webhooks, setWebhooks]   = useState([]);
  const [apiKeys, setApiKeys]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showWhForm, setShowWhForm]     = useState(false);
  const [editingWh, setEditingWh]       = useState(null);
  const [showKeyForm, setShowKeyForm]   = useState(false);
  const [newKey, setNewKey]             = useState(null);
  const [toast, setToast]               = useState("");
  const [revealSecret, setRevealSecret] = useState({});
  const [testResults, setTestResults]   = useState({});

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const load = async () => {
    setLoading(true);
    try {
      const [wh, keys] = await Promise.all([getWebhooks(), getApiKeys()]);
      setWebhooks(unwrapList(wh));
      setApiKeys(unwrapList(keys));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard load-on-mount pattern
  useEffect(() => { load(); }, []);

  // Webhooks handlers
  const handleSaveWebhook = async (form) => {
    if (editingWh) {
      await updateWebhook(editingWh.id, form);
      showToast("Webhook updated");
    } else {
      await createWebhook(form);
      showToast("Webhook created");
    }
    setShowWhForm(false); setEditingWh(null);
    load();
  };
  const handleDeleteWh = async (id) => {
    if (!(await confirm({ title: "Delete this webhook?", danger: true, confirmText: "Delete" }))) return;
    await deleteWebhook(id); showToast("Webhook deleted"); load();
  };
  const handleTest = async (id) => {
    setTestResults(r => ({ ...r, [id]: "sending" }));
    try {
      await testWebhook(id);
      setTestResults(r => ({ ...r, [id]: "sent" }));
    } catch { setTestResults(r => ({ ...r, [id]: "failed" })); }
    setTimeout(() => setTestResults(r => { const n = { ...r }; delete n[id]; return n; }), 4000);
  };
  const handleRegenSecret = async (id) => {
    if (!(await confirm({ title: "Regenerate secret?", message: "Old signatures will stop verifying.", confirmText: "Regenerate" }))) return;
    await regenSecret(id); showToast("Secret regenerated"); load();
  };

  // API Keys handlers
  const handleCreateKey = async (form) => {
    const res = await createApiKey(form);
    setNewKey(unwrapList(res));
    setShowKeyForm(false);
    load();
  };
  const handleRevokeKey = async (id) => {
    await revokeApiKey(id); showToast("Key revoked"); load();
  };
  const handleDeleteKey = async (id) => {
    if (!(await confirm({ title: "Delete this API key?", danger: true, confirmText: "Delete" }))) return;
    await deleteApiKey(id); showToast("Key deleted"); load();
  };

  const SWAGGER_URL = `${import.meta.env.VITE_API_URL || "http://localhost:9090"}/swagger-ui.html`;

  return (
    <div>
      <PageHeader icon="⚙️" title="Developer Portal"
        description="Webhooks, API keys, and REST API documentation"
        action={<a href={SWAGGER_URL} target="_blank" rel="noreferrer"
          className="btn-secondary" style={{ fontSize: "12px", textDecoration: "none" }}>
          Open API Docs ↗
        </a>} />

      {toast && <div className="dev-toast">{toast}</div>}

      {/* Tabs */}
      <div className="tab-bar" style={{ marginBottom: "20px" }}>
        <button className={"tab-btn" + (tab === "webhooks" ? " tab-active" : "")} onClick={() => setTab("webhooks")}>
          Webhooks <span className="dev-tab-count">{webhooks.length}</span>
        </button>
        <button className={"tab-btn" + (tab === "keys" ? " tab-active" : "")} onClick={() => setTab("keys")}>
          API Keys <span className="dev-tab-count">{apiKeys.length}</span>
        </button>
        <button className={"tab-btn" + (tab === "docs" ? " tab-active" : "")} onClick={() => setTab("docs")}>
          API Docs
        </button>
      </div>

      {/* ── Webhooks tab ── */}
      {tab === "webhooks" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--gray-800)" }}>Outbound Webhooks</div>
              <div style={{ fontSize: "12px", color: "var(--gray-400)", marginTop: "2px" }}>
                Prowosma sends an HTTPS POST to your URL when events occur. Payloads are signed with HMAC-SHA256.
              </div>
            </div>
            <button className="btn-primary" style={{ fontSize: "13px" }}
              onClick={() => { setEditingWh(null); setShowWhForm(true); }}>
              + New Webhook
            </button>
          </div>

          {loading ? <div className="empty-state">Loading…</div>
          : webhooks.length === 0 ? (
            <div className="dev-empty">
              <div style={{ fontSize: "40px", marginBottom: "12px" }}>🔗</div>
              <div style={{ fontWeight: 600, marginBottom: "6px" }}>No webhooks yet</div>
              <div style={{ fontSize: "13px", color: "var(--gray-400)" }}>
                Create a webhook to receive real-time events in your own systems.
              </div>
            </div>
          ) : (
            <div className="dev-list">
              {webhooks.map(wh => (
                <div key={wh.id} className={`dev-card ${!wh.active ? "dev-card-inactive" : ""}`}>
                  <div className="dev-card-header">
                    <div className="dev-card-left">
                      <span className={`dev-status-dot ${wh.active ? "active" : "inactive"}`} />
                      <div>
                        <div className="dev-card-name">{wh.name}</div>
                        <div className="dev-card-url">{wh.url}</div>
                      </div>
                    </div>
                    <div className="dev-card-actions">
                      <span className="dev-stat">↑ {wh.totalFired || 0}</span>
                      {wh.lastStatus && (
                        <span className={`dev-last-status ${wh.lastStatus === "FAILED" ? "failed" : "ok"}`}>
                          {wh.lastStatus}
                        </span>
                      )}
                      <button className="btn-secondary" style={{ fontSize: "11px", padding: "4px 10px" }}
                        onClick={() => handleTest(wh.id)}>
                        {testResults[wh.id] === "sending" ? "⏳" : testResults[wh.id] === "sent" ? "✓ Sent" : testResults[wh.id] === "failed" ? "✗ Failed" : "▶ Test"}
                      </button>
                      <button className="btn-secondary" style={{ fontSize: "11px", padding: "4px 10px" }}
                        onClick={() => { setEditingWh(wh); setShowWhForm(true); }}>
                        Edit
                      </button>
                      <button className="btn-secondary" style={{ fontSize: "11px", padding: "4px 10px", color: "var(--danger)" }}
                        onClick={() => handleDeleteWh(wh.id)}>
                        🗑️
                      </button>
                    </div>
                  </div>

                  <div className="dev-card-body">
                    <div className="dev-events-row">
                      {wh.events?.includes("*")
                        ? <span className="dev-event-tag dev-event-all">All events</span>
                        : wh.events?.slice(0, 6).map(e => (
                            <span key={e} className="dev-event-tag">{e.replace(/_/g, " ").toLowerCase()}</span>
                          ))}
                      {!wh.events?.includes("*") && wh.events?.length > 6 && (
                        <span className="dev-event-tag">+{wh.events.length - 6} more</span>
                      )}
                    </div>
                    <div className="dev-secret-row">
                      <span style={{ fontSize: "11px", color: "var(--gray-400)" }}>Signing secret:</span>
                      <code className="dev-secret-val">
                        {revealSecret[wh.id] ? wh.secret : "whsec_••••••••••••••••••"}
                      </code>
                      <button className="btn-link" style={{ fontSize: "11px" }}
                        onClick={() => setRevealSecret(r => ({ ...r, [wh.id]: !r[wh.id] }))}>
                        {revealSecret[wh.id] ? "Hide" : "Reveal"}
                      </button>
                      <button className="btn-link" style={{ fontSize: "11px" }}
                        onClick={() => handleRegenSecret(wh.id)}>
                        ↺ Regenerate
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── API Keys tab ── */}
      {tab === "keys" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--gray-800)" }}>API Keys</div>
              <div style={{ fontSize: "12px", color: "var(--gray-400)", marginTop: "2px" }}>
                Use these keys to authenticate REST API requests. Pass as <code style={{ fontSize: "11px" }}>Authorization: Bearer {"<key>"}</code>
              </div>
            </div>
            <button className="btn-primary" style={{ fontSize: "13px" }} onClick={() => setShowKeyForm(true)}>
              + Create Key
            </button>
          </div>

          {loading ? <div className="empty-state">Loading…</div>
          : apiKeys.length === 0 ? (
            <div className="dev-empty">
              <div style={{ fontSize: "40px", marginBottom: "12px" }}>🔑</div>
              <div style={{ fontWeight: 600, marginBottom: "6px" }}>No API keys yet</div>
              <div style={{ fontSize: "13px", color: "var(--gray-400)" }}>
                Create a key to integrate with Prowosma from your own applications.
              </div>
            </div>
          ) : (
            <div className="dev-list">
              {apiKeys.map(k => (
                <div key={k.id} className={`dev-card ${!k.active ? "dev-card-inactive" : ""}`}>
                  <div className="dev-card-header">
                    <div className="dev-card-left">
                      <span className={`dev-status-dot ${k.active ? "active" : "inactive"}`} />
                      <div>
                        <div className="dev-card-name">{k.name}</div>
                        <code className="dev-card-url">{k.keyPrefix}</code>
                      </div>
                    </div>
                    <div className="dev-card-actions">
                      {k.lastUsedAt && (
                        <span className="dev-stat">
                          Last used {new Date(k.lastUsedAt).toLocaleDateString()}
                        </span>
                      )}
                      {k.active ? (
                        <button className="btn-secondary" style={{ fontSize: "11px", padding: "4px 10px", color: "var(--warning)" }}
                          onClick={() => handleRevokeKey(k.id)}>
                          Revoke
                        </button>
                      ) : (
                        <span className="dev-last-status failed">Revoked</span>
                      )}
                      <button className="btn-secondary" style={{ fontSize: "11px", padding: "4px 10px", color: "var(--danger)" }}
                        onClick={() => handleDeleteKey(k.id)}>
                        🗑️
                      </button>
                    </div>
                  </div>
                  <div className="dev-card-body">
                    <div className="dev-events-row">
                      {k.scopes?.map(s => (
                        <span key={s} className={`dev-event-tag ${s.startsWith("write") ? "dev-scope-write" : "dev-scope-read"}`}>
                          {s}
                        </span>
                      ))}
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--gray-400)", marginTop: "4px" }}>
                      Created {new Date(k.createdAt).toLocaleDateString()}
                      {k.createdBy && ` by ${k.createdBy.split("@")[0]}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── API Docs tab ── */}
      {tab === "docs" && (
        <div className="dev-docs">
          <div className="dev-docs-header">
            <h3>REST API Reference</h3>
            <p>Prowosma exposes a full REST API. All endpoints are documented interactively via Swagger UI.</p>
            <a href={SWAGGER_URL} target="_blank" rel="noreferrer" className="btn-primary"
              style={{ display: "inline-flex", alignItems: "center", gap: "8px", textDecoration: "none", marginTop: "12px" }}>
              Open Swagger UI ↗
            </a>
          </div>

          <div className="dev-docs-sections">
            {[
              { icon: "✅", name: "Tasks",     base: "/api/tasks",     methods: ["GET", "POST", "PUT", "DELETE", "PATCH"] },
              { icon: "📁", name: "Projects",  base: "/api/projects",  methods: ["GET", "POST", "PUT", "DELETE"] },
              { icon: "🎯", name: "Goals",     base: "/api/goals",     methods: ["GET", "POST", "PUT", "DELETE", "PATCH"] },
              { icon: "👥", name: "Team",      base: "/api/team",      methods: ["GET", "POST", "PUT", "DELETE"] },
              { icon: "📊", name: "Analytics", base: "/api/analytics", methods: ["GET"] },
              { icon: "🔗", name: "Webhooks",  base: "/api/webhooks",  methods: ["GET", "POST", "PUT", "DELETE"] },
              { icon: "🔑", name: "API Keys",  base: "/api/keys",      methods: ["GET", "POST", "DELETE"] },
              { icon: "🔔", name: "Notifications", base: "/api/notifications", methods: ["GET", "PUT", "DELETE"] },
            ].map((s, i) => (
              <div key={i} className="dev-docs-card">
                <div className="dev-docs-card-title">{s.icon} {s.name}</div>
                <code className="dev-docs-base">{s.base}</code>
                <div className="dev-docs-methods">
                  {s.methods.map(m => (
                    <span key={m} className={`dev-method dev-method-${m.toLowerCase()}`}>{m}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="dev-docs-auth">
            <h4>Authentication</h4>
            <p>All API requests require a valid JWT token or API key in the Authorization header:</p>
            <pre className="dev-code-block">{`Authorization: Bearer <your-api-key-or-jwt>
X-Workspace-Id: <your-workspace-id>`}</pre>
            <h4>Webhook Verification</h4>
            <p>Verify webhook payloads using the signing secret:</p>
            <pre className="dev-code-block">{`// Node.js example
const crypto = require('crypto');
const sig = req.headers['x-prowosma-signature'];
const expected = 'sha256=' + crypto
  .createHmac('sha256', YOUR_WEBHOOK_SECRET)
  .update(req.rawBody)
  .digest('hex');
const valid = crypto.timingSafeEqual(
  Buffer.from(sig), Buffer.from(expected)
);`}</pre>
          </div>
        </div>
      )}

      {/* Forms & Modals */}
      {showWhForm && (
        <WebhookForm
          initial={editingWh}
          onSave={handleSaveWebhook}
          onCancel={() => { setShowWhForm(false); setEditingWh(null); }}
        />
      )}
      {showKeyForm && (
        <ApiKeyForm onSave={handleCreateKey} onCancel={() => setShowKeyForm(false)} />
      )}
      {newKey && (
        <NewKeyModal apiKey={newKey} onClose={() => setNewKey(null)} />
      )}
    </div>
  );
}

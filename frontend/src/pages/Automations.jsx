import client, { unwrapList } from "../api/client";
import { useState, useEffect } from "react";
import {
  getAutomations, createAutomation, updateAutomation,
  deleteAutomation, toggleAutomation, testAutomation,
  getApprovals, createApproval, respondApproval, escalateApproval,
} from "../api/automations";
import PageHeader from "../components/PageHeader";
import { useToast } from "../components/ToastContext";
import { useConfirm } from "../hooks/useConfirm";

// ── Meta definitions ──────────────────────────────────────────
const TRIGGER_META = [
  { value:"TASK_CREATED",           label:"Task Created",           icon:"✅", group:"Tasks" },
  { value:"TASK_STATUS_CHANGED",    label:"Task Status Changed",    icon:"🔄", group:"Tasks" },
  { value:"TASK_OVERDUE",           label:"Task Becomes Overdue",   icon:"⚠️", group:"Tasks" },
  { value:"TASK_ASSIGNED",          label:"Task Assigned",          icon:"👤", group:"Tasks" },
  { value:"PROJECT_STATUS_CHANGED", label:"Project Status Changed", icon:"📁", group:"Projects" },
  { value:"GOAL_ACHIEVED",          label:"Goal Achieved",          icon:"🎯", group:"Goals" },
  { value:"SPRINT_STARTED",         label:"Sprint Started",         icon:"🏃", group:"Agile" },
  { value:"SPRINT_COMPLETED",       label:"Sprint Completed",       icon:"🏁", group:"Agile" },
  { value:"APPROVAL_APPROVED",      label:"Approval Approved",      icon:"✔️", group:"Approvals" },
  { value:"APPROVAL_REJECTED",      label:"Approval Rejected",      icon:"✖️", group:"Approvals" },
  { value:"SCHEDULED",              label:"Scheduled (Cron)",        icon:"⏰", group:"Scheduled" },
  { value:"INBOUND_WEBHOOK",         label:"Inbound Webhook",         icon:"📥", group:"Webhooks" },
];

const CONDITION_FIELDS = [
  { value:"status",   label:"Status" },
  { value:"priority", label:"Priority" },
  { value:"assignee", label:"Assignee" },
  { value:"tag",      label:"Tag" },
  { value:"title",    label:"Title" },
];
const CONDITION_OPS = [
  { value:"equals",       label:"equals" },
  { value:"not_equals",   label:"does not equal" },
  { value:"contains",     label:"contains" },
  { value:"is_empty",     label:"is empty" },
  { value:"is_not_empty", label:"is not empty" },
];

const ACTION_META = [
  { value:"SEND_NOTIFICATION", label:"Send Notification",  icon:"🔔", group:"Notifications" },
  { value:"CHANGE_STATUS",     label:"Change Task Status", icon:"🔄", group:"Tasks" },
  { value:"CHANGE_PRIORITY",   label:"Change Priority",    icon:"🔥", group:"Tasks" },
  { value:"ADD_TAG",           label:"Add Tag",            icon:"🏷",  group:"Tasks" },
  { value:"POST_COMMENT",      label:"Post Comment",       icon:"💬", group:"Tasks" },
  { value:"REQUEST_APPROVAL",  label:"Request Approval",   icon:"✅", group:"Approvals" },
  { value:"AI_SUMMARISE",      label:"AI: Summarise",      icon:"🤖", group:"AI Actions" },
  { value:"AI_RISK_CHECK",     label:"AI: Risk Check",     icon:"⚠️", group:"AI Actions" },
  { value:"AI_ASSIGN",         label:"AI: Smart Assign",   icon:"👤", group:"AI Actions" },
  { value:"START_BPM",         label:"Start BPM Process",  icon:"🔀", group:"BPM" },
];

const WORKFLOW_TEMPLATES = [
  {
    name: "Task Overdue Alert",
    description: "Notify team when a task becomes overdue",
    icon: "⏰",
    triggerType: "TASK_OVERDUE",
    conditions: [],
    actions: [{ id:"1", type:"SEND_NOTIFICATION", config:{ title:"Task Overdue", message:"Task {{title}} is now overdue" } }],
  },
  {
    name: "High Priority Auto-Assign",
    description: "Post a comment when a high-priority task is created",
    icon: "🚨",
    triggerType: "TASK_CREATED",
    conditions: [{ id:"1", field:"priority", operator:"equals", value:"HIGH" }],
    actions: [{ id:"1", type:"POST_COMMENT", config:{ comment:"🚨 This is a high-priority task. Please action immediately." } }],
  },
  {
    name: "Sprint Start Notification",
    description: "Notify everyone when a new sprint begins",
    icon: "🏃",
    triggerType: "SPRINT_STARTED",
    conditions: [],
    actions: [{ id:"1", type:"SEND_NOTIFICATION", config:{ title:"Sprint Started", message:"A new sprint has begun. Check your backlog!" } }],
  },
  {
    name: "Goal Achievement Celebration",
    description: "Post a comment when a goal is achieved",
    icon: "🎉",
    triggerType: "GOAL_ACHIEVED",
    conditions: [],
    actions: [
      { id:"1", type:"SEND_NOTIFICATION", config:{ title:"Goal Achieved! 🎉", message:"Goal {{title}} has been completed!" } },
    ],
  },
  {
    name: "Approval Required on Done",
    description: "Request approval before marking a task as done",
    icon: "✅",
    triggerType: "TASK_STATUS_CHANGED",
    conditions: [{ id:"1", field:"status", operator:"equals", value:"DONE" }],
    actions: [{ id:"1", type:"REQUEST_APPROVAL", config:{ title:"Approve task completion", approvers:[], chainType:"SEQUENTIAL", slaHours:24 } }],
  },
  {
    name: "Change Request Approval",
    description: "Multi-step approval chain for change requests",
    icon: "📋",
    triggerType: "TASK_CREATED",
    conditions: [{ id:"1", field:"tag", operator:"contains", value:"change-request" }],
    actions: [{ id:"1", type:"REQUEST_APPROVAL", config:{ title:"Change Request Review", approvers:[], chainType:"SEQUENTIAL", slaHours:48 } }],
  },
];

const STATUS_META = {
  PENDING:   { label:"Pending",   color:"var(--warning)", bg:"rgba(217,119,6,0.12)" },
  APPROVED:  { label:"Approved",  color:"var(--success)", bg:"rgba(5,150,105,0.12)" },
  REJECTED:  { label:"Rejected",  color:"var(--danger)", bg:"rgba(239,68,68,0.12)" },
  ESCALATED: { label:"Escalated", color:"var(--purple)", bg:"rgba(139,92,246,0.12)" },
  CANCELLED: { label:"Cancelled", color:"var(--gray-500)", bg:"rgba(107,114,128,0.12)" },
};

// ── Condition Editor ─────────────────────────────────────────
function ConditionEditor({ conditions, operator, onChange, onOperatorChange }) {
  const addCondition = () => onChange([
    ...conditions,
    { id: Date.now().toString(), field:"status", operator:"equals", value:"" }
  ]);

  const updateCondition = (id, key, val) =>
    onChange(conditions.map(c => c.id === id ? { ...c, [key]: val } : c));

  const removeCondition = (id) =>
    onChange(conditions.filter(c => c.id !== id));

  return (
    <div className="auto-conditions">
      <div className="auto-section-header">
        <span className="auto-section-label">🔍 Conditions</span>
        {conditions.length > 1 && (
          <div className="auto-operator-toggle">
            {["AND","OR"].map(op => (
              <button key={op}
                className={`auto-op-btn${operator === op ? " active" : ""}`}
                onClick={() => onOperatorChange(op)}>
                {op}
              </button>
            ))}
          </div>
        )}
        <button className="auto-add-btn" onClick={addCondition}>+ Add Condition</button>
      </div>

      {conditions.length === 0 && (
        <div className="auto-empty-conditions">
          No conditions — automation runs on every trigger event.
        </div>
      )}

      {conditions.map((c, i) => (
        <div key={c.id} className="auto-condition-row">
          {i > 0 && <div className="auto-condition-op">{operator}</div>}
          <select value={c.field} onChange={e => updateCondition(c.id, "field", e.target.value)}>
            {CONDITION_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          <select value={c.operator} onChange={e => updateCondition(c.id, "operator", e.target.value)}>
            {CONDITION_OPS.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
          </select>
          {!["is_empty","is_not_empty"].includes(c.operator) && (
            <input value={c.value || ""} placeholder="Value"
              onChange={e => updateCondition(c.id, "value", e.target.value)} />
          )}
          <button className="auto-remove-btn" onClick={() => removeCondition(c.id)}>✕</button>
        </div>
      ))}
    </div>
  );
}

// ── Action Editor ─────────────────────────────────────────────
function ActionEditor({ actions, onChange }) {
  const addAction = () => onChange([
    ...actions,
    { id: Date.now().toString(), type:"SEND_NOTIFICATION", config:{} }
  ]);

  const updateAction = (id, key, val) =>
    onChange(actions.map(a => a.id === id ? { ...a, [key]: val } : a));

  const updateConfig = (id, key, val) =>
    onChange(actions.map(a => a.id === id ? { ...a, config:{ ...a.config, [key]: val } } : a));

  const removeAction = (id) =>
    onChange(actions.filter(a => a.id !== id));

  return (
    <div className="auto-actions">
      <div className="auto-section-header">
        <span className="auto-section-label">⚡ Actions</span>
        <button className="auto-add-btn" onClick={addAction}>+ Add Action</button>
      </div>

      {actions.length === 0 && (
        <div className="auto-empty-conditions">No actions yet. Add at least one.</div>
      )}

      {actions.map((a, i) => {
        const meta = ACTION_META.find(m => m.value === a.type) || ACTION_META[0];
        return (
          <div key={a.id} className="auto-action-block">
            <div className="auto-action-header">
              <span className="auto-action-num">{i + 1}</span>
              <span className="auto-action-icon">{meta.icon}</span>
              <select className="auto-action-type-select"
                value={a.type} onChange={e => updateAction(a.id, "type", e.target.value)}>
                {ACTION_META.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              <button className="auto-remove-btn" onClick={() => removeAction(a.id)}>✕</button>
            </div>

            {/* Action-specific config */}
            <div className="auto-action-config">
              {a.type === "AI_SUMMARISE" && (
                <div className="auto-action-config">
                  <div className="form-group">
                    <label htmlFor={"automations-ai-prompt-optional"}>AI Prompt (optional)</label>
                    <input value={a.config?.prompt||""}
                      onChange={e => updateConfig(a.id,"prompt",e.target.value)}
                      placeholder="Summarise the task and suggest next steps" id={"automations-ai-prompt-optional"} />
                    <div className="integration-field-help">AI will generate a summary and post it as a comment</div>
                  </div>
                </div>
              )}
              {a.type === "AI_RISK_CHECK" && (
                <div className="auto-action-config">
                  <div className="form-group">
                    <label htmlFor={"automations-risk-threshold-high-medium-low"}>Risk threshold (HIGH/MEDIUM/LOW)</label>
                    <select value={a.config?.threshold||"HIGH"}
                      onChange={e => updateConfig(a.id,"threshold",e.target.value)} id={"automations-risk-threshold-high-medium-low"}>
                      <option>HIGH</option><option>MEDIUM</option><option>LOW</option>
                    </select>
                    <div className="integration-field-help">AI analyses task/project for risks and notifies if above threshold</div>
                  </div>
                </div>
              )}
              {a.type === "START_BPM" && (
                <div className="auto-action-config">
                  <div className="form-group">
                    <label htmlFor={"automations-bpm-process-id"}>BPM Process ID</label>
                    <input value={a.config?.processId||""}
                      onChange={e => updateConfig(a.id,"processId",e.target.value)}
                      placeholder="BPM process ID to start" id={"automations-bpm-process-id"} />
                    <div className="integration-field-help">Starts a BPM process instance when this automation fires</div>
                  </div>
                </div>
              )}
              {a.type === "SEND_NOTIFICATION" && (
                <>
                  <div className="form-group">
                    <label htmlFor={"automations-title"}>Title</label>
                    <input value={a.config?.title || ""} placeholder="Notification title"
                      onChange={e => updateConfig(a.id, "title", e.target.value)} id={"automations-title"} />
                  </div>
                  <div className="form-group">
                    <label>Message <span className="auto-hint">Use {"{{title}}"} for entity name</span></label>
                    <textarea rows={2} value={a.config?.message || ""} placeholder="Notification message"
                      onChange={e => updateConfig(a.id, "message", e.target.value)} />
                  </div>
                </>
              )}
              {a.type === "CHANGE_STATUS" && (
                <div className="form-group">
                  <label htmlFor={"automations-new-status"}>New Status</label>
                  <select value={a.config?.status || "TODO"}
                    onChange={e => updateConfig(a.id, "status", e.target.value)} id={"automations-new-status"}>
                    <option value="TODO">To Do</option>
                    <option value="IN_PROGRESS">In Progress</option>
                    <option value="DONE">Done</option>
                  </select>
                </div>
              )}
              {a.type === "CHANGE_PRIORITY" && (
                <div className="form-group">
                  <label htmlFor={"automations-new-priority"}>New Priority</label>
                  <select value={a.config?.priority || "MEDIUM"}
                    onChange={e => updateConfig(a.id, "priority", e.target.value)} id={"automations-new-priority"}>
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                  </select>
                </div>
              )}
              {a.type === "ADD_TAG" && (
                <div className="form-group">
                  <label htmlFor={"automations-tag-to-add"}>Tag to add</label>
                  <input value={a.config?.tag || ""} placeholder="e.g. urgent"
                    onChange={e => updateConfig(a.id, "tag", e.target.value)} id={"automations-tag-to-add"} />
                </div>
              )}
              {a.type === "POST_COMMENT" && (
                <div className="form-group">
                  <label>Comment text <span className="auto-hint">Use {"{{title}}"} for entity name</span></label>
                  <textarea rows={2} value={a.config?.comment || ""} placeholder="Comment text"
                    onChange={e => updateConfig(a.id, "comment", e.target.value)} />
                </div>
              )}
              {a.type === "REQUEST_APPROVAL" && (
                <>
                  <div className="form-group">
                    <label htmlFor={"automations-approval-title"}>Approval title</label>
                    <input value={a.config?.title || ""} placeholder="Approval Required"
                      onChange={e => updateConfig(a.id, "title", e.target.value)} id={"automations-approval-title"} />
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label htmlFor={"automations-chain-type"}>Chain type</label>
                      <select value={a.config?.chainType || "SEQUENTIAL"}
                        onChange={e => updateConfig(a.id, "chainType", e.target.value)} id={"automations-chain-type"}>
                        <option value="SEQUENTIAL">Sequential (one by one)</option>
                        <option value="PARALLEL">Parallel (all at once)</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label htmlFor={"automations-sla-hours"}>SLA (hours)</label>
                      <input type="number" min={1} value={a.config?.slaHours || 24}
                        onChange={e => updateConfig(a.id, "slaHours", Number(e.target.value))} id={"automations-sla-hours"} />
                    </div>
                  </div>
                  <div className="form-group">
                    <label htmlFor={"automations-approvers-comma-separated-emails"}>Approvers (comma-separated emails)</label>
                    <input value={(a.config?.approvers || []).join(",")}
                      placeholder="alice@co.com, bob@co.com"
                      onChange={e => updateConfig(a.id, "approvers", e.target.value.split(",").map(s=>s.trim()).filter(Boolean))} id={"automations-approvers-comma-separated-emails"} />
                  </div>
                  <div className="form-group">
                    <label htmlFor={"automations-escalate-to-email-optional"}>Escalate to (email, optional)</label>
                    <input value={a.config?.escalateTo || ""} placeholder="manager@co.com"
                      onChange={e => updateConfig(a.id, "escalateTo", e.target.value)} id={"automations-escalate-to-email-optional"} />
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Automation Builder Modal ──────────────────────────────────
function AutomationBuilder({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(initial || {
    name: "", description: "", enabled: true,
    triggerType: "TASK_STATUS_CHANGED", triggerConfig: {},
    conditions: [], conditionOperator: "AND",
    actions: [],
  });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.name.trim() || !form.triggerType || form.actions.length === 0) return;
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  const isScheduled = form.triggerType === "SCHEDULED";

  return (
    <div className="modal-overlay">
      <div className="modal auto-builder-modal">
        <div className="auto-builder-header">
          <h2>{initial?.id ? "Edit Automation" : "New Automation"}</h2>
          <button className="btn-icon" onClick={onCancel}>✕</button>
        </div>

        {/* Name & description */}
        <div className="auto-builder-body">
          <div className="form-row">
            <div className="form-group" style={{ flex:2 }}>
              <label htmlFor={"automations-automation-name"}>Automation Name *</label>
              <input value={form.name} onChange={e => set("name", e.target.value)}
                placeholder="e.g. Notify on overdue tasks" id={"automations-automation-name"} />
            </div>
            <div className="form-group" style={{ flex:1 }}>
              <label htmlFor={"automations-status"}>Status</label>
              <select value={form.enabled ? "true" : "false"}
                onChange={e => set("enabled", e.target.value === "true")} id={"automations-status"}>
                <option value="true">✅ Enabled</option>
                <option value="false">⏸ Disabled</option>
              </select>
            </div>
          </div>
          <div className="form-group">
            <label htmlFor={"automations-description"}>Description</label>
            <input value={form.description} onChange={e => set("description", e.target.value)}
              placeholder="What does this automation do?" id={"automations-description"} />
          </div>

          {/* Visual flow: TRIGGER → CONDITIONS → ACTIONS */}
          <div className="auto-flow">
            {/* Step 1: Trigger */}
            <div className="auto-flow-step">
              <div className="auto-flow-step-header">
                <span className="auto-flow-num">1</span>
                <span className="auto-flow-label">WHEN this happens…</span>
              </div>
              <div className="auto-trigger-grid">
                {TRIGGER_META.map(t => (
                  <button key={t.value}
                    className={`auto-trigger-card${form.triggerType === t.value ? " active" : ""}`}
                    onClick={() => set("triggerType", t.value)}>
                    <span className="auto-trigger-icon">{t.icon}</span>
                    <span className="auto-trigger-label">{t.label}</span>
                  </button>
                ))}
              </div>
              {form.triggerType === "INBOUND_WEBHOOK" && (
                <div className="auto-cron-config">
                  <div className="auto-cron-label">📥 Inbound Webhook Key</div>
                  <input className="auto-cron-input"
                    value={form.triggerConfig?.webhookKey||""}
                    onChange={e => setForm(f=>({...f,triggerConfig:{...f.triggerConfig,webhookKey:e.target.value}}))}
                    placeholder="my-webhook-key (no spaces)" />
                  <div className="auto-cron-hint">
                    External systems POST to: <code style={{background:"var(--gray-100)",padding:"1px 6px",borderRadius:"4px",fontSize:"11px"}}>
                      POST /api/inbound-webhooks/{"{"}your-key{"}"}
                    </code>
                  </div>
                </div>
              )}
              {isScheduled && (
                <div className="auto-cron-config">
                  <div className="auto-cron-label">⏰ Schedule (cron expression)</div>
                  <div className="auto-cron-presets">
                    {[
                      { label:"Daily 9am",    expr:"0 9 * * *"   },
                      { label:"Mon 9am",      expr:"0 9 * * MON" },
                      { label:"Every hour",   expr:"0 * * * *"   },
                      { label:"1st of month", expr:"0 8 1 * *"   },
                    ].map(p => (
                      <button key={p.expr} type="button"
                        className={`auto-cron-preset${form.triggerConfig?.cronExpr===p.expr?" active":""}`}
                        onClick={() => setForm(f=>({...f,triggerConfig:{...f.triggerConfig,cronExpr:p.expr}}))}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <input className="auto-cron-input"
                    value={form.triggerConfig?.cronExpr||""}
                    onChange={e => setForm(f=>({...f,triggerConfig:{...f.triggerConfig,cronExpr:e.target.value}}))}
                    placeholder="Custom: 0 9 * * MON" />
                  <div className="auto-cron-hint">
                    Format: minute hour day month weekday ·
                    <a href="https://crontab.guru" target="_blank" rel="noopener noreferrer"
                      style={{color:"var(--brand-500)"}}> crontab.guru ↗</a>
                  </div>
                </div>
              )}
            </div>

            <div className="auto-flow-arrow">↓</div>

            {/* Step 2: Conditions */}
            <div className="auto-flow-step">
              <div className="auto-flow-step-header">
                <span className="auto-flow-num">2</span>
                <span className="auto-flow-label">IF these conditions match… <span className="auto-optional">(optional)</span></span>
              </div>
              <ConditionEditor
                conditions={form.conditions}
                operator={form.conditionOperator}
                onChange={c => set("conditions", c)}
                onOperatorChange={op => set("conditionOperator", op)}
              />
            </div>

            <div className="auto-flow-arrow">↓</div>

            {/* Step 3: Actions */}
            <div className="auto-flow-step">
              <div className="auto-flow-step-header">
                <span className="auto-flow-num">3</span>
                <span className="auto-flow-label">THEN do these actions…</span>
              </div>
              <ActionEditor actions={form.actions} onChange={a => set("actions", a)} />
            </div>
          </div>
        </div>

        <div className="form-actions" style={{ padding:"16px 24px", borderTop:"1px solid var(--border)" }}>
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" onClick={handleSave}
            disabled={saving || !form.name.trim() || !form.triggerType || form.actions.length === 0}>
            {saving ? "Saving…" : initial?.id ? "Save Changes" : "Create Automation"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Approvals Panel ───────────────────────────────────────────
function ApprovalsPanel() {
  const [approvals, setApprovals] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newApproval, setNewApproval] = useState({ title:"", description:"", entityType:"TASK", entityId:"", chainType:"SEQUENTIAL", slaHours:24, steps:[], escalateTo:"" });
  const [respondingTo, setRespondingTo] = useState(null);
  const [respondComment, setRespondComment] = useState("");
  const { show: showToast } = useToast();

  const load = () => getApprovals().then(r => setApprovals(unwrapList(r)));
  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    await createApproval(newApproval);
    setShowCreate(false);
    load();
    showToast("Approval request created", "success");
  };

  const handleRespond = async (approvalId, stepId, decision) => {
    await respondApproval(approvalId, { stepId, decision, comment: respondComment });
    setRespondingTo(null);
    setRespondComment("");
    load();
    showToast(`Step ${decision.toLowerCase()}`, "success");
  };

  const handleEscalate = async (id) => {
    await escalateApproval(id);
    load();
    showToast("Escalated", "success");
  };

  const pending  = approvals.filter(a => ["PENDING","ESCALATED"].includes(a.status));
  const resolved = approvals.filter(a => ["APPROVED","REJECTED","CANCELLED"].includes(a.status));

  return (
    <div className="auto-approvals">
      <div className="auto-approvals-header">
        <div>
          <div className="auto-tab-title">Approval Requests</div>
          <div className="auto-tab-sub">{pending.length} pending · {resolved.length} resolved</div>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>+ New Request</button>
      </div>

      {showCreate && (
        <div className="auto-approval-create">
          <div className="form-row">
            <div className="form-group" style={{ flex:2 }}>
              <label htmlFor={"automations-title-2"}>Title *</label>
              <input value={newApproval.title} onChange={e => setNewApproval(a => ({...a, title:e.target.value}))} placeholder="What needs approval?" id={"automations-title-2"} />
            </div>
            <div className="form-group">
              <label htmlFor={"automations-chain"}>Chain</label>
              <select value={newApproval.chainType} onChange={e => setNewApproval(a => ({...a, chainType:e.target.value}))} id={"automations-chain"}>
                <option value="SEQUENTIAL">Sequential</option>
                <option value="PARALLEL">Parallel</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor={"automations-sla-hrs"}>SLA (hrs)</label>
              <input type="number" min={1} value={newApproval.slaHours} onChange={e => setNewApproval(a => ({...a, slaHours:Number(e.target.value)}))} id={"automations-sla-hrs"} />
            </div>
          </div>
          <div className="form-group">
            <label htmlFor={"automations-description-2"}>Description</label>
            <textarea rows={2} value={newApproval.description} onChange={e => setNewApproval(a => ({...a, description:e.target.value}))} placeholder="Context for approvers" id={"automations-description-2"} />
          </div>
          <div className="form-group">
            <label htmlFor={"automations-approver-emails-one-per-line"}>Approver emails (one per line)</label>
            <textarea rows={2} placeholder="alice@company.com&#10;bob@company.com"
              onChange={e => setNewApproval(a => ({...a, steps: e.target.value.split("\n").filter(Boolean).map((email,i)=>({id:i.toString(), approverEmail:email.trim(), status:"PENDING"}))}))} id={"automations-approver-emails-one-per-line"} />
          </div>
          <div className="form-actions">
            <button className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
            <button className="btn-primary" onClick={handleCreate} disabled={!newApproval.title.trim()}>Create Request</button>
          </div>
        </div>
      )}

      {/* Pending */}
      {pending.map(ap => {
        const sm = STATUS_META[ap.status] || STATUS_META.PENDING;
        return (
          <div key={ap.id} className="auto-approval-card">
            <div className="auto-approval-top">
              <div className="auto-approval-title">{ap.title}</div>
              <span className="auto-approval-status" style={{ background:sm.bg, color:sm.color }}>{sm.label}</span>
            </div>
            {ap.description && <div className="auto-approval-desc">{ap.description}</div>}
            <div className="auto-approval-meta">
              <span>Requested by <strong>{ap.requestedBy}</strong></span>
              <span>{ap.chainType} · SLA {ap.slaHours}h</span>
            </div>

            {/* Step chain */}
            <div className="auto-approval-steps">
              {(ap.steps || []).map((step, i) => {
                const stepMeta = STATUS_META[step.status] || STATUS_META.PENDING;
                const isActive = i === ap.currentStep;
                return (
                  <div key={step.id} className={`auto-approval-step${isActive ? " active" : ""}`}>
                    <div className="auto-step-num">{i+1}</div>
                    <div className="auto-step-info">
                      <div className="auto-step-email">{step.approverEmail}</div>
                      <span className="auto-step-status" style={{ color:stepMeta.color }}>{stepMeta.label}</span>
                      {step.comment && <div className="auto-step-comment">"{step.comment}"</div>}
                    </div>
                    {isActive && step.status === "PENDING" && (
                      <div className="auto-step-actions">
                        {respondingTo === step.id ? (
                          <div className="auto-respond-form">
                            <input value={respondComment} onChange={e => setRespondComment(e.target.value)}
                              placeholder="Optional comment" />
                            <button className="btn-primary" style={{ fontSize:"11px" }}
                              onClick={() => handleRespond(ap.id, step.id, "APPROVED")}>✓ Approve</button>
                            <button className="btn-secondary" style={{ fontSize:"11px", color:"var(--danger)" }}
                              onClick={() => handleRespond(ap.id, step.id, "REJECTED")}>✗ Reject</button>
                            <button className="btn-secondary" style={{ fontSize:"11px" }}
                              onClick={() => setRespondingTo(null)}>Cancel</button>
                          </div>
                        ) : (
                          <button className="btn-secondary" style={{ fontSize:"11px" }}
                            onClick={() => setRespondingTo(step.id)}>Respond</button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {ap.status === "PENDING" && ap.escalateTo && (
              <button className="auto-escalate-btn" onClick={() => handleEscalate(ap.id)}>
                ⬆ Escalate to {ap.escalateTo}
              </button>
            )}
          </div>
        );
      })}

      {/* Resolved */}
      {resolved.length > 0 && (
        <details className="auto-resolved-group">
          <summary className="auto-resolved-summary">Resolved ({resolved.length})</summary>
          {resolved.map(ap => {
            const sm = STATUS_META[ap.status] || STATUS_META.PENDING;
            return (
              <div key={ap.id} className="auto-approval-card auto-approval-resolved">
                <div className="auto-approval-top">
                  <div className="auto-approval-title">{ap.title}</div>
                  <span className="auto-approval-status" style={{ background:sm.bg, color:sm.color }}>{sm.label}</span>
                </div>
                {ap.rejectionReason && <div className="auto-approval-desc" style={{ color:"var(--danger)" }}>Reason: {ap.rejectionReason}</div>}
                <div className="auto-approval-meta">
                  <span>Resolved by <strong>{ap.resolvedBy || "—"}</strong></span>
                </div>
              </div>
            );
          })}
        </details>
      )}

      {approvals.length === 0 && !showCreate && (
        <div className="empty-state">No approval requests yet.</div>
      )}
    </div>
  );
}

// ── Main Automations Page ─────────────────────────────────────
export default function Automations() {
  const [automations, setAutomations] = useState([]);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editing, setEditing]         = useState(null);
  const [activeTab, setActiveTab]     = useState("automations"); // automations | approvals | templates | versions
  const [versionHistory, setVersionHistory] = useState([]);
  const [versionTarget,  setVersionTarget]  = useState(null);
  const [testing, setTesting]         = useState(null);
  const [search, setSearch]           = useState("");
  const [filterTrigger, setFilterTrigger] = useState("");
  const [filterStatus, setFilterStatus]   = useState("");
  const { show: showToast } = useToast();
  const confirm = useConfirm();

  const load = () => getAutomations().then(r => setAutomations(unwrapList(r)));
  useEffect(() => { load(); }, []);

  const handleSave = async (form) => {
    if (editing?.id) await updateAutomation(editing.id, form);
    else             await createAutomation(form);
    setShowBuilder(false);
    setEditing(null);
    load();
    showToast(editing?.id ? "Automation updated" : "Automation created", "success");
  };

  const handleDelete = async (id) => {
    const ok = await confirm({ title:"Delete automation?", message:"This cannot be undone.", danger:true });
    if (!ok) return;
    await deleteAutomation(id);
    load();
    showToast("Automation deleted", "success");
  };

  const handleToggle = async (id) => {
    await toggleAutomation(id);
    load();
  };

  const handleTest = async (id) => {
    setTesting(id);
    try {
      await testAutomation(id, {});
      showToast("Test run triggered — check the History tab above for results", "success"); setActiveTab("history"); load();
    } catch {
      showToast("Test failed", "error");
    } finally {
      setTesting(null);
    }
  };

  const applyTemplate = (tpl) => {
    setEditing({ ...tpl, name: tpl.name });
    setShowBuilder(true);
    setActiveTab("automations");
  };

  const enabled  = automations.filter(a => a.enabled);
  const disabled = automations.filter(a => !a.enabled);

  const filteredAutomations = automations.filter(a => {
    if (search && !a.name?.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterTrigger && a.triggerType !== filterTrigger) return false;
    if (filterStatus === "active" && !a.enabled) return false;
    if (filterStatus === "disabled" && a.enabled) return false;
    return true;
  });

  return (
    <div>
      <PageHeader
        icon="⚡"
        title="Automations"
        description="Visual no-code automation builder with approval workflows"
        action={
          <div style={{ display:"flex", gap:"8px" }}>
            <div style={{ display:"flex", gap:"4px", background:"var(--gray-100)", borderRadius:"var(--radius-sm)", padding:"3px" }}>
              {[["automations","⚡ Automations"],["approvals","✅ Approvals"],["history","📜 History"],["templates","📋 Templates"]].map(([t,l]) => (
                <button key={t}
                  style={{ padding:"5px 12px", border:"none", borderRadius:"5px", fontSize:"12px", fontWeight:600, cursor:"pointer",
                    background: activeTab===t ? "var(--bg-card)" : "transparent",
                    color: activeTab===t ? "var(--brand-600)" : "var(--gray-500)" }}
                  onClick={() => setActiveTab(t)}>
                  {l}
                </button>
              ))}
            </div>
            {activeTab === "automations" && (
              <button className="btn-primary" onClick={() => { setEditing(null); setShowBuilder(true); }}>
                + New Automation
              </button>
            )}
          </div>
        }
      />

      {/* Stats bar */}
      {activeTab === "automations" && (
        <div className="auto-stats-bar">
          <div className="auto-stat"><div className="auto-stat-num">{automations.length}</div><div className="auto-stat-label">Total</div></div>
          <div className="auto-stat"><div className="auto-stat-num" style={{ color:"var(--success)" }}>{enabled.length}</div><div className="auto-stat-label">Active</div></div>
          <div className="auto-stat"><div className="auto-stat-num" style={{ color:"var(--gray-500)" }}>{disabled.length}</div><div className="auto-stat-label">Disabled</div></div>
          <div className="auto-stat"><div className="auto-stat-num" style={{ color:"var(--brand-500)" }}>{automations.reduce((s,a)=>s+(a.runCount||0),0)}</div><div className="auto-stat-label">Total Runs</div></div>
          <div className="auto-stat"><div className="auto-stat-num" style={{ color:"var(--danger)" }}>{automations.reduce((s,a)=>s+(a.failCount||0),0)}</div><div className="auto-stat-label">Failures</div></div>
        </div>
      )}

      {/* ── Automations tab ── */}
      {activeTab === "automations" && (
        <>
        {automations.length > 0 && (
          <div className="filter-bar">
            <input style={{ width:"200px" }} value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Search automations..." />
            <select value={filterTrigger} onChange={e=>setFilterTrigger(e.target.value)}>
              <option value="">All Triggers</option>
              {TRIGGER_META.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
            </select>
            <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
              <option value="">All Statuses</option>
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
            </select>
          </div>
        )}
        <div className="auto-list">
          {automations.length === 0 && (
            <div className="empty-state">
              No automations yet. Click <strong>+ New Automation</strong> or pick a template to get started.
            </div>
          )}
          {automations.length > 0 && filteredAutomations.length === 0 && (
            <div className="empty-state">No automations match your filters.</div>
          )}
          {filteredAutomations.map(a => {
            const triggerMeta = TRIGGER_META.find(t => t.value === a.triggerType);
            return (
              <div key={a.id} className={`auto-card${!a.enabled ? " auto-card-disabled" : ""}`}>
                <div className="auto-card-left">
                  <div className="auto-card-icon">{triggerMeta?.icon || "⚡"}</div>
                  <div className="auto-card-info">
                    <div className="auto-card-name">{a.name}</div>
                    <div className="auto-card-meta">
                      <span className="auto-trigger-chip">{triggerMeta?.label || a.triggerType}</span>
                      <span>→</span>
                      <span>{a.conditions?.length || 0} condition{a.conditions?.length !== 1 ? "s" : ""}</span>
                      <span>→</span>
                      <span>{a.actions?.length || 0} action{a.actions?.length !== 1 ? "s" : ""}</span>
                    </div>
                    {a.description && <div className="auto-card-desc">{a.description}</div>}
                    <div className="auto-card-runs">
                      {a.runCount > 0 && <span>▶ {a.runCount} runs</span>}
                      {a.failCount > 0 && <span style={{ color:"var(--danger)" }}>✗ {a.failCount} failed</span>}
                      {a.lastRunAt && <span>Last: {new Date(a.lastRunAt).toLocaleDateString()}</span>}
                    </div>
                  </div>
                </div>
                <div className="auto-card-actions">
                  <button className={`auto-toggle-btn${a.enabled ? " enabled" : ""}`}
                    onClick={() => handleToggle(a.id)}
                    title={a.enabled ? "Disable" : "Enable"}>
                    {a.enabled ? "●" : "○"}
                  </button>
                  <button className="btn-secondary" style={{ fontSize:"11px", padding:"4px 8px" }}
                    disabled={testing === a.id}
                    onClick={() => handleTest(a.id)}>
                    {testing === a.id ? "⏳" : "▶ Test"}
                  </button>
                  <button className="btn-icon" onClick={() => { setEditing(a); setShowBuilder(true); }}>✏️</button>
                  <button className="btn-icon" onClick={() => handleDelete(a.id)}>🗑️</button>
                </div>
              </div>
            );
          })}
        </div>
        </>
      )}

      {/* ── Approvals tab ── */}
      {activeTab === "approvals" && <ApprovalsPanel />}

      {/* ── Execution history tab ── */}
      {activeTab === "history" && (
        <div className="auto-history">
          {automations.every(a => !a.recentLogs?.length) ? (
            <div className="empty-state">
              No execution history yet. Run or test an automation to see results here.
            </div>
          ) : (
            automations
              .filter(a => a.recentLogs?.length > 0)
              .map(a => (
                <div key={a.id} className="auto-history-group">
                  <div className="auto-history-group-name">
                    <span>{TRIGGER_META.find(t=>t.value===a.triggerType)?.icon || "⚡"}</span>
                    <span>{a.name}</span>
                    <span className="auto-history-stats">
                      {a.runCount} runs · {a.failCount} failed
                    </span>
                  </div>
                  {a.recentLogs.map(log => (
                    <div key={log.id} className={`auto-history-entry${log.success ? "" : " failed"}`}>
                      <span className="auto-history-icon">{log.success ? "✅" : "❌"}</span>
                      <div className="auto-history-info">
                        <div className="auto-history-msg">{log.message}</div>
                        <div className="auto-history-meta">
                          {log.entityType} · {log.executedAt
                            ? new Date(log.executedAt).toLocaleString([], {month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})
                            : "—"}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))
          )}
        </div>
      )}

      {/* ── Templates tab ── */}
      {activeTab === "versions" && (
        <div className="auto-version-panel">
          <div className="auto-tab-title">Workflow Version History</div>
          <div className="auto-tab-sub">Select an automation to view its version history</div>
          <div className="form-group" style={{maxWidth:320,marginTop:"12px"}}>
            <label htmlFor={"automations-select-automation"}>Select automation</label>
            <select onChange={async e => {
              if (!e.target.value) return;
              const hist = await client.get(`/automations/${e.target.value}/versions`);
              setVersionTarget(e.target.value);
              setVersionHistory(unwrapList(hist));
            }} id={"automations-select-automation"}>
              <option value="">— choose —</option>
              {automations.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          {versionTarget && (
            <div>
              <button className="btn-secondary" style={{fontSize:"11px",marginBottom:"10px"}}
                onClick={async()=>{
                  const note = prompt("Version note (optional):");
                  await client.post(`/automations/${versionTarget}/versions`,{note:note||""});
                  const hist = await client.get(`/automations/${versionTarget}/versions`);
                  setVersionHistory(unwrapList(hist));
                  showToast("Version saved","success");
                }}>
                💾 Save Version Snapshot
              </button>
              {versionHistory.length===0
                ? <div className="auto-tab-sub">No saved versions yet.</div>
                : versionHistory.map(v=>(
                  <div key={v.id} className="auto-version-row">
                    <div>
                      <div className="auto-version-num">v{v.version}</div>
                      <div className="auto-version-note">{v.changeNote}</div>
                      <div className="auto-version-meta">
                        {v.changedBy} · {new Date(v.savedAt).toLocaleString()}
                      </div>
                    </div>
                    <button className="btn-secondary" style={{fontSize:"11px"}}
                      onClick={async()=>{
                        if(!(await confirm({ title: "Restore to v"+v.version+"?", confirmText: "Restore" }))) return;
                        await client.post(`/automations/${versionTarget}/versions/${v.id}/restore`);
                        load(); showToast("Restored to v"+v.version,"success");
                      }}>↩ Restore</button>
                  </div>
                ))
              }
            </div>
          )}
        </div>
      )}
      {activeTab === "templates" && (
        <div className="auto-templates-grid">
          {WORKFLOW_TEMPLATES.map((tpl, i) => (
            <div key={i} className="auto-template-card">
              <div className="auto-template-icon">{tpl.icon}</div>
              <div className="auto-template-name">{tpl.name}</div>
              <div className="auto-template-desc">{tpl.description}</div>
              <div className="auto-template-pills">
                <span className="auto-trigger-chip">{TRIGGER_META.find(t=>t.value===tpl.triggerType)?.label}</span>
                <span>{tpl.conditions.length} conditions</span>
                <span>{tpl.actions.length} actions</span>
              </div>
              <button className="btn-primary" style={{ width:"100%", marginTop:"10px" }}
                onClick={() => applyTemplate(tpl)}>
                Use Template
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Builder modal */}
      {showBuilder && (
        <AutomationBuilder
          initial={editing}
          onSave={handleSave}
          onCancel={() => { setShowBuilder(false); setEditing(null); }}
        />
      )}
    </div>
  );
}
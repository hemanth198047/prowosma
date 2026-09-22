import { useState, useEffect } from "react";
import { unwrapList } from "../api/client";
import {
  getCustomFields,
  createCustomField,
  updateCustomField,
  deleteCustomField,
} from "../api/customFields";
import PageHeader from "../components/PageHeader";
import { useConfirm } from "../hooks/useConfirm";

const FIELD_TYPES = ["TEXT", "NUMBER", "DATE", "DROPDOWN", "CHECKBOX"];
const ENTITY_TYPES = ["TASK", "PROJECT", "GOAL"];
const typeIcon = {
  TEXT: "📝",
  NUMBER: "🔢",
  DATE: "📅",
  DROPDOWN: "📋",
  CHECKBOX: "☑️",
};
const entityIcon = { TASK: "✅", PROJECT: "📁", GOAL: "🎯" };

function CustomFieldForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(
    initial || {
      name: "",
      type: "TEXT",
      entityType: "TASK",
      options: [],
      required: false,
      defaultValue: "",
      conditions: [],
      conditionalAction: "SHOW",
    },
  );
  const [optionInput, setOptionInput] = useState("");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const addOption = () => {
    if (optionInput.trim()) {
      set("options", [...(form.options || []), optionInput.trim()]);
      setOptionInput("");
    }
  };

  const removeOption = (idx) => {
    set(
      "options",
      form.options.filter((_, i) => i !== idx),
    );
  };

  return (
    <div className="modal-overlay" onClick={onCancel} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (onCancel)?.(e); } }}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="presentation">
        <h2>{initial ? "Edit Custom Field" : "New Custom Field"}</h2>
        <div className="form-group">
          <label htmlFor={"custom-fields-field-name"}>Field Name *</label>
          <input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. Client Name, Budget, Priority Score" id={"custom-fields-field-name"}
          />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor={"custom-fields-field-type"}>Field Type</label>
            <select
              value={form.type}
              onChange={(e) => set("type", e.target.value)} id={"custom-fields-field-type"}
            >
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {typeIcon[t]} {t}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor={"custom-fields-apply-to"}>Apply To</label>
            <select
              value={form.entityType}
              onChange={(e) => set("entityType", e.target.value)} id={"custom-fields-apply-to"}
            >
              {ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {entityIcon[t]} {t}
                </option>
              ))}
            </select>
          </div>
        </div>
        {form.type === "DROPDOWN" && (
          <div className="form-group">
            <label htmlFor={"custom-fields-options"}>Options</label>
            <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
              <input
                value={optionInput}
                onChange={(e) => setOptionInput(e.target.value)}
                placeholder="Add option..."
                onKeyDown={(e) => e.key === "Enter" && addOption()}
                style={{ flex: 1 }} id={"custom-fields-options"}
              />
              <button
                className="btn-primary"
                style={{ padding: "8px 12px", fontSize: "12px" }}
                onClick={addOption}
              >
                + Add
              </button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {form.options?.map((opt, i) => (
                <span key={i} className="custom-field-option-tag">
                  {opt}
                  <button
                    onClick={() => removeOption(i)}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      marginLeft: "4px",
                      padding: "0",
                      fontSize: "12px",
                    }}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
        {form.type !== "CHECKBOX" && (
          <div className="form-group">
            <label htmlFor={"custom-fields-default-value"}>Default Value</label>
            <input
              value={form.defaultValue}
              onChange={(e) => set("defaultValue", e.target.value)}
              placeholder="Optional default value" id={"custom-fields-default-value"}
            />
          </div>
        )}
        <div className="form-group">
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={form.required}
              onChange={(e) => set("required", e.target.checked)}
              style={{ width: "auto" }}
            />
            Required field
          </label>
        </div>
        {/* ── Conditional logic builder ── */}
        <div style={{background:"rgba(99,102,241,.04)",border:"1px solid rgba(99,102,241,.15)",
          borderRadius:"var(--radius-md)",padding:"12px",marginBottom:"12px"}}>
          <div style={{fontWeight:700,fontSize:"12px",color:"var(--brand-500)",marginBottom:"8px"}}>
            🔀 Conditional Logic (optional)
          </div>
          <div className="form-row" style={{marginBottom:"8px"}}>
            <div className="form-group" style={{flex:1}}>
              <label htmlFor={"custom-fields-when-conditions-are-met"}>When conditions are met:</label>
              <select value={form.conditionalAction||"SHOW"}
                onChange={e=>set("conditionalAction",e.target.value)} id={"custom-fields-when-conditions-are-met"}>
                <option value="SHOW">Show this field</option>
                <option value="HIDE">Hide this field</option>
                <option value="REQUIRE">Make this field required</option>
              </select>
            </div>
          </div>
          {(form.conditions||[]).map((cond,i)=>(
            <div key={i} className="form-row" style={{gap:6,marginBottom:6}}>
              <input value={cond.fieldId||""} onChange={e=>{
                const c=[...form.conditions];c[i]={...c[i],fieldId:e.target.value};set("conditions",c);
              }} placeholder="Field ID" style={{flex:2}} />
              <select value={cond.operator||"EQUALS"} onChange={e=>{
                const c=[...form.conditions];c[i]={...c[i],operator:e.target.value};set("conditions",c);
              }} style={{flex:1}}>
                <option value="EQUALS">equals</option>
                <option value="NOT_EQUALS">not equals</option>
                <option value="CONTAINS">contains</option>
                <option value="IS_EMPTY">is empty</option>
                <option value="IS_NOT_EMPTY">is not empty</option>
              </select>
              <input value={cond.value||""} onChange={e=>{
                const c=[...form.conditions];c[i]={...c[i],value:e.target.value};set("conditions",c);
              }} placeholder="value" style={{flex:2}} />
              <button className="btn-icon" onClick={()=>set("conditions",(form.conditions||[]).filter((_,j)=>j!==i))}>✕</button>
            </div>
          ))}
          <button className="btn-secondary" style={{fontSize:"11px"}} onClick={()=>
            set("conditions",[...(form.conditions||[]),{fieldId:"",operator:"EQUALS",value:""}])
          }>+ Add Condition</button>
        </div>

        <div className="form-actions">
          <button className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={() => form.name.trim() && onSave(form)}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CustomFields() {
  const confirm = useConfirm();
  const [fields, setFields] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [filterEntity, setFilterEntity] = useState("ALL");

  useEffect(() => {
    const fetchFields = async () => {
      try {
        const res = await getCustomFields();
        setFields(unwrapList(res));
      } catch (e) {
        console.error(e);
      }
    };
    fetchFields();
  }, []);

  const handleSave = async (form) => {
    if (editing) await updateCustomField(editing.id, form);
    else await createCustomField(form);
    setShowForm(false);
    setEditing(null);
    const res = await getCustomFields();
    setFields(unwrapList(res));
  };

  const handleDelete = async (id) => {
    const ok = await confirm({ title: "Delete custom field?", message: "All values stored for this field will be lost.", danger: true, confirmText: "Delete Field" });
    if (ok) {
      await deleteCustomField(id);
      setFields((prev) => prev.filter((f) => f.id !== id));
    }
  };

  const filtered =
    filterEntity === "ALL"
      ? fields
      : fields.filter((f) => f.entityType === filterEntity);

  const grouped = ENTITY_TYPES.reduce((acc, type) => {
    acc[type] = filtered.filter((f) => f.entityType === type);
    return acc;
  }, {});

  return (
    <div>
      <PageHeader
        icon="⚙️"
        title="Custom Fields"
        description="Add custom fields to tasks, projects and goals"
        action={
          <button
            className="btn-primary"
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
          >
            + New Field
          </button>
        }
      />

      <div className="activity-filters" style={{ marginBottom: "20px" }}>
        {["ALL", ...ENTITY_TYPES].map((t) => (
          <button
            key={t}
            className={`calendar-filter-btn ${filterEntity === t ? "active" : ""}`}
            onClick={() => setFilterEntity(t)}
          >
            {entityIcon[t] || "🌐"} {t}{" "}
            {t !== "ALL" &&
              `(${fields.filter((f) => f.entityType === t).length})`}
          </button>
        ))}
      </div>

      {filterEntity === "ALL" ? (
        ENTITY_TYPES.map(
          (type) =>
            grouped[type].length > 0 && (
              <div key={type} className="custom-fields-section">
                <div className="custom-fields-section-title">
                  {entityIcon[type]} {type} Fields
                  <span
                    className="task-status-badge"
                    style={{
                      background: "#f0f0ff",
                      color: "var(--brand-500)",
                      marginLeft: "8px",
                    }}
                  >
                    {grouped[type].length}
                  </span>
                </div>
                <div className="custom-fields-grid">
                  {grouped[type].map((f) => (
                    <CustomFieldCard
                      key={f.id}
                      field={f}
                      onEdit={() => {
                        setEditing(f);
                        setShowForm(true);
                      }}
                      onDelete={() => handleDelete(f.id)}
                    />
                  ))}
                </div>
              </div>
            ),
        )
      ) : (
        <div className="custom-fields-grid">
          {filtered.map((f) => (
            <CustomFieldCard
              key={f.id}
              field={f}
              onEdit={() => {
                setEditing(f);
                setShowForm(true);
              }}
              onDelete={() => handleDelete(f.id)}
            />
          ))}
          {filtered.length === 0 && (
            <p className="empty-state">
              No custom fields for {filterEntity} yet.
            </p>
          )}
        </div>
      )}

      {showForm && (
        <CustomFieldForm
          initial={editing}
          onSave={handleSave}
          onCancel={() => {
            setShowForm(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function CustomFieldCard({ field, onEdit, onDelete }) {
  return (
    <div className="custom-field-card">
      <div className="custom-field-card-header">
        <div className="custom-field-type-badge">
          {typeIcon[field.type]} {field.type}
        </div>
        <div className="card-actions">
          <button className="btn-icon" onClick={onEdit}>
            ✏️
          </button>
          <button className="btn-icon" onClick={onDelete}>
            🗑️
          </button>
        </div>
      </div>
      <div className="custom-field-name">{field.name}</div>
      <div className="custom-field-meta">
        <span>
          {entityIcon[field.entityType]} {field.entityType}
        </span>
        {field.required && (
          <span className="custom-field-required">Required</span>
        )}
        {field.defaultValue && <span>Default: {field.defaultValue}</span>}
      </div>
      {field.type === "DROPDOWN" && field.options?.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "4px",
            marginTop: "8px",
          }}
        >
          {field.options.map((opt, i) => (
            <span key={i} className="custom-field-option-tag">
              {opt}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

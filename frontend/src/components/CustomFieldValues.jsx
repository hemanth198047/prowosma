import { useState, useEffect } from "react";
import { getCustomFieldsByEntity } from "../api/customFields";

export default function CustomFieldValues({ entityType, values = {}, onChange }) {
  const [fields, setFields] = useState([]);

  useEffect(() => {
    getCustomFieldsByEntity(entityType)
      .then(r => setFields(r.data || []))
      .catch(() => {});
  }, [entityType]);

  if (fields.length === 0) return null;

  const handleChange = (fieldId, value) => onChange({ ...values, [fieldId]: value });

  // ── Evaluate conditional visibility ────────────────────────
  const isFieldVisible = (field) => {
    const conditions = field.conditions;
    if (!conditions || conditions.length === 0) return true;

    const action = field.conditionalAction || "SHOW";

    const conditionsMet = conditions.every(cond => {
      const triggerValue = values[cond.fieldId] || "";
      switch (cond.operator) {
        case "EQUALS":        return triggerValue === cond.value;
        case "NOT_EQUALS":    return triggerValue !== cond.value;
        case "CONTAINS":      return triggerValue.toLowerCase().includes((cond.value||"").toLowerCase());
        case "IS_EMPTY":      return !triggerValue || triggerValue === "";
        case "IS_NOT_EMPTY":  return !!triggerValue && triggerValue !== "";
        default:              return true;
      }
    });

    if (action === "SHOW")    return conditionsMet;
    if (action === "HIDE")    return !conditionsMet;
    return true; // REQUIRE — always show, validation handled separately
  };

  const isFieldRequired = (field) => {
    if (field.required) return true;
    if (field.conditionalAction !== "REQUIRE") return false;
    const conditions = field.conditions || [];
    if (conditions.length === 0) return false;
    return conditions.every(cond => {
      const triggerValue = values[cond.fieldId] || "";
      switch (cond.operator) {
        case "EQUALS":       return triggerValue === cond.value;
        case "NOT_EQUALS":   return triggerValue !== cond.value;
        case "IS_NOT_EMPTY": return !!triggerValue;
        default:             return true;
      }
    });
  };

  const visibleFields = fields.filter(isFieldVisible);
  if (visibleFields.length === 0) return null;

  return (
    <div style={{ borderTop:"1px dashed #eee", marginTop:"8px", paddingTop:"12px" }}>
      <div style={{ fontSize:"11px", fontWeight:700, color:"#aaa",
        textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:"10px" }}>
        Custom Fields
      </div>
      {visibleFields.map(field => {
        const required = isFieldRequired(field);
        return (
          <div className="form-group" key={field.id}>
            <label>
              {field.name}
              {required && <span style={{ color:"#ef4444", marginLeft:"4px" }}>*</span>}
              {(field.conditions||[]).length > 0 && (
                <span style={{ fontSize:"9px", color:"#6366f1", marginLeft:"6px",
                  background:"rgba(99,102,241,.1)", padding:"1px 6px", borderRadius:"99px" }}>
                  conditional
                </span>
              )}
            </label>

            {field.type === "TEXT" && (
              <input value={values[field.id] || field.defaultValue || ""}
                onChange={e => handleChange(field.id, e.target.value)}
                placeholder={`Enter ${field.name}`} required={required} />
            )}
            {field.type === "NUMBER" && (
              <input type="number" value={values[field.id] || field.defaultValue || ""}
                onChange={e => handleChange(field.id, e.target.value)}
                placeholder={`Enter ${field.name}`} required={required} />
            )}
            {field.type === "DATE" && (
              <input type="date" value={values[field.id] || field.defaultValue || ""}
                onChange={e => handleChange(field.id, e.target.value)} required={required} />
            )}
            {field.type === "DROPDOWN" && (
              <select value={values[field.id] || field.defaultValue || ""}
                onChange={e => handleChange(field.id, e.target.value)} required={required}>
                <option value="">-- Select --</option>
                {field.options?.map(opt => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            )}
            {field.type === "CHECKBOX" && (
              <label style={{ display:"flex", alignItems:"center", gap:"8px", cursor:"pointer" }}>
                <input type="checkbox"
                  checked={values[field.id] === "true" || values[field.id] === true}
                  onChange={e => handleChange(field.id, String(e.target.checked))}
                  style={{ width:"auto" }} />
                {field.name}
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
}

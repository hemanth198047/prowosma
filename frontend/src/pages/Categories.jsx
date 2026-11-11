import { unwrapList } from "../api/client";
import { useState, useEffect } from "react";
import {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} from "../api/categories";
import PageHeader from "../components/PageHeader";
import { useConfirm } from "../hooks/useConfirm";
import { useToast } from "../components/ToastContext";
import CanDo from "../components/CanDo";
import { apiErrorMessage } from "../utils/apiError";

const COLORS = [
  "var(--brand-500)",
  "var(--warning)",
  "var(--success)",
  "var(--danger)",
  "#3b82f6",
  "var(--purple)",
  "#ec4899",
  "#14b8a6",
  "#f97316",
];
const ICONS = [
  "📁",
  "💼",
  "🏠",
  "🎯",
  "💡",
  "🛠️",
  "📚",
  "❤️",
  "🌟",
  "🎨",
  "🏋️",
  "🌱",
];

function CategoryForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(
    initial || { name: "", color: "var(--brand-500)", icon: "📁" },
  );
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h2>{initial ? "Edit Category" : "New Category"}</h2>
        <div className="form-group">
          <label htmlFor={"categories-name"}>Name *</label>
          <input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. Work, Personal, Business" id={"categories-name"}
          />
        </div>
        <div className="form-group">
          <span id="categories-icon-label">Icon</span>
          <div className="color-picker" role="radiogroup" aria-labelledby="categories-icon-label">
            {ICONS.map((ic) => (
              <div
                key={ic}
                className={`icon-dot ${form.icon === ic ? "selected" : ""}`}
                onClick={() => set("icon", ic)} role="radio" aria-checked={form.icon===ic} tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => set("icon", ic))?.(e); } }}
              >
                {ic}
              </div>
            ))}
          </div>
        </div>
        <div className="form-group">
          <span id="categories-color-label">Color</span>
          <div className="color-picker" role="radiogroup" aria-labelledby="categories-color-label">
            {COLORS.map((c) => (
              <div
                key={c}
                className={`color-dot ${form.color === c ? "selected" : ""}`}
                style={{ background: c }}
                onClick={() => set("color", c)} role="radio" aria-checked={form.color===c} tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => set("color", c))?.(e); } }}
              />
            ))}
          </div>
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

export default function Categories() {
  const confirm = useConfirm();
  const { show: showToast } = useToast();
  const [categories, setCategories] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    const res = await getCategories();
    setCategories(unwrapList(res));
  };

  useEffect(() => {
    const fetchData = async () => {
      const res = await getCategories();
      setCategories(unwrapList(res));
    };
    fetchData();
  }, []);

  const handleSave = async (form) => {
    if (editing) await updateCategory(editing.id, form);
    else await createCategory(form);
    setShowForm(false);
    setEditing(null);
    load();
  };

  const handleDelete = async (id) => {
    const ok = await confirm({
      title: "Delete this category?",
      message: "Projects using this category will be unlinked.",
      danger: true,
      confirmText: "Delete",
    });
    if (!ok) return;
    try {
      await deleteCategory(id);
      setCategories((prev) => prev.filter((c) => c.id !== id));
    } catch (e) {
      const status = e.response?.status;
      const msg    = apiErrorMessage(e, e.message);
      showToast("Delete failed (" + status + "): " + msg, "error");
    }
  };

  return (
    <div>
      <PageHeader
        icon="🏷️"
        title="Project Categories"
        description="Organize projects into categories"
        action={
          <CanDo action="create">
            <button className="btn-primary" onClick={() => setShowForm(true)}>
              + New Category
            </button>
          </CanDo>
        }
      />

      <div className="cards-grid">
        {categories.map((c) => (
          <div
            className="category-card"
            key={c.id}
            style={{ borderLeft: `4px solid ${c.color || "var(--brand-500)"}` }}
          >
            <div className="category-icon">{c.icon || "📁"}</div>
            <div className="category-info">
              <h3>{c.name}</h3>
            </div>
            <div className="card-actions">
              <button
                className="btn-icon"
                onClick={() => {
                  setEditing(c);
                  setShowForm(true);
                }}
              >
                ✏️
              </button>
              <button className="btn-icon" onClick={() => handleDelete(c.id)}>
                🗑️
              </button>
            </div>
          </div>
        ))}
        {categories.length === 0 && (
          <p className="empty-state">
            No categories yet. Create your first one!
          </p>
        )}
      </div>

      {showForm && (
        <CategoryForm
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

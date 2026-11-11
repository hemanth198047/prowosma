import { useState, useEffect } from "react";
import {
  getAISettings,
  saveAISettings,
  toggleAI,
  toggleAIFeature,
} from "../api/ai";
import PageHeader from "../components/PageHeader";

import "../styles/pages/ai.css";
import { useToast } from "../components/ToastContext";
const AI_FEATURES = [
  {
    key: "task_assistant",
    label: "Task Assistant",
    icon: "🤖",
    desc: "Auto-generate tasks from project description",
    category: "Task Management",
  },
  {
    key: "goal_advisor",
    label: "Goal Advisor",
    icon: "🎯",
    desc: "Suggest sub-goals and steps from goal title",
    category: "Goal Management",
  },
  {
    key: "prioritization",
    label: "Smart Prioritization",
    icon: "📊",
    desc: "Auto-prioritize tasks by due date and dependencies",
    category: "Planning",
  },
  {
    key: "daily_digest",
    label: "Daily Digest",
    icon: "☀️",
    desc: "AI-generated daily summary and recommendations",
    category: "Daily Review",
  },
  {
    key: "breakdown",
    label: "Goal→Project→Task Breakdown",
    icon: "🗺️",
    desc: "Full breakdown from one goal input",
    category: "Planning",
  },
  {
    key: "scheduling",
    label: "Smart Scheduling",
    icon: "📅",
    desc: "AI-powered task auto-scheduling",
    category: "Planning",
  },
  {
    key: "weekly_planning",
    label: "Weekly Planning",
    icon: "📆",
    desc: "AI weekly plan generation",
    category: "Planning",
  },
  {
    key: "estimation",
    label: "Task Estimation",
    icon: "⏱️",
    desc: "AI time estimation for tasks",
    category: "Task Management",
  },
  {
    key: "standup",
    label: "Daily Standup",
    icon: "🗣️",
    desc: "Auto-generate standup reports",
    category: "Daily Review",
  },
  {
    key: "dependency_detection",
    label: "Dependency Detection",
    icon: "🔗",
    desc: "Auto-detect task dependencies",
    category: "Task Management",
  },
  {
    key: "risk_detection",
    label: "Risk Detection",
    icon: "⚠️",
    desc: "Identify project risks automatically",
    category: "Analytics",
  },
  {
    key: "natural_language",
    label: "Natural Language Tasks",
    icon: "💬",
    desc: "Create tasks from plain text",
    category: "Task Management",
  },
  {
    key: "meeting_notes",
    label: "Meeting Notes → Tasks",
    icon: "📝",
    desc: "Extract tasks from meeting notes",
    category: "Task Management",
  },
  {
    key: "focus_mode",
    label: "Focus Mode",
    icon: "🎯",
    desc: "AI suggests what to focus on",
    category: "Productivity",
  },
  {
    key: "deadline_negotiator",
    label: "Deadline Negotiator",
    icon: "🤝",
    desc: "AI suggests deadline alternatives",
    category: "Planning",
  },
  {
    key: "burnout_detection",
    label: "Burnout Detection",
    icon: "💊",
    desc: "Monitor workload and burnout risk",
    category: "Wellbeing",
  },
  {
    key: "knowledge_assistant",
    label: "Knowledge Assistant",
    icon: "🧠",
    desc: "Ask questions about your projects",
    category: "Knowledge",
  },
  {
    key: "chat_assistant",
    label: "AI Chat Assistant",
    icon: "💬",
    desc: "Full AI chat for project help",
    category: "Chat",
  },
  {
    key: "predictive_planning",
    label: "Predictive Planning",
    icon: "🔮",
    desc: "Predict risks and plan ahead",
    category: "Analytics",
  },
  {
    key: "team_insights",
    label: "Team Performance",
    icon: "👥",
    desc: "AI team workload analysis",
    category: "Team",
  },
];

const PROVIDERS = [
  {
    value: "ANTHROPIC",
    label: "Anthropic (Claude)",
    models: [
      "claude-sonnet-4-20250514",
      "claude-haiku-4-5-20251001",
      "claude-opus-4-6",
    ],
    keyHint: "sk-ant-api...",
  },
  {
    value: "OPENAI",
    label: "OpenAI (ChatGPT)",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo"],
    keyHint: "sk-proj-...",
  },
  {
    value: "GEMINI",
    label: "Google Gemini",
    models: ["gemini-pro", "gemini-1.5-pro"],
    keyHint: "AIza...",
  },
  {
    value: "CUSTOM",
    label: "Custom / Self-hosted",
    models: [],
    keyHint: "your-api-key",
  },
];

const CATEGORIES = [...new Set(AI_FEATURES.map((f) => f.category))];

export default function AISettings() {
  const { show: showToast } = useToast();
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState({
    apiKey: "",
    model: "claude-sonnet-4-20250514",
    maxTokens: 2048,
    apiProvider: "ANTHROPIC",
    apiBaseUrl: "",
  });
  // Per-provider keys stored locally so switching providers doesn't lose keys
  const [providerKeys, setProviderKeys] = useState({
    ANTHROPIC: "", OPENAI: "", GEMINI: "", CUSTOM: "",
  });
  const [testResult, setTestResult] = useState(null); // null | "ok" | "fail"
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeCategory, setActiveCategory] = useState("All");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const setPrimaryProvider = (providerValue) => {
    const p = PROVIDERS.find(pr => pr.value === providerValue);
    set("apiProvider", providerValue);
    set("model", p?.models[0] || "");
    set("apiKey", providerKeys[providerValue] || "");
    setTestResult(null);
  };

  const handleKeyChange = (val) => {
    set("apiKey", val);
    setProviderKeys(prev => ({ ...prev, [form.apiProvider]: val }));
    setTestResult(null);
  };

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await getAISettings();
        setSettings(res.data || {});
        if (res.data) {
          const provider = res.data.apiProvider || "ANTHROPIC";
          setForm({
            apiKey: res.data.apiKey || "",
            model: res.data.model || "claude-sonnet-4-20250514",
            maxTokens: res.data.maxTokens || 2048,
            apiProvider: provider,
            apiBaseUrl: res.data.apiBaseUrl || "",
          });
          // Pre-fill the key for the saved provider
          setProviderKeys(prev => ({ ...prev, [provider]: res.data.apiKey || "" }));
        }
      } catch (e) {
        console.error(e);
      }
    };
    fetchSettings();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await saveAISettings({ ...settings, ...form });
      setSettings(res.data || {});
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleAI = async () => {
    const newVal = !settings?.aiEnabled;
    // Optimistic update — flip immediately so UI feels responsive
    setSettings(prev => ({ ...prev, aiEnabled: newVal }));
    try {
      const res = await toggleAI(newVal);
      if (res.data) setSettings(res.data);
    } catch (e) {
      // Revert on failure
      setSettings(prev => ({ ...prev, aiEnabled: !newVal }));
      console.error("toggleAI error:", e);
      showToast("Failed to update AI settings. Please check your connection and try again.", "error");
    }
  };

  const handleToggleFeature = async (key) => {
    setSettings((prev) => ({
      ...prev,
      features: {
        ...prev?.features,
        [key]: !prev?.features?.[key],
      },
    }));
    try {
      const res = await toggleAIFeature(key);
      setSettings(res.data || {});
    } catch (e) {
      console.error(e);
      setSettings((prev) => ({
        ...prev,
        features: {
          ...prev?.features,
          [key]: !prev?.features?.[key],
        },
      }));
    }
  };

  const enabledCount = AI_FEATURES.filter(
    (f) => settings?.features?.[f.key],
  ).length;
  const filteredFeatures =
    activeCategory === "All"
      ? AI_FEATURES
      : AI_FEATURES.filter((f) => f.category === activeCategory);
  const selectedProvider =
    PROVIDERS.find((p) => p.value === form.apiProvider) || PROVIDERS[0];

  return (
    <div className="ai-page-root">
      <PageHeader
        icon="⚙️"
        title="AI Settings"
        description="Configure AI — you control which features are on and what API key to use"
      />

      {/* Master Toggle */}
      <div className="ai-master-card">
        <div className="ai-master-left">
          <div className="ai-master-icon">🤖</div>
          <div>
            <div className="ai-master-title">AI Features</div>
            <div className="ai-master-desc">
              {settings?.aiEnabled
                ? `${enabledCount} of ${AI_FEATURES.length} features enabled — you can change this anytime`
                : "AI is OFF — enable to use AI features. You can disable anytime."}
            </div>
          </div>
        </div>
        <div className="ai-toggle-wrapper" onClick={handleToggleAI} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (handleToggleAI)?.(e); } }}>
          <div className={`ai-toggle ${settings?.aiEnabled ? "on" : "off"}`}>
            <div className="ai-toggle-knob" />
          </div>
          <span
            className={`ai-toggle-label ${settings?.aiEnabled ? "on" : ""}`}
          >
            {settings?.aiEnabled ? "ON" : "OFF"}
          </span>
        </div>
      </div>

      {/* API Config */}
      <div className="ai-config-card">
        <div className="ai-config-title">🔑 API Configuration</div>
        <div className="ai-config-note">
          Choose your AI provider. Your key is stored only on your server —
          never shared. You can change or remove it anytime.
        </div>

        {/* Primary LLM Selector */}
        <div style={{ marginBottom: "20px" }}>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--gray-700)",
            marginBottom: "10px", display: "flex", alignItems: "center", gap: "6px" }}>
            <span>🎯</span> Select Primary LLM
            <span style={{ fontWeight: 400, fontSize: "11px", color: "var(--gray-400)" }}>
              — All AI features will use this provider
            </span>
          </div>
          <div className="ai-provider-grid">
            {PROVIDERS.map((p) => {
              const isPrimary = form.apiProvider === p.value;
              const hasKey = !!(providerKeys[p.value] || (isPrimary && form.apiKey));
              const ICONS = { ANTHROPIC: "🟣", OPENAI: "🟢", GEMINI: "🔵", CUSTOM: "⚙️" };
              const TAGS = { ANTHROPIC: "Recommended", OPENAI: "Popular", GEMINI: "Free Tier", CUSTOM: "Advanced" };
              return (
                <div key={p.value}
                  className={`ai-provider-card ${isPrimary ? "selected" : ""}`}
                  onClick={() => setPrimaryProvider(p.value)}
                  style={{ position: "relative", cursor: "pointer" }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => setPrimaryProvider(p.value))?.(e); } }}>
                  {/* Primary badge */}
                  {isPrimary && (
                    <div style={{
                      position: "absolute", top: "-8px", left: "50%",
                      transform: "translateX(-50%)",
                      background: "var(--brand-600)",
                      color: "#fff", fontSize: "9px", fontWeight: 800,
                      padding: "2px 10px", borderRadius: "999px",
                      letterSpacing: "0.06em", textTransform: "uppercase",
                      whiteSpace: "nowrap", boxShadow: "var(--elevation-2)",
                    }}>⭐ PRIMARY</div>
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: "8px",
                    marginBottom: "6px", marginTop: isPrimary ? "6px" : "0" }}>
                    <span style={{ fontSize: "18px" }}>{ICONS[p.value]}</span>
                    <span style={{ fontWeight: 700, fontSize: "13px",
                      color: isPrimary ? "var(--brand-700)" : "var(--gray-800)" }}>{p.label}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center",
                    justifyContent: "space-between" }}>
                    <span style={{ fontSize: "10px", fontWeight: 700,
                      padding: "2px 7px", borderRadius: "999px",
                      background: isPrimary ? "rgba(99,102,241,0.1)" : "var(--gray-100)",
                      color: isPrimary ? "var(--brand-500)" : "var(--gray-500)" }}>
                      {TAGS[p.value]}
                    </span>
                    {/* Key status indicator */}
                    <span style={{ fontSize: "11px", display: "flex",
                      alignItems: "center", gap: "3px" }}>
                      {hasKey
                        ? <><span style={{ color: "var(--success)" }}>●</span>
                            <span style={{ color: "var(--success)", fontWeight: 600 }}>Key set</span></>
                        : <><span style={{ color: "var(--gray-400)" }}>○</span>
                            <span style={{ color: "var(--gray-400)" }}>No key</span></>}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* API Key for selected provider */}
        <div style={{
          background: "var(--gray-50)", border: "1.5px solid var(--border)",
          borderRadius: "12px", padding: "16px", marginBottom: "16px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px",
            marginBottom: "12px" }}>
            <span style={{ fontSize: "16px" }}>
              {{ ANTHROPIC:"🟣", OPENAI:"🟢", GEMINI:"🔵", CUSTOM:"⚙️" }[form.apiProvider]}
            </span>
            <span style={{ fontWeight: 700, fontSize: "14px", color: "var(--gray-800)" }}>
              {selectedProvider.label} Configuration
            </span>
            <span style={{
              marginLeft: "auto", fontSize: "10px", fontWeight: 800,
              padding: "3px 10px", borderRadius: "999px",
              background: "var(--brand-600)",
              color: "#fff", letterSpacing: "0.05em",
            }}>PRIMARY LLM</span>
          </div>

        <div className="form-row" style={{ marginTop: "0" }}>
          <div className="form-group" style={{ flex: 2 }}>
            <label style={{ fontWeight: 700 }}>
              API Key
              {form.apiKey && testResult === "ok" && <span style={{ color:"var(--success)",marginLeft:8,fontSize:11 }}>✓ Verified</span>}
              {form.apiKey && testResult === "fail" && <span style={{ color:"var(--danger)",marginLeft:8,fontSize:11 }}>✗ Invalid key</span>}
            </label>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="password"
                value={form.apiKey}
                onChange={(e) => handleKeyChange(e.target.value)}
                placeholder={selectedProvider.keyHint}
                style={{ flex: 1 }}
              />
              {form.apiKey && (
                <button className="btn-secondary"
                  style={{ fontSize: "12px", padding: "8px 12px", whiteSpace: "nowrap" }}
                  onClick={() => { handleKeyChange(""); setTestResult(null); }}>
                  🗑️ Clear
                </button>
              )}
            </div>
            {form.apiProvider !== "CUSTOM" && (
              <p style={{ fontSize: "11px", color: "var(--gray-500)", marginTop: "5px" }}>
                Get your key from{" "}
                <a href={
                  form.apiProvider === "OPENAI" ? "https://platform.openai.com/api-keys" :
                  form.apiProvider === "GEMINI" ? "https://aistudio.google.com/app/apikey" :
                  "https://console.anthropic.com/settings/keys"
                } target="_blank" rel="noreferrer"
                  style={{ color:"var(--brand-500)", textDecoration:"underline" }}>
                  {selectedProvider.label} dashboard
                </a>. Stored securely on your server only.
              </p>
            )}
          </div>

          {selectedProvider.models.length > 0 ? (
            <div className="form-group">
              <label style={{ fontWeight: 700 }} htmlFor={"aisettings-model"}>Model</label>
              <select
                value={form.model}
                onChange={(e) => set("model", e.target.value)} id={"aisettings-model"}
              >
                {selectedProvider.models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="form-group">
              <label htmlFor={"aisettings-model-name"}>Model Name</label>
              <input
                value={form.model}
                onChange={(e) => set("model", e.target.value)}
                placeholder="e.g. llama3, mistral" id={"aisettings-model-name"}
              />
            </div>
          )}

          <div
            className="form-group"
            style={{ width: "120px", flex: "0 0 120px" }}
          >
            <label htmlFor={"aisettings-max-tokens"}>Max Tokens</label>
            <input
              type="number"
              value={form.maxTokens}
              onChange={(e) => set("maxTokens", Number(e.target.value))}
              min="256"
              max="8192" id={"aisettings-max-tokens"}
            />
          </div>
        </div>

        {form.apiProvider === "CUSTOM" && (
          <div className="form-group">
            <label htmlFor={"aisettings-api-base-url"}>API Base URL</label>
            <input
              value={form.apiBaseUrl}
              onChange={(e) => set("apiBaseUrl", e.target.value)}
              placeholder="http://localhost:11434/v1/chat/completions" id={"aisettings-api-base-url"}
            />
            <p style={{ fontSize: "11px", color: "#888", marginTop: "4px" }}>
              Compatible with OpenAI API format (Ollama, LM Studio, etc.)
            </p>
          </div>
        )}
        </div>{/* /provider config box */}

        <div
          style={{
            display: "flex",
            gap: "10px",
            alignItems: "center",
            marginTop: "8px",
          }}
        >
          <button
            className="btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving..." : "💾 Save Configuration"}
          </button>
          {saved && (
            <span style={{ color: "var(--success)", fontSize: "13px" }}>
              ✅ Saved!
            </span>
          )}
          <span style={{ fontSize: "12px", color: "#888", marginLeft: "8px" }}>
            Changes take effect immediately. You can update anytime.
          </span>
        </div>
      </div>

      {/* Feature Toggles */}
      <div className="ai-features-section">
        <div className="ai-features-header">
          <div className="ai-features-title">
            ⚙️ Feature Settings
            {settings?.aiEnabled ? (
              <span className="ai-enabled-count">
                {enabledCount}/{AI_FEATURES.length} enabled
              </span>
            ) : (
              <span
                style={{
                  fontSize: "12px",
                  color: "#888",
                  fontWeight: 400,
                  marginLeft: "8px",
                }}
              >
                (Enable AI above to activate features)
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              className="btn-secondary"
              style={{ fontSize: "12px" }}
              onClick={async () => {
                for (const f of AI_FEATURES) {
                  if (!settings?.features?.[f.key])
                    await handleToggleFeature(f.key);
                }
              }}
            >
              Enable All
            </button>
            <button
              className="btn-secondary"
              style={{ fontSize: "12px" }}
              onClick={async () => {
                for (const f of AI_FEATURES) {
                  if (settings?.features?.[f.key])
                    await handleToggleFeature(f.key);
                }
              }}
            >
              Disable All
            </button>
          </div>
        </div>

        <div className="activity-filters" style={{ marginBottom: "16px" }}>
          {["All", ...CATEGORIES].map((cat) => (
            <button
              key={cat}
              className={`calendar-filter-btn ${activeCategory === cat ? "active" : ""}`}
              onClick={() => setActiveCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="ai-features-grid">
          {filteredFeatures.map((feature) => {
            const enabled = settings?.features?.[feature.key] || false;
            return (
              <div
                key={feature.key}
                className={`ai-feature-card ${enabled ? "enabled" : ""}`}
                data-category={feature.category}
                onClick={() => handleToggleFeature(feature.key)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => handleToggleFeature(feature.key))?.(e); } }}
              >
                <div className="ai-feature-card-top">
                  <div className="ai-feature-icon-wrap">
                    <span className="ai-feature-icon">{feature.icon}</span>
                  </div>
                  <div className={`ai-feature-toggle ${enabled ? "on" : "off"}`}>
                    <div className="ai-feature-toggle-knob" />
                  </div>
                </div>
                <div className="ai-feature-name">{feature.label}</div>
                <div className="ai-feature-desc">{feature.desc}</div>
                <div className="ai-feature-category">{feature.category}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

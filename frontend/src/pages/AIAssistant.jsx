import { useState, useEffect } from "react";
import { unwrapList } from "../api/client";
import { useNavigate } from "react-router-dom";
import {
  generateTasks,
  adviseGoal,
  prioritizeTasks,
  getDailyDigest,
  breakdown,
  getWeeklyPlan,
  estimateTask,
  getStandup,
  detectDependencies,
  detectRisks,
  naturalTask,
  meetingNotes,
  getFocusMode,
  burnoutCheck,
  askKnowledge,
  chatWithAI,
  predictRisks,
  teamInsights,
  getAISettings,
  toggleAI,
  toggleAIFeature,
} from "../api/ai";
import PageHeader from "../components/PageHeader";
import { useAuth } from "../hooks/useAuth";

import "../styles/pages/ai.css";
import { apiErrorMessage } from "../utils/apiError";
const PANELS = [
  {
    key: "chat",
    label: "💬 AI Chat",
    desc: "Ask anything",
    feature: "chat_assistant",
  },
  {
    key: "digest",
    label: "☀️ Daily Digest",
    desc: "Today's summary",
    feature: "daily_digest",
  },
  {
    key: "standup",
    label: "🗣️ Standup",
    desc: "Daily standup",
    feature: "standup",
  },
  {
    key: "focus",
    label: "🎯 Focus Mode",
    desc: "What to work on",
    feature: "focus_mode",
  },
  {
    key: "tasks",
    label: "🤖 Task Generator",
    desc: "Generate tasks",
    feature: "task_assistant",
  },
  {
    key: "natural",
    label: "💬 Natural Task",
    desc: "Text to task",
    feature: "natural_language",
  },
  {
    key: "meeting",
    label: "📝 Meeting Notes",
    desc: "Notes to tasks",
    feature: "meeting_notes",
  },
  {
    key: "goal",
    label: "🎯 Goal Advisor",
    desc: "Goal breakdown",
    feature: "goal_advisor",
  },
  {
    key: "breakdown",
    label: "🗺️ Full Breakdown",
    desc: "Goal to tasks",
    feature: "breakdown",
  },
  {
    key: "estimate",
    label: "⏱️ Estimator",
    desc: "Time estimate",
    feature: "estimation",
  },
  {
    key: "prioritize",
    label: "📊 Prioritize",
    desc: "Smart priority",
    feature: "prioritization",
  },
  {
    key: "weekly",
    label: "📆 Weekly Plan",
    desc: "Week planning",
    feature: "weekly_planning",
  },
  {
    key: "risks",
    label: "⚠️ Risk Check",
    desc: "Detect risks",
    feature: "risk_detection",
  },
  {
    key: "burnout",
    label: "💊 Burnout Check",
    desc: "Wellbeing check",
    feature: "burnout_detection",
  },
  {
    key: "predict",
    label: "🔮 Predictions",
    desc: "Predict issues",
    feature: "predictive_planning",
  },
  {
    key: "team",
    label: "👥 Team Insights",
    desc: "Team analysis",
    feature: "team_insights",
  },
  {
    key: "deps",
    label: "🔗 Dependencies",
    desc: "Find dependencies",
    feature: "dependency_detection",
  },
  {
    key: "ask",
    label: "🧠 Knowledge",
    desc: "Ask about data",
    feature: "knowledge_assistant",
  },
];

function AIDisabledBanner({
  settings,
  onToggleAI,
  onToggleFeature,
  featureKey,
  navigate,
}) {
  // Features default to enabled (opt-out) — only blocked if explicitly false
  const featureEnabled = settings?.features?.[featureKey] !== false;
  const aiEnabled = settings?.aiEnabled;

  if (!aiEnabled) {
    return (
      <div className="ai-disabled-banner">
        <div className="ai-disabled-icon">🤖</div>
        <div className="ai-disabled-content">
          <div className="ai-disabled-title">AI is turned off</div>
          <div className="ai-disabled-desc">
            Enable AI to use this feature. You can turn it off anytime.
          </div>
          <div style={{ display: "flex", gap: "10px", marginTop: "12px" }}>
            <button className="btn-primary" onClick={onToggleAI}>
              ⚡ Enable AI
            </button>
            <button
              className="btn-secondary"
              onClick={() => navigate("/ai-settings")}
            >
              ⚙️ Go to AI Settings
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!featureEnabled) {
    return (
      <div
        className="ai-disabled-banner"
        style={{ borderColor: "#f59e0b", background: "#fffbeb" }}
      >
        <div className="ai-disabled-icon">⚙️</div>
        <div className="ai-disabled-content">
          <div className="ai-disabled-title" style={{ color: "#d97706" }}>
            This feature is disabled
          </div>
          <div className="ai-disabled-desc">
            Enable this specific AI feature to use it. You control exactly which
            features are active.
          </div>
          <div style={{ display: "flex", gap: "10px", marginTop: "12px" }}>
            <button
              className="btn-primary"
              style={{ background: "#f59e0b" }}
              onClick={() => onToggleFeature(featureKey)}
            >
              ⚡ Enable This Feature
            </button>
            <button
              className="btn-secondary"
              onClick={() => navigate("/ai-settings")}
            >
              ⚙️ Manage All Features
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function ResultCard({ data, onClose }) {
  const [copied, setCopied] = useState(false);
  if (!data) return null;
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="ai-result-card">
      <div className="ai-result-header">
        <span style={{ fontWeight: 700 }}>AI Response</span>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            className="btn-icon"
            style={{ color: copied ? "#10b981" : "#fff", fontSize: "14px" }}
            onClick={handleCopy}
          >
            {copied ? "✅ Copied!" : "📋 Copy"}
          </button>
          <button className="btn-icon" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>
      <pre className="ai-result-content">
        {typeof data === "string" ? data : JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

function ChatPanel({ settings, onToggleAI, onToggleFeature, navigate, user }) {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: `Hi ${user?.name || "there"}! 👋 I'm your AI assistant. Ask me anything about your projects, tasks, and goals! 🤖`,
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  // Features default to enabled (opt-out model) — only blocked if explicitly set to false
  const isEnabled = settings?.aiEnabled &&
    (settings?.features?.chat_assistant !== false);

  const send = async () => {
    if (!input.trim() || !isEnabled) return;
    const userMsg = { role: "user", content: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    try {
      const history = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const res = await chatWithAI({
        message: input,
        history,
        userName: user?.name || "User",
      });
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: res.data.response },
      ]);
    } catch (error) {
      // Log the error for debugging and still show a user-friendly message
      console.error(error);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `⚠️ ${apiErrorMessage(
            error,
            "Could not reach the AI service. Please add your API key in AI Settings → API Configuration."
          )}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ai-chat-panel" style={{ flex: 1, minHeight: 0 }}>
      {!isEnabled && (
        <AIDisabledBanner
          settings={settings}
          onToggleAI={onToggleAI}
          onToggleFeature={onToggleFeature}
          featureKey="chat_assistant"
          navigate={navigate}
        />
      )}
      <div className="ai-chat-messages">
        {messages.map((m, i) => (
          <div key={i} className={`ai-chat-message ${m.role}`}>
            <div className="ai-chat-bubble-wrapper">
              <div className="ai-chat-bubble">{m.content}</div>
              <button
                className="ai-copy-btn"
                onClick={() => navigator.clipboard.writeText(m.content)}
                title="Copy message"
              >
                📋
              </button>
            </div>
          </div>
        ))}
        {loading && (
          <div className="ai-chat-message assistant">
            <div className="ai-chat-bubble ai-typing">🤖 Thinking...</div>
          </div>
        )}
      </div>
      <div className="ai-chat-input-row">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            isEnabled
              ? "Ask anything about your projects..."
              : "Enable AI to start chatting"
          }
          disabled={!isEnabled}
          onKeyDown={(e) =>
            e.key === "Enter" && !loading && isEnabled && send()
          }
        />
        <button
          className="btn-primary"
          onClick={send}
          disabled={loading || !input.trim() || !isEnabled}
        >
          Send
        </button>
      </div>
    </div>
  );
}

export default function AIAssistant() {
  const { user } = useAuth();
  const [activePanel, setActivePanel] = useState("chat");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [inputs, setInputs] = useState({});
  const [settings, setSettings] = useState(null);
  const navigate = useNavigate();
  const set = (k, v) => setInputs((prev) => ({ ...prev, [k]: v }));

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await getAISettings();
        setSettings(res.data || {});
      } catch (e) {
        console.error(e);
      }
    };
    fetchSettings();
  }, []);

  const handleToggleAI = async () => {
    const newVal = !settings?.aiEnabled;
    setSettings(prev => ({ ...prev, aiEnabled: newVal }));
    try {
      const res = await toggleAI(newVal);
      if (res.data) setSettings(res.data);
    } catch { setSettings(prev => ({ ...prev, aiEnabled: !newVal })); }
  };

  const handleToggleFeature = async (key) => {
    setSettings(prev => ({ ...prev, features: { ...prev?.features, [key]: !prev?.features?.[key] } }));
    try {
      const res = await toggleAIFeature(key);
      if (res.data) setSettings(res.data);
    } catch (e) { console.error(e); }
  };

  const currentPanel = PANELS.find((p) => p.key === activePanel);
  const featureEnabled =
    settings?.aiEnabled &&
    (settings?.features?.[currentPanel?.feature] !== false);

  const run = async (fn, ...args) => {
    if (!featureEnabled) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fn(...args);
      setResult(unwrapList(res));
    } catch (err) {
      setResult({
        error: apiErrorMessage(err, "Feature not enabled or AI not configured"),
      });
    } finally {
      setLoading(false);
    }
  };

  const renderPanel = () => {
    if (activePanel === "chat") {
      return (
        <ChatPanel
          settings={settings}
          onToggleAI={handleToggleAI}
          onToggleFeature={handleToggleFeature}
          navigate={navigate}
          user={user}
        />
      );
    }

    return (
      <div className="ai-panel-content">
        {!featureEnabled && (
          <AIDisabledBanner
            settings={settings}
            onToggleAI={handleToggleAI}
            onToggleFeature={handleToggleFeature}
            featureKey={currentPanel?.feature}
            navigate={navigate}
          />
        )}

        {activePanel === "digest" && (
          <div>
            <p className="ai-panel-desc">
              Get your AI-generated daily summary with priorities and
              motivation.
            </p>
            <button
              className="btn-primary"
              onClick={() => run(getDailyDigest)}
              disabled={loading || !featureEnabled}
            >
              {loading ? "⏳ Generating..." : "☀️ Generate Daily Digest"}
            </button>
          </div>
        )}
        {activePanel === "standup" && (
          <div>
            <p className="ai-panel-desc">
              Auto-generate your daily standup report.
            </p>
            <button
              className="btn-primary"
              onClick={() => run(getStandup)}
              disabled={loading || !featureEnabled}
            >
              {loading ? "⏳ Generating..." : "🗣️ Generate Standup"}
            </button>
          </div>
        )}
        {activePanel === "focus" && (
          <div>
            <p className="ai-panel-desc">
              AI suggests the ONE most important task to focus on right now.
            </p>
            <button
              className="btn-primary"
              onClick={() => run(getFocusMode)}
              disabled={loading || !featureEnabled}
            >
              {loading ? "⏳ Thinking..." : "🎯 What Should I Focus On?"}
            </button>
          </div>
        )}
        {activePanel === "tasks" && (
          <div>
            <p className="ai-panel-desc">
              Describe a project and AI generates tasks automatically.
            </p>
            <div className="form-group">
              <label htmlFor={"aiassistant-project-name"}>Project Name</label>
              <input
                value={inputs.projectName || ""}
                onChange={(e) => set("projectName", e.target.value)}
                placeholder="e.g. E-commerce Website"
                disabled={!featureEnabled} id={"aiassistant-project-name"}
              />
            </div>
            <div className="form-group">
              <label htmlFor={"aiassistant-project-description"}>Project Description</label>
              <textarea
                value={inputs.taskDesc || ""}
                onChange={(e) => set("taskDesc", e.target.value)}
                rows={4}
                placeholder="Describe what the project should accomplish..."
                disabled={!featureEnabled} id={"aiassistant-project-description"}
              />
            </div>
            <button
              className="btn-primary"
              disabled={loading || !inputs.taskDesc || !featureEnabled}
              onClick={() =>
                run(generateTasks, {
                  projectName: inputs.projectName,
                  description: inputs.taskDesc,
                })
              }
            >
              {loading ? "⏳ Generating..." : "🤖 Generate Tasks"}
            </button>
          </div>
        )}
        {activePanel === "natural" && (
          <div>
            <p className="ai-panel-desc">
              Type a task in plain English and AI parses it.
            </p>
            <div className="form-group">
              <label htmlFor={"aiassistant-natural-language-input"}>Natural Language Input</label>
              <textarea
                value={inputs.naturalText || ""}
                onChange={(e) => set("naturalText", e.target.value)}
                rows={3}
                placeholder="e.g. Review the Q3 report by next Friday, high priority"
                disabled={!featureEnabled} id={"aiassistant-natural-language-input"}
              />
            </div>
            <button
              className="btn-primary"
              disabled={loading || !inputs.naturalText || !featureEnabled}
              onClick={() => run(naturalTask, { text: inputs.naturalText })}
            >
              {loading ? "⏳ Parsing..." : "💬 Parse Task"}
            </button>
          </div>
        )}
        {activePanel === "meeting" && (
          <div>
            <p className="ai-panel-desc">
              Paste meeting notes and AI extracts action items.
            </p>
            <div className="form-group">
              <label htmlFor={"aiassistant-meeting-notes"}>Meeting Notes</label>
              <textarea
                value={inputs.meetingNotes || ""}
                onChange={(e) => set("meetingNotes", e.target.value)}
                rows={6}
                placeholder="Paste your meeting notes here..."
                disabled={!featureEnabled} id={"aiassistant-meeting-notes"}
              />
            </div>
            <button
              className="btn-primary"
              disabled={loading || !inputs.meetingNotes || !featureEnabled}
              onClick={() => run(meetingNotes, { notes: inputs.meetingNotes })}
            >
              {loading ? "⏳ Extracting..." : "📝 Extract Tasks"}
            </button>
          </div>
        )}
        {activePanel === "goal" && (
          <div>
            <p className="ai-panel-desc">
              AI suggests sub-goals and steps to achieve your goal.
            </p>
            <div className="form-group">
              <label htmlFor={"aiassistant-goal-title"}>Goal Title</label>
              <input
                value={inputs.goalTitle || ""}
                onChange={(e) => set("goalTitle", e.target.value)}
                placeholder="e.g. Launch my SaaS product"
                disabled={!featureEnabled} id={"aiassistant-goal-title"}
              />
            </div>
            <div className="form-group">
              <label htmlFor={"aiassistant-goal-description"}>Goal Description</label>
              <textarea
                value={inputs.goalDesc || ""}
                onChange={(e) => set("goalDesc", e.target.value)}
                rows={3}
                placeholder="More details about your goal..."
                disabled={!featureEnabled} id={"aiassistant-goal-description"}
              />
            </div>
            <button
              className="btn-primary"
              disabled={loading || !inputs.goalTitle || !featureEnabled}
              onClick={() =>
                run(adviseGoal, {
                  title: inputs.goalTitle,
                  description: inputs.goalDesc,
                })
              }
            >
              {loading ? "⏳ Advising..." : "🎯 Get Goal Advice"}
            </button>
          </div>
        )}
        {activePanel === "breakdown" && (
          <div>
            <p className="ai-panel-desc">
              Enter a high-level goal and AI creates a full project and task
              breakdown.
            </p>
            <div className="form-group">
              <label htmlFor={"aiassistant-your-goal"}>Your Goal</label>
              <input
                value={inputs.breakdownGoal || ""}
                onChange={(e) => set("breakdownGoal", e.target.value)}
                placeholder="e.g. Build and launch a mobile app in 3 months"
                disabled={!featureEnabled} id={"aiassistant-your-goal"}
              />
            </div>
            <div className="form-group">
              <label htmlFor={"aiassistant-timeframe"}>Timeframe</label>
              <input
                value={inputs.timeframe || ""}
                onChange={(e) => set("timeframe", e.target.value)}
                placeholder="e.g. 3 months"
                disabled={!featureEnabled} id={"aiassistant-timeframe"}
              />
            </div>
            <button
              className="btn-primary"
              disabled={loading || !inputs.breakdownGoal || !featureEnabled}
              onClick={() =>
                run(breakdown, {
                  goal: inputs.breakdownGoal,
                  timeframe: inputs.timeframe || "3 months",
                })
              }
            >
              {loading ? "⏳ Breaking down..." : "🗺️ Generate Full Breakdown"}
            </button>
          </div>
        )}
        {activePanel === "estimate" && (
          <div>
            <p className="ai-panel-desc">
              AI estimates time required for a task with breakdown.
            </p>
            <div className="form-group">
              <label htmlFor={"aiassistant-task-title"}>Task Title</label>
              <input
                value={inputs.estTitle || ""}
                onChange={(e) => set("estTitle", e.target.value)}
                placeholder="e.g. Build user authentication system"
                disabled={!featureEnabled} id={"aiassistant-task-title"}
              />
            </div>
            <div className="form-group">
              <label htmlFor={"aiassistant-task-description"}>Task Description</label>
              <textarea
                value={inputs.estDesc || ""}
                onChange={(e) => set("estDesc", e.target.value)}
                rows={3}
                placeholder="More details..."
                disabled={!featureEnabled} id={"aiassistant-task-description"}
              />
            </div>
            <button
              className="btn-primary"
              disabled={loading || !inputs.estTitle || !featureEnabled}
              onClick={() =>
                run(estimateTask, {
                  title: inputs.estTitle,
                  description: inputs.estDesc,
                })
              }
            >
              {loading ? "⏳ Estimating..." : "⏱️ Estimate Time"}
            </button>
          </div>
        )}
        {activePanel === "prioritize" && (
          <div>
            <p className="ai-panel-desc">
              AI analyzes all your pending tasks and suggests optimal priority
              order.
            </p>
            <button
              className="btn-primary"
              onClick={() => run(prioritizeTasks)}
              disabled={loading || !featureEnabled}
            >
              {loading ? "⏳ Analyzing..." : "📊 Prioritize My Tasks"}
            </button>
          </div>
        )}
        {activePanel === "weekly" && (
          <div>
            <p className="ai-panel-desc">
              AI creates a structured weekly plan based on your tasks.
            </p>
            <button
              className="btn-primary"
              onClick={() => run(getWeeklyPlan)}
              disabled={loading || !featureEnabled}
            >
              {loading ? "⏳ Planning..." : "📆 Generate Weekly Plan"}
            </button>
          </div>
        )}
        {activePanel === "risks" && (
          <div>
            <p className="ai-panel-desc">
              AI identifies project risks and suggests mitigation strategies.
            </p>
            <button
              className="btn-primary"
              onClick={() => run(detectRisks)}
              disabled={loading || !featureEnabled}
            >
              {loading ? "⏳ Analyzing..." : "⚠️ Detect Risks"}
            </button>
          </div>
        )}
        {activePanel === "burnout" && (
          <div>
            <p className="ai-panel-desc">
              AI analyzes your workload and checks for burnout indicators.
            </p>
            <button
              className="btn-primary"
              onClick={() => run(burnoutCheck)}
              disabled={loading || !featureEnabled}
            >
              {loading ? "⏳ Checking..." : "💊 Check Burnout Risk"}
            </button>
          </div>
        )}
        {activePanel === "predict" && (
          <div>
            <p className="ai-panel-desc">
              AI predicts upcoming risks and failure patterns.
            </p>
            <button
              className="btn-primary"
              onClick={() => run(predictRisks)}
              disabled={loading || !featureEnabled}
            >
              {loading ? "⏳ Predicting..." : "🔮 Predict Risks"}
            </button>
          </div>
        )}
        {activePanel === "team" && (
          <div>
            <p className="ai-panel-desc">
              AI analyzes team performance and workload distribution.
            </p>
            <button
              className="btn-primary"
              onClick={() => run(teamInsights)}
              disabled={loading || !featureEnabled}
            >
              {loading ? "⏳ Analyzing..." : "👥 Get Team Insights"}
            </button>
          </div>
        )}
        {activePanel === "deps" && (
          <div>
            <p className="ai-panel-desc">
              AI automatically detects logical dependencies between your tasks.
            </p>
            <button
              className="btn-primary"
              onClick={() => run(detectDependencies)}
              disabled={loading || !featureEnabled}
            >
              {loading ? "⏳ Detecting..." : "🔗 Detect Dependencies"}
            </button>
          </div>
        )}
        {activePanel === "ask" && (
          <div>
            <p className="ai-panel-desc">
              Ask questions about your project data in natural language.
            </p>
            <div className="form-group">
              <label htmlFor={"aiassistant-your-question"}>Your Question</label>
              <input
                value={inputs.question || ""}
                onChange={(e) => set("question", e.target.value)}
                placeholder="e.g. Which projects are at risk? What should I focus on?"
                disabled={!featureEnabled} id={"aiassistant-your-question"}
              />
            </div>
            <button
              className="btn-primary"
              disabled={loading || !inputs.question || !featureEnabled}
              onClick={() => run(askKnowledge, { question: inputs.question })}
            >
              {loading ? "⏳ Thinking..." : "🧠 Ask"}
            </button>
          </div>
        )}

        <ResultCard data={result} onClose={() => setResult(null)} />
      </div>
    );
  };

  return (
    <div className="ai-assistant-root">
      <PageHeader
        icon="🤖"
        title="AI Assistant"
        description="Your intelligent project management companion"
        action={
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <span style={{ fontSize: "12px", color: "#888" }}>
              AI: {settings?.aiEnabled ? "🟢 ON" : "🔴 OFF"}
            </span>
            <button
              className={settings?.aiEnabled ? "btn-secondary" : "btn-primary"}
              style={{ fontSize: "12px", padding: "6px 14px" }}
              onClick={handleToggleAI}
            >
              {settings?.aiEnabled ? "Turn Off AI" : "Turn On AI"}
            </button>
            <button
              className="btn-secondary"
              style={{ fontSize: "12px", padding: "6px 14px" }}
              onClick={() => navigate("/ai-settings")}
            >
              ⚙️ Settings
            </button>
          </div>
        }
      />

      <div className="ai-assistant-layout">
        <div className="ai-sidebar-panels">
          {PANELS.map((p) => {
            const isOn = settings?.aiEnabled && settings?.features?.[p.feature];
            return (
              <button
                key={p.key}
                className={`ai-panel-btn ${activePanel === p.key ? "active" : ""}`}
                onClick={() => {
                  setActivePanel(p.key);
                  setResult(null);
                }}
              >
                <span className="ai-panel-btn-label">
                  {p.label}
                  {!isOn && (
                    <span
                      style={{
                        opacity: 0.5,
                        fontSize: "10px",
                        marginLeft: "4px",
                      }}
                    >
                      ○
                    </span>
                  )}
                  {isOn && (
                    <span
                      style={{
                        fontSize: "10px",
                        marginLeft: "4px",
                        color: activePanel === p.key ? "#fff" : "#10b981",
                      }}
                    >
                      ●
                    </span>
                  )}
                </span>
                <span className="ai-panel-btn-desc">{p.desc}</span>
              </button>
            );
          })}
        </div>
        <div className="ai-main-panel">{renderPanel()}</div>
      </div>
    </div>
  );
}

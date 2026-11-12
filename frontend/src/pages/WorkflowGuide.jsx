import { useState } from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "../components/PageHeader";

// ── Workflow definitions per user role ──────────────────────────
const WORKFLOWS = [
  {
    id: "project-manager",
    icon: "🗂",
    label: "Project Manager",
    // literal hex: concatenated with an alpha suffix below (e.g. `${color}22`)
    color: "#5B5FEE",
    tagline: "Plan, delegate, and track project delivery",
    steps: [
      {
        step: 1, icon: "📁", title: "Create a Workspace",
        desc: "Your workspace is the home for all your team's work. Set it up with a name, logo, and timezone.",
        action: "Set up workspace", to: "/settings/general",
        tip: "Invite your team right after creating the workspace.",
      },
      {
        step: 2, icon: "📂", title: "Create Projects",
        desc: "Break your work into projects. Each project can have sub-projects, categories, and a linked goal.",
        action: "New project", to: "/projects?new=true",
        tip: "Use categories to group related projects (e.g. 'Backend', 'Marketing').",
      },
      {
        step: 3, icon: "✅", title: "Add Tasks",
        desc: "Add tasks to each project with assignees, due dates, priorities, and custom fields.",
        action: "Create tasks", to: "/tasks",
        tip: "Use the Kanban board for a visual overview of task progress.",
      },
      {
        step: 4, icon: "🎯", title: "Set Goals",
        desc: "Link projects to goals. Goals track the 'why' behind your work and show overall progress.",
        action: "Set a goal", to: "/goals?new=true",
        tip: "Goals with sub-goals give you a hierarchy: Company → Team → Personal.",
      },
      {
        step: 5, icon: "⚡", title: "Run Sprints",
        desc: "Use sprints to time-box work into 1–4 week cycles. Start a sprint and move tasks in.",
        action: "Start sprint", to: "/sprints",
        tip: "Review your burndown chart daily to spot blockers early.",
      },
      {
        step: 6, icon: "📊", title: "Track & Report",
        desc: "Use the Dashboard, Reports, and Analytics pages to monitor delivery and share status updates.",
        action: "Open reports", to: "/reports",
        tip: "Schedule weekly reports to be emailed to stakeholders automatically.",
      },
    ],
  },
  {
    id: "developer",
    icon: "💻",
    label: "Developer",
    color: "#0ea5e9",
    tagline: "Ship code faster with structured workflows",
    steps: [
      {
        step: 1, icon: "🗂", title: "Join your Workspace",
        desc: "Accept the invitation link from your team lead. Your role and permissions are set automatically.",
        action: "Check invitations", to: "/team",
        tip: "Ask your admin to set your role to ADMIN if you need to create sprints.",
      },
      {
        step: 2, icon: "🏃", title: "Pick up Sprint Tasks",
        desc: "Check the active sprint for tasks assigned to you. Update status as you work.",
        action: "Open sprint", to: "/sprints",
        tip: "Use IN_PROGRESS status to signal you've started — the PM's board updates live.",
      },
      {
        step: 3, icon: "🗂", title: "Use the Jira-style Board",
        desc: "Move tasks across columns (To Do → In Progress → Done) with drag and drop.",
        action: "Open board", to: "/jira-board",
        tip: "Filter by your name to see only your tasks.",
      },
      {
        step: 4, icon: "🚀", title: "Log Deployments",
        desc: "After each release, log a deployment to track DORA metrics and failure rates.",
        action: "Log deployment", to: "/deployments",
        tip: "Connect your CI/CD webhook to log deployments automatically.",
      },
      {
        step: 5, icon: "📝", title: "Write Docs",
        desc: "Document decisions, architecture, and runbooks in the Knowledge Base.",
        action: "Open docs", to: "/docs",
        tip: "Use /task to embed a related task directly inside a doc.",
      },
      {
        step: 6, icon: "🤖", title: "Use AI Features",
        desc: "Let AI estimate task effort, detect dependencies, and flag delay risks automatically.",
        action: "Try AI", to: "/ai",
        tip: "Enable 'Smart Prioritization' to have AI order your backlog by urgency.",
      },
    ],
  },
  {
    id: "team-lead",
    icon: "👥",
    label: "Team Lead",
    color: "#1E8E5A",
    tagline: "Align your team and unblock delivery",
    steps: [
      {
        step: 1, icon: "👥", title: "Manage your Team",
        desc: "Invite members, set roles, and track who's online. ADMIN role can manage sprints and tasks.",
        action: "Team page", to: "/team",
        tip: "Use presence indicators to see who's active right now.",
      },
      {
        step: 2, icon: "🎯", title: "Align on Goals",
        desc: "Set team-level goals and link projects to them. Every sprint should move the needle on a goal.",
        action: "View goals", to: "/goals",
        tip: "Review goal progress in your weekly team meeting.",
      },
      {
        step: 3, icon: "📋", title: "Run Standups",
        desc: "Use the Standup feature to collect async updates from your team without a meeting.",
        action: "Standup", to: "/channels",
        tip: "AI can auto-generate standup summaries from task activity.",
      },
      {
        step: 4, icon: "⚡", title: "Plan Sprints",
        desc: "Create a sprint, add tasks from the backlog, and set a capacity target for the team.",
        action: "Plan sprint", to: "/sprints",
        tip: "Use story points for capacity planning — the burndown tracks automatically.",
      },
      {
        step: 5, icon: "🔥", title: "Monitor Risks",
        desc: "Use AI Intelligence to see which tasks are at risk of missing deadlines before it happens.",
        action: "AI insights", to: "/ai-intelligence",
        tip: "Set up Automations to alert you when a task becomes overdue.",
      },
      {
        step: 6, icon: "📈", title: "Review in Meetings",
        desc: "Record meeting notes, assign action items as tasks, and track decisions in the Decision Log.",
        action: "Meetings", to: "/meetings",
        tip: "AI can extract tasks from meeting notes automatically.",
      },
    ],
  },
  {
    id: "executive",
    icon: "🏢",
    label: "Executive / Stakeholder",
    color: "#C17D22",
    tagline: "Get the full picture without the noise",
    steps: [
      {
        step: 1, icon: "📊", title: "Executive Dashboard",
        desc: "See KPIs, portfolio health, goal progress, and delivery metrics in one view.",
        action: "Open dashboard", to: "/executive",
        tip: "Bookmark this page — it refreshes automatically every 30 seconds.",
      },
      {
        step: 2, icon: "💼", title: "Portfolio Overview",
        desc: "See all projects across the portfolio with RAG status, budget, and timeline.",
        action: "Portfolio", to: "/portfolio",
        tip: "Use Portfolio+ for cross-project dependencies and programme management.",
      },
      {
        step: 3, icon: "🎯", title: "Goal Progress",
        desc: "Company goals roll up from team goals → project goals → task completion.",
        action: "Goals", to: "/goals",
        tip: "Set quarterly goals (OKRs) and review progress monthly.",
      },
      {
        step: 4, icon: "💰", title: "ROI Engine",
        desc: "Track investment, revenue, and return on investment per project.",
        action: "ROI Engine", to: "/roi",
        tip: "Projects with negative ROI after 6 months should be reviewed for scope changes.",
      },
      {
        step: 5, icon: "📈", title: "Reports",
        desc: "Generate summary reports by week/month/quarter and share them with your board.",
        action: "Reports", to: "/reports",
        tip: "Schedule automated reports to be emailed every Monday morning.",
      },
      {
        step: 6, icon: "⚙️", title: "Configure & Govern",
        desc: "Set workspace policies, IP allowlists, audit logs, and compliance settings in Admin Center.",
        action: "Admin Center", to: "/admin",
        tip: "Activity logs track every change for compliance and audit purposes.",
      },
    ],
  },
];

// ── Step Card ────────────────────────────────────────────────────
function StepCard({ step, color, isLast }) {
  const navigate = useNavigate();
  return (
    <div style={{
      display: "flex", gap: "0", alignItems: "stretch",
    }}>
      {/* Connector line */}
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", width:"40px", flexShrink:0 }}>
        <div style={{
          width: "32px", height: "32px", borderRadius: "50%",
          background: color, color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 800, fontSize: "13px", flexShrink: 0, zIndex: 1,
          boxShadow: `0 0 0 3px ${color}22`,
        }}>{step.step}</div>
        {!isLast && (
          <div style={{ width: "2px", flex: 1, background: `${color}30`, minHeight: "32px", marginTop: "4px" }} />
        )}
      </div>

      {/* Card body */}
      <div style={{
        flex: 1, background: "var(--bg-card, #fff)",
        border: "1px solid var(--border, var(--border))",
        borderRadius: "10px", padding: "14px 16px",
        marginLeft: "12px", marginBottom: isLast ? 0 : "12px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
          <span style={{ fontSize: "18px" }}>{step.icon}</span>
          <span style={{ fontWeight: 700, fontSize: "14px", color: "var(--gray-800, var(--gray-800))" }}>
            {step.title}
          </span>
        </div>
        <p style={{ fontSize: "13px", color: "var(--gray-600, var(--gray-600))", lineHeight: 1.6, margin: "0 0 8px" }}>
          {step.desc}
        </p>
        {step.tip && (
          <div style={{
            fontSize: "12px", color: "var(--warning)", background: "#fffbeb",
            border: "1px solid #fde68a", borderRadius: "6px",
            padding: "6px 10px", marginBottom: "10px",
          }}>
            {step.tip}
          </div>
        )}
        <button
          onClick={() => navigate(step.to)}
          style={{
            padding: "6px 14px", borderRadius: "6px", border: "none",
            background: color, color: "#fff",
            fontSize: "12px", fontWeight: 600, cursor: "pointer",
          }}
        >
          {step.action} →
        </button>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────
export default function WorkflowGuide() {
  const [selected, setSelected] = useState(null);
  const workflow = WORKFLOWS.find(w => w.id === selected);

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "0 16px 40px" }}>
      <PageHeader
        icon="🗺"
        title="Workflow Guide"
        description="Choose your role to see how to use Prowosma as your execution operating system"
      />

      {/* Role selector */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
        gap: "14px",
        marginBottom: "32px",
      }}>
        {WORKFLOWS.map(w => (
          <div
            key={w.id}
            onClick={() => setSelected(selected === w.id ? null : w.id)}
            style={{
              background: selected === w.id ? w.color : "var(--bg-card, #fff)",
              border: `2px solid ${selected === w.id ? w.color : "var(--border, var(--border))"}`,
              borderRadius: "12px",
              padding: "20px 16px",
              cursor: "pointer",
              transition: "all 0.15s",
              textAlign: "center",
            }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => setSelected(selected === w.id ? null : w.id))?.(e); } }}
          >
            <div style={{ fontSize: "32px", marginBottom: "8px" }}>{w.icon}</div>
            <div style={{
              fontWeight: 700, fontSize: "14px",
              color: selected === w.id ? "#fff" : "var(--gray-800, var(--gray-800))",
              marginBottom: "4px",
            }}>{w.label}</div>
            <div style={{
              fontSize: "11px",
              color: selected === w.id ? "rgba(255,255,255,0.8)" : "var(--gray-500, var(--gray-500))",
              lineHeight: 1.4,
            }}>{w.tagline}</div>
          </div>
        ))}
      </div>

      {/* Steps */}
      {workflow && (
        <div>
          <div style={{
            display: "flex", alignItems: "center", gap: "10px",
            marginBottom: "20px",
            padding: "14px 18px",
            background: `${workflow.color}10`,
            border: `1px solid ${workflow.color}30`,
            borderRadius: "10px",
          }}>
            <span style={{ fontSize: "24px" }}>{workflow.icon}</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: "15px", color: workflow.color }}>
                {workflow.label} Workflow
              </div>
              <div style={{ fontSize: "12px", color: "var(--gray-500)", marginTop: "2px" }}>
                {workflow.steps.length} steps to get started
              </div>
            </div>
          </div>

          <div style={{ paddingLeft: "0" }}>
            {workflow.steps.map((step, i) => (
              <StepCard
                key={step.step}
                step={step}
                color={workflow.color}
                isLast={i === workflow.steps.length - 1}
              />
            ))}
          </div>
        </div>
      )}

      {!workflow && (
        <div style={{
          textAlign: "center", padding: "40px",
          color: "var(--gray-400, var(--gray-400))", fontSize: "14px",
        }}>
          Select your role above to see your personalised workflow
        </div>
      )}
    </div>
  );
}

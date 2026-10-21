import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, NavLink, Link, Navigate, useLocation } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import Projects from "./pages/Projects";
const Tasks = lazy(() => import("./pages/Tasks"));
const Goals = lazy(() => import("./pages/Goals"));
const Categories = lazy(() => import("./pages/Categories"));
import Breadcrumb from "./components/Breadcrumb";
import SidebarBadge from "./components/SidebarBadge";
import GlobalLoadingBar from "./components/GlobalLoadingBar";
const Search = lazy(() => import("./pages/Search"));
import "./App.css";
import ThemeToggle from "./components/ThemeToggle";
const Calendar = lazy(() => import("./pages/Calendar"));
const Kanban = lazy(() => import("./pages/Kanban"));
const Sprints = lazy(() => import("./pages/Sprints"));
const Portfolio = lazy(() => import("./pages/Portfolio"));
const Importer = lazy(() => import("./pages/Importer"));
const Automations = lazy(() => import("./pages/Automations"));
const KpiTracker = lazy(() => import("./pages/KpiTracker"));
const AdminCenter = lazy(() => import("./pages/AdminCenter"));
const ExecutiveDashboard = lazy(() => import("./pages/ExecutiveDashboard"));
const AIIntelligence = lazy(() => import("./pages/AIIntelligence"));
const RoadmapAndRaid = lazy(() => import("./pages/RoadmapAndRaid"));
const PortfolioPlus = lazy(() => import("./pages/PortfolioPlus"));
const Channels = lazy(() => import("./pages/Channels"));
const BpmStudio = lazy(() => import("./pages/BpmStudio"));
const RoiEngine = lazy(() => import("./pages/RoiEngine"));
const DecisionLog = lazy(() => import("./pages/DecisionLog"));
const ChangeRequests = lazy(() => import("./pages/ChangeRequests"));
const ScenarioPlanning = lazy(() => import("./pages/ScenarioPlanning"));
import Epics               from "./pages/Epics";
const DeploymentAnalytics = lazy(() => import("./pages/DeploymentAnalytics"));
import KnowledgeGraph      from "./pages/KnowledgeGraph";
import MagicLogin   from "./pages/MagicLogin";
const Team = lazy(() => import("./pages/Team"));
import { AuthProvider } from "./context/AuthContext.jsx";
import { useAuth } from "./hooks/useAuth";
const ImportExport = lazy(() => import("./pages/ImportExport"));
import { pingPresence } from "./api/team";
import Login from "./pages/Login";
import ProtectedRoute from "./components/ProtectedRoute";
import { useNavigate } from "react-router-dom";
const ActivityLog = lazy(() => import("./pages/ActivityLog"));
const Reports = lazy(() => import("./pages/Reports"));
import NotificationBell from "./components/NotificationBell";
import LiveClock from "./components/LiveClock";
import LiveActivityFeed from "./components/LiveActivityFeed";
import ConnectionStatus from "./components/ConnectionStatus";
import AIStatus from "./components/AIStatus";
import PWAInstallBanner from "./components/PWAInstallBanner";
import OnboardingChecklist from "./components/OnboardingChecklist";
import CommandPalette from "./components/CommandPalette";
import ShortcutsHelp from "./components/ShortcutsHelp";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { getDashboardSummary } from "./api/dashboard";
const CustomFields = lazy(() => import("./pages/CustomFields"));
const Integrations = lazy(() => import("./pages/Integrations"));
const MeetingAssistant = lazy(() => import("./pages/MeetingAssistant"));
const MeetingPlatforms = lazy(() => import("./pages/MeetingPlatforms"));
const GoogleMeetCallback = lazy(() => import("./pages/GoogleMeetCallback"));
const AIAssistant = lazy(() => import("./pages/AIAssistant"));
const AISettings = lazy(() => import("./pages/AISettings"));
const AccessControl = lazy(() => import("./pages/AccessControl"));
// ThemeSwitcher (named color themes), FontSwitcher, and DesignSwitcher (50
// built-in skins + a custom color-picker) removed — a product with a fixed,
// deliberate visual identity doesn't let every viewer swap it out at
// runtime; see the design-system redesign notes. ThemeToggle (real
// light/dark only) is the one appearance control that remains.
import HelpGuide from "./components/HelpGuide";
import ChatBot from "./components/ChatBot";
const Licensing = lazy(() => import("./pages/Licensing"));
const WhiteLabel = lazy(() => import("./pages/WhiteLabel"));
const JiraBoard          = lazy(() => import("./pages/JiraBoard"));
const JiraBoardSettings  = lazy(() => import("./pages/JiraBoardSettings"));
import WorkspaceSwitcher from "./components/WorkspaceSwitcher";
const WorkflowGuide = lazy(() => import('./pages/WorkflowGuide'));
const WorkspaceSetup = lazy(() => import("./pages/WorkspaceSetup"));
const Gantt = lazy(() => import("./pages/Gantt"));
const Analytics = lazy(() => import("./pages/Analytics"));
const DeveloperPortal = lazy(() => import("./pages/DeveloperPortal"));
const TimeTracking = lazy(() => import("./pages/TimeTracking"));
import ProfileSettings from "./pages/ProfileSettings";
const WorkspaceSettings = lazy(() => import("./pages/WorkspaceSettings"));
import CanDo from "./components/CanDo";
import RoleBadge from "./components/RoleBadge";
import { useRole } from "./hooks/useRole";
import AcceptInvite from "./pages/AcceptInvite";
import Auth0Callback from "./pages/Auth0Callback";
import { RoleProvider } from "./context/RoleContext.jsx";
import { AccessProvider } from "./context/AccessContext.jsx";
import { useAccess } from "./hooks/useAccess";
import { isPathAllowedForRestricted, RESTRICTED_LANDING } from "./utils/accessAreas";
import { ToastProvider } from "./components/Toast";
import { ConfirmProvider } from "./components/ConfirmDialog";
const Docs = lazy(() => import("./pages/Docs"));
import Meetings  from "./pages/Meetings";
import Sops      from "./pages/Sops";

import { usePWA } from "./hooks/usePWA";


/* ── Upgrade / Licensing CTA — always visible in topbar ────────── */
function UpgradeCTA() {
  const navigate = useNavigate();
  return (
    <button
      className="upgrade-cta-btn"
      onClick={() => navigate("/licensing")}
      title="View plans & pricing"
    >
      <span className="upgrade-cta-icon">💎</span>
      <span className="upgrade-cta-label">Upgrade</span>
    </button>
  );
}

function UserMenu() {
  const { user, logoutUser } = useAuth();
  const { role } = useRole();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { isInstalled } = usePWA();

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (!user) return null;

  const initials = user.name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div style={{ position: "relative" }} ref={ref}>
      <div className="user-avatar-btn" onClick={() => setOpen((o) => !o)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => setOpen((o) => !o))?.(e); } }}>
        <div className="user-avatar">{initials}</div>
        <span className="user-name">{user.name}</span>
        <RoleBadge role={role} />
        <span style={{ fontSize: "10px", color: "#aaa" }}>▼</span>
      </div>
      {open && (
        <div className="user-menu-dropdown">
          <div className="user-menu-info">
            <div style={{ fontWeight: 600 }}>{user.name}</div>
            <div style={{ fontSize: "12px", color: "#888" }}>{user.email}</div>
          </div>
          <div className="user-menu-divider" />
          <button
            className="user-menu-item"
            onClick={() => { navigate("/profile"); setOpen(false); }}
          >
            👤 Profile & Security
          </button>
          {!isInstalled && (
            <button
              className="user-menu-item"
              onClick={() => {
                setOpen(false);
                window.dispatchEvent(new CustomEvent('prowosma:show-install'));
              }}
            >
              📱 Install App
            </button>
          )}
          {isInstalled && (
            <div className="user-menu-item" style={{ color: "#10b981", cursor: "default" }}>
              ✅ App Installed
            </div>
          )}
          <div className="user-menu-divider" />
          <button
            className="user-menu-item"
            onClick={() => { logoutUser(); navigate("/login"); setOpen(false); }}
          >
            🚪 Sign Out
          </button>
        </div>
      )}
    </div>
  );
}


/* ── Page skeleton — shown while lazy chunks load ────────────── */
function PageSkeleton() {
  return (
    <div style={{
      flex:1, display:"flex", flexDirection:"column", gap:16, padding:"24px 32px",
      background:"var(--bg-page,#f8fafc)"
    }}>
      <div style={{height:28,width:"35%",borderRadius:8,
        background:"linear-gradient(90deg,#e2e8f0 25%,#f1f5f9 50%,#e2e8f0 75%)",
        backgroundSize:"200% 100%", animation:"shimmer 1.4s infinite"}}/>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12}}>
        {[1,2,3,4].map(i=>(
          <div key={i} style={{height:80,borderRadius:12,
            background:"linear-gradient(90deg,#e2e8f0 25%,#f1f5f9 50%,#e2e8f0 75%)",
            backgroundSize:"200% 100%", animation:"shimmer 1.4s infinite",
            animationDelay:`${i*0.1}s`}}/>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 300px",gap:16,flex:1}}>
        <div style={{borderRadius:16,background:"linear-gradient(90deg,#e2e8f0 25%,#f1f5f9 50%,#e2e8f0 75%)",
          backgroundSize:"200% 100%", animation:"shimmer 1.4s infinite", minHeight:320}}/>
        <div style={{borderRadius:16,background:"linear-gradient(90deg,#e2e8f0 25%,#f1f5f9 50%,#e2e8f0 75%)",
          backgroundSize:"200% 100%", animation:"shimmer 1.4s infinite"}}/>
      </div>
      <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <GlobalLoadingBar />
      <AuthProvider>
        <RoleProvider>
          <AccessProvider>
          <ToastProvider>
          <ConfirmProvider>
            <AppShell />
          </ConfirmProvider>
          </ToastProvider>
          </AccessProvider>
        </RoleProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}


// ── Collapsible sidebar group ─────────────────────────────────
function SidebarGroup({ label, icon, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="sidebar-group">
      <button className="sidebar-group-header" onClick={() => setOpen(v => !v)}>
        <span className="sidebar-group-icon">{icon}</span>
        <span className="sidebar-group-label">{label}</span>
        <span className="sidebar-group-chevron">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="sidebar-group-items">{children}</div>}
    </div>
  );
}

// ── Main sidebar navigation ───────────────────────────────────
function SidebarNav({ onNav, badges }) {
  const { restricted, can } = useAccess();
  if (restricted) {
    // Department / assigned-work access: only the areas that are scoped to them. The API refuses the rest.
    return (
      <>
        <WorkspaceSwitcher />
        <div className="sidebar-quicklinks">
          <NavLink to="/tasks" onClick={onNav}>✅ My Tasks</NavLink>
          <NavLink to="/kanban" onClick={onNav}>🗂 Kanban</NavLink>
          <NavLink to="/calendar" onClick={onNav}>🗓 Calendar</NavLink>
          <NavLink to="/projects" onClick={onNav}>📁 Projects</NavLink>
          <NavLink to="/gantt" onClick={onNav}>📅 Gantt</NavLink>
          <NavLink to="/goals" onClick={onNav}>🎯 Goals</NavLink>
          <NavLink to="/sprints" onClick={onNav}>🏃 Sprints</NavLink>
          <NavLink to="/epics" onClick={onNav}>🗃 Epics</NavLink>
          <NavLink to="/releases" onClick={onNav}>🚀 Releases</NavLink>
          <NavLink to="/roadmap" onClick={onNav}>🗺️ Roadmap & RAID</NavLink>
          <NavLink to="/change-requests" onClick={onNav}>🔧 Change Requests</NavLink>
          <NavLink to="/portfolio-plus" onClick={onNav}>🏗 Portfolio+</NavLink>
          <NavLink to="/docs" onClick={onNav}>📄 Docs</NavLink>
          <NavLink to="/sops" onClick={onNav}>📖 SOPs</NavLink>
          <NavLink to="/decisions" onClick={onNav}>🧠 Decisions</NavLink>
          <NavLink to="/channels" onClick={onNav}>💬 Channels</NavLink>
          <NavLink to="/reports" onClick={onNav}>📋 Reports</NavLink>
          <NavLink to="/analytics" onClick={onNav}>📈 Analytics</NavLink>
          <NavLink to="/time-tracking" onClick={onNav}>⏱ Time</NavLink>
          <NavLink to="/ai" onClick={onNav}>🤖 AI Assistant</NavLink>
          {can("USE_MEETING_ASSISTANT") && <NavLink to="/meeting-assistant" onClick={onNav}>🤖 Meeting Assistant</NavLink>}
          <NavLink to="/team" onClick={onNav}>👥 Members</NavLink>
        </div>
        <div style={{ flex: 1 }} />
        <div className="sidebar-bottom-links">
          <NavLink to="/profile" onClick={onNav}>👤 Profile</NavLink>
        </div>
      </>
    );
  }
  return (
    <>
      <WorkspaceSwitcher />

      <div className="sidebar-quicklinks">
        <NavLink to="/" end onClick={onNav} className="sidebar-quicklink">
          <span>📊</span><span>Dashboard</span>
        </NavLink>
      </div>

      <SidebarGroup label="Work" icon="⚡">
        <NavLink to="/projects" onClick={onNav} style={{ display: "flex", alignItems: "center" }}>
          📁 Projects
          <SidebarBadge count={badges?.overdueProjects} />
        </NavLink>
        <NavLink to="/tasks"    onClick={onNav} style={{ display: "flex", alignItems: "center" }}>
          ✅ Tasks
          <SidebarBadge count={badges?.overdueTasksOnly} />
        </NavLink>
        <NavLink to="/goals"    onClick={onNav}>🎯 Goals</NavLink>
        <NavLink to="/kanban"      onClick={onNav}>🗂 Kanban</NavLink>
        <NavLink to="/jira-board"  onClick={onNav}>📌 Jira Board</NavLink>
        <NavLink to="/epics"    onClick={onNav}>🗃 Epics</NavLink>
        <NavLink to="/deployments" onClick={onNav}>🚀 Deployments</NavLink>
        <NavLink to="/knowledge-graph" onClick={onNav}>🕸 Knowledge Graph</NavLink>
        <NavLink to="/sprints"  onClick={onNav}>🏃 Sprints</NavLink>
        <NavLink to="/gantt"    onClick={onNav}>📅 Gantt</NavLink>
        <NavLink to="/calendar" onClick={onNav}>🗓 Calendar</NavLink>
      </SidebarGroup>

      <SidebarGroup label="Knowledge" icon="📚" defaultOpen={false}>
        <NavLink to="/docs"      onClick={onNav}>📄 Docs</NavLink>
        <NavLink to="/meetings"  onClick={onNav}>🎙 Meetings</NavLink>
        <NavLink to="/meeting-assistant" onClick={onNav}>🤖 Meeting Assistant</NavLink>
        <NavLink to="/sops"      onClick={onNav}>📖 SOPs</NavLink>
      </SidebarGroup>

      <SidebarGroup label="Insights" icon="📊" defaultOpen={false}>
        <NavLink to="/analytics"    onClick={onNav}>📈 Analytics</NavLink>
        <NavLink to="/portfolio"    onClick={onNav}>📦 Portfolio</NavLink>
        <NavLink to="/roadmap"      onClick={onNav}>🗺️ Roadmap & RAID</NavLink>
        <NavLink to="/change-requests" onClick={onNav}>🔧 Change Requests</NavLink>
        <NavLink to="/portfolio-plus" onClick={onNav}>🏗 Portfolio+</NavLink>
        <NavLink to="/kpis"         onClick={onNav}>📊 KPI Tracker</NavLink>
        <NavLink to="/executive"    onClick={onNav}>📊 Executive</NavLink>
        <NavLink to="/roi"          onClick={onNav}>💰 ROI Engine</NavLink>
        <NavLink to="/scenarios"    onClick={onNav}>🔮 Scenarios</NavLink>
        <NavLink to="/decisions"    onClick={onNav}>🧠 Decisions</NavLink>
        <NavLink to="/reports"      onClick={onNav}>📋 Reports</NavLink>
        <NavLink to="/time-tracking" onClick={onNav}>⏱ Time & Billing</NavLink>
      </SidebarGroup>

      <SidebarGroup label="Automate" icon="⚙️" defaultOpen={false}>
        <NavLink to="/bpm"          onClick={onNav}>🔀 BPM Studio</NavLink>
        <NavLink to="/automations"  onClick={onNav}>⚡ Automations</NavLink>
        <NavLink to="/import-export" onClick={onNav}>📦 Import / Export</NavLink>
        <NavLink to="/integrations" onClick={onNav}>🔌 Integrations</NavLink>
        <NavLink to="/import"       onClick={onNav}>📥 Import</NavLink>
      </SidebarGroup>

      <SidebarGroup label="Collaborate" icon="💬" defaultOpen={false}>
        <NavLink to="/channels"    onClick={onNav}>💬 Channels</NavLink>
      </SidebarGroup>
      <SidebarGroup label="Team" icon="👥" defaultOpen={false}>
        <NavLink to="/team"     onClick={onNav}>👥 Members</NavLink>
        <NavLink to="/activity" onClick={onNav}>📋 Activity Log</NavLink>
      </SidebarGroup>

      <SidebarGroup label="Configure" icon="🔧" defaultOpen={false}>
        <NavLink to="/categories"   onClick={onNav}>🏷 Categories</NavLink>
        <NavLink to="/custom-fields" onClick={onNav}>⚙️ Custom Fields</NavLink>
        <CanDo action="manageSettings">
          <NavLink to="/workspace-settings" onClick={onNav}>🏢 Workspace</NavLink>
        </CanDo>
        <CanDo action="adminOnly">
          <NavLink to="/admin"     onClick={onNav}>🛡 Admin Centre</NavLink>
          <NavLink to="/access-control" onClick={onNav}>🔐 Access Control</NavLink>
        </CanDo>
        <NavLink to="/white-label" onClick={onNav}>🎨 White-label</NavLink>
        <NavLink to="/jira-board/settings" onClick={onNav}>⚙️ Jira Settings</NavLink>
        <NavLink to="/developer" onClick={onNav}>🛠 Developer</NavLink>
      </SidebarGroup>

      <SidebarGroup label="AI" icon="🤖" defaultOpen={false}>
        <NavLink to="/ai"             onClick={onNav}>🤖 AI Assistant</NavLink>
        <NavLink to="/ai-intelligence" onClick={onNav}>🧠 AI Intelligence</NavLink>
        <NavLink to="/ai-settings"    onClick={onNav}>✨ AI Settings</NavLink>
      </SidebarGroup>

      <div style={{ flex: 1 }} />
      <div className="sidebar-bottom-links">
        <NavLink to="/profile" onClick={onNav}>👤 Profile</NavLink>
      </div>
    </>
  );
}

function AppShell() {
  // Global ESC key — close any open modal overlay
  useEffect(() => {
    const handler = (e) => {
      if (e.key !== "Escape") return;
      const overlay = document.querySelector(".modal-overlay");
      if (overlay) overlay.click();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const { user } = useAuth();
  const { restricted, loading: accessLoading, capabilities: accessCapabilities, can } = useAccess();

  // Pages that render full-screen OUTSIDE the app shell: no sidebar/topbar,
  // and — just as important — none of the shell's authenticated background
  // calls. /invite/accept used to render inside the shell, so a signed-out
  // (or just-signed-out) visitor made the shell's pollers fire unauthenticated
  // requests; the first 401 hard-redirected to /login before the invite page
  // could show anything (e.g. the "you're already a member" message).
  const location = useLocation();
  const isLoginPage  = location.pathname === "/login" || location.pathname === "/auth0/callback";
  const isInvitePage = location.pathname === "/invite/accept";
  const isMagicLinkPage = location.pathname === "/auth/magic";
  const isStandalonePage = isLoginPage || isInvitePage || isMagicLinkPage;

  const [menuOpen, setMenuOpen]           = useState(false);
  const [showPalette, setShowPalette]     = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [badges, setBadges] = useState({
    overdue: 0, today: 0, inProgress: 0, overdueProjects: 0,
  });

  // Multi-skin init calls (initTheme/initFont/initDesign) removed along
  // with the switcher components above — nothing to re-apply from
  // localStorage now that there's one fixed visual identity.

  // ── Register service worker (prod) / unregister (dev) ───────
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1') {
      // Unregister any stale SW on localhost
      navigator.serviceWorker.getRegistrations().then(regs =>
        regs.forEach(r => r.unregister())
      );
      return;
    }
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('[PWA] SW registered:', reg.scope))
      .catch(err => console.warn('[PWA] SW failed:', err));
  }, []);

  // ── A-10: Presence ping ──────────────────────────────────────
  useEffect(() => {
    if (!user || isStandalonePage) return;
    pingPresence().catch(() => {});
    const interval = setInterval(() => pingPresence().catch(() => {}), 60000);
    return () => clearInterval(interval);
  }, [user, isStandalonePage]);

  // ── Keyboard shortcuts (safe — inside Router) ───────────────
  useKeyboardShortcuts({
    onCommandPalette: () => setShowPalette(p => !p),
    onNewTask: () => {},
  });

  useEffect(() => {
    const handler = () => setShowShortcuts(true);
    window.addEventListener("prowosma:show-shortcuts", handler);
    return () => window.removeEventListener("prowosma:show-shortcuts", handler);
  }, []);

  useEffect(() => {
    // Signed out, or on a public full-screen page: there is nothing to badge,
    // and an unauthenticated call here 401s (see isStandalonePage above).
    // Wait until we know whether this person is restricted; the summary is scoped to what they may see.
    if (!user || isStandalonePage || accessLoading) return;
    const fetchBadges = async () => {
      try {
        const res = await getDashboardSummary();
        const data = res.data;
        setBadges({
          overdue: (data.overdueTasks?.length || 0) + (data.overdueProjects?.length || 0) + (data.overdueGoals?.length || 0),
          overdueTasksOnly: data.overdueTasks?.length || 0,
          today: data.todayTasks?.length || 0,
          inProgress: data.inProgressTasks || 0,
          overdueProjects: data.overdueProjects?.length || 0,
        });
      } catch (e) { console.error(e); }
    };
    fetchBadges();
    const interval = setInterval(fetchBadges, 60000);
    return () => clearInterval(interval);
  }, [user, isStandalonePage, accessLoading]);

  const isDashboard   = location.pathname === "/" || location.pathname === "/dashboard";
  const isDocs        = location.pathname.startsWith("/docs");

  // Set document title based on route
  useEffect(() => {
    const titles = {
      "/docs":             "Docs",
      "/decisions":        "Decision Records",
      "/change-requests":  "Change Requests",
      "/meetings":          "Meeting Notes",
      "/meeting-assistant": "Meeting Assistant",
      "/integrations/meeting-platforms": "Meeting Platforms",
      "/sops":              "SOPs",
      "/":                  "Dashboard",
      "/tasks":             "Tasks",
      "/projects":          "Projects",
      "/goals":             "Goals",
      "/kanban":      "Kanban Board",
      "/jira-board":          "Jira Board",
      "/jira-board/settings": "Jira Board Settings",
      "/sprints":           "Sprints",
      "/portfolio":         "Portfolio",
      "/import":            "Import Tasks",
      "/automations":       "Automations",
      "/calendar":          "Calendar",
      "/gantt":             "Gantt Chart",
      "/analytics":         "Analytics",
      "/reports":           "Reports",
      "/search":            "Search",
      "/team":              "Team",
      "/activity":          "Activity Log",
      "/ai-assistant":      "AI Assistant",
      "/time-tracking":     "Time & Billing",
      "/developer":         "Developer Portal",
      "/workspace-settings":"Workspace Settings",
      "/profile":           "Profile & Security",
      "/login":             "Sign In",
    };
    const path = location.pathname;
    const name = titles[path] || path.replace("/", "").replace(/-/g, " ")
      .replace(/\b\w/g, c => c.toUpperCase());
    document.title = name ? `${name} — Prowosma` : "Prowosma";
  }, [location.pathname]);

  // Login / invite / magic-link pages — render full-screen, bypassing the entire app shell
  if (isStandalonePage) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/auth0/callback" element={<Auth0Callback />} />
        <Route path="/invite/accept" element={<AcceptInvite />} />
        <Route path="/auth/magic" element={<MagicLogin />} />
      </Routes>
    );
  }

  return (
    <div className="app">
      {!isLoginPage && <nav className={`sidebar ${menuOpen ? "open" : ""}`}>
              <div className="sidebar-top">
                <button
                  className="menu-close"
                  onClick={() => setMenuOpen(false)}
                  aria-label="Close menu"
                >
                  ✕
                </button>
              </div>
              <SidebarNav onNav={() => setMenuOpen(false)} badges={badges} />
            </nav>}

            {!isLoginPage && menuOpen && (
              <div className="overlay" onClick={() => setMenuOpen(false)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => setMenuOpen(false))?.(e); } }} />
            )}

            <div className="content-wrapper">
              {!isLoginPage && <div className="mobile-header">
                <button className="menu-btn" onClick={() => setMenuOpen(true)}>
                  ☰
                </button>
                <div className="mobile-logo">
                  <img src="/logo-icon.png" alt="" className="logo-icon" />
                  <span>Prowosma</span>
                </div>
              </div>}
              {!isLoginPage && <div className="topbar">
                {/* Left: sidebar toggle + logo */}
                <button className="topbar-sidebar-toggle" onClick={() => setMenuOpen(o => !o)} aria-label="Toggle sidebar">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                    <path d="M9 3v18"/>
                  </svg>
                </button>
                <div className="topbar-logo-row">
                  <img src="/logo-icon.png" alt="" className="topbar-logo-img" />
                  <span className="topbar-logo-txt">Prowosma</span>
                </div>
                {/* Centre: search */}
                <div className="topbar-search-wrap">
                  {(<Link to="/search" className="topbar-search-btn" onClick={() => setShowPalette(true)}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                    <span className="topbar-search-placeholder">Search anything…</span>
                    <span className="topbar-search-kbd">⌘K</span>
                  </Link>)}
                </div>
                {/* Right cluster */}
                <div className="topbar-right-cluster">
                  <LiveClock />
                  <ConnectionStatus />
                  {!restricted && <AIStatus />}
                  <NotificationBell />
                  <HelpGuide />
                  <ThemeToggle />
                  <div className="topbar-divider-v" />
                  <UpgradeCTA />
                  <div className="topbar-divider-v" />
                  <UserMenu />
                </div>
              </div>}
              {!restricted && <ChatBot />}
              {!restricted && <LiveActivityFeed />}
              <PWAInstallBanner />
              <OnboardingChecklist />
              {showPalette && (
                <CommandPalette
                  onClose={() => setShowPalette(false)}
                  onAction={(action) => {
                    if (action === "new-task") window.location.href = "/tasks?new=true";
                    if (action === "new-project") window.location.href = "/projects?new=true";
                    if (action === "new-goal") window.location.href = "/goals?new=true";
                  }}
                />
              )}
              {showShortcuts && (
                <ShortcutsHelp onClose={() => setShowShortcuts(false)} />
              )}
              <main className={`main-content${isDocs ? " no-padding" : isDashboard ? " no-padding db-shell" : " page-scrollable"}`}>
                <Breadcrumb />
                <Suspense fallback={<PageSkeleton />}>
              {restricted && location.pathname !== "/" && !isPathAllowedForRestricted(location.pathname, accessCapabilities) ? (
                <div className="empty-state" role="status">
                  <h2>Not part of your access</h2>
                  <p>This area isn't available with your current access level. You can use your tasks, the projects you're on, and the member list.</p>
                  <Link to={RESTRICTED_LANDING}>Go to my tasks</Link>
                </div>
              ) : (
              <Routes>
                  <Route path="/docs" element={<ProtectedRoute><Docs /></ProtectedRoute>} />
                  <Route path="/meetings"  element={<ProtectedRoute><Meetings  /></ProtectedRoute>} />
                  <Route path="/meeting-assistant" element={<ProtectedRoute><MeetingAssistant /></ProtectedRoute>} />
                  <Route path="/integrations/meeting-platforms" element={<ProtectedRoute><MeetingPlatforms /></ProtectedRoute>} />
                  <Route path="/integrations/meeting-platforms/google-callback" element={<ProtectedRoute><GoogleMeetCallback /></ProtectedRoute>} />
                  <Route path="/sops"      element={<ProtectedRoute><Sops      /></ProtectedRoute>} />
                  <Route
                    path="/"
                    element={
                      <ProtectedRoute>
                        {restricted ? <Navigate to={RESTRICTED_LANDING} replace /> : <Dashboard />}
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/projects"
                    element={
                      <ProtectedRoute>
                        <Projects />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/tasks"
                    element={
                      <ProtectedRoute>
                        <Tasks />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/goals"
                    element={
                      <ProtectedRoute>
                        <Goals />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/categories"
                    element={
                      <ProtectedRoute>
                        <Categories />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/search"
                    element={
                      <ProtectedRoute>
                        <Search />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/kanban"
                    element={
                      <ProtectedRoute>
                        <Kanban />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/jira-board"
                    element={
                      <ProtectedRoute>
                        <JiraBoard />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/jira-board/settings"
                    element={
                      <ProtectedRoute>
                        <JiraBoardSettings />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/sprints"
                    element={
                      <ProtectedRoute>
                        <Sprints />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/portfolio"
                    element={
                      <ProtectedRoute>
                        <Portfolio />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/automations"
                    element={
                      <ProtectedRoute>
                        <Automations />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/kpis"
                    element={
                      <ProtectedRoute>
                        <KpiTracker />
                      </ProtectedRoute>
                    }
                  />
                  <Route path="/admin" element={<ProtectedRoute adminOnly><AdminCenter /></ProtectedRoute>} />
                  <Route path="/access-control" element={<ProtectedRoute adminOnly><AccessControl /></ProtectedRoute>} />
                  <Route path="/licensing"   element={<ProtectedRoute><Licensing /></ProtectedRoute>} />
                  <Route path="/white-label" element={<ProtectedRoute><WhiteLabel /></ProtectedRoute>} />
                  <Route path="/executive" element={<ProtectedRoute><ExecutiveDashboard /></ProtectedRoute>} />
                  <Route path="/roadmap" element={<ProtectedRoute><RoadmapAndRaid /></ProtectedRoute>} />
                  <Route path="/change-requests" element={<ProtectedRoute><ChangeRequests /></ProtectedRoute>} />
                  <Route path="/portfolio-plus" element={<ProtectedRoute><PortfolioPlus /></ProtectedRoute>} />
                  <Route path="/channels" element={<ProtectedRoute><Channels /></ProtectedRoute>} />
                  <Route path="/bpm"      element={<ProtectedRoute><BpmStudio /></ProtectedRoute>} />
                  <Route path="/roi"      element={<ProtectedRoute><RoiEngine /></ProtectedRoute>} />
                  <Route path="/decisions" element={<ProtectedRoute><DecisionLog /></ProtectedRoute>} />
                  <Route path="/scenarios" element={<ProtectedRoute><ScenarioPlanning /></ProtectedRoute>} />
                  <Route path="/epics"     element={<ProtectedRoute><Epics /></ProtectedRoute>} />
                  <Route path="/deployments" element={<ProtectedRoute><DeploymentAnalytics /></ProtectedRoute>} />
                  <Route path="/knowledge-graph" element={<ProtectedRoute><KnowledgeGraph /></ProtectedRoute>} />
                  <Route path="/ai-intelligence" element={<ProtectedRoute><AIIntelligence /></ProtectedRoute>} />
                  <Route
                    path="/import"
                    element={
                      <ProtectedRoute>
                        <Importer />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/calendar"
                    element={
                      <ProtectedRoute>
                        <Calendar />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/team"
                    element={
                      <ProtectedRoute>
                        <Team />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/activity"
                    element={
                      <ProtectedRoute>
                        <ActivityLog />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/reports"
                    element={
                      <ProtectedRoute>
                        <Reports />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/custom-fields"
                    element={
                      <ProtectedRoute>
                        <CustomFields />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/import-export"
                    element={<ProtectedRoute><Suspense fallback={<div className="empty-state">Loading…</div>}><ImportExport /></Suspense></ProtectedRoute>}
                  />
                  <Route
                    path="/integrations"
                    element={
                      <ProtectedRoute>
                        <Integrations />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/ai"
                    element={
                      <ProtectedRoute>
                        <AIAssistant />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/ai-settings"
                    element={
                      <ProtectedRoute>
                        <AISettings />
                      </ProtectedRoute>
                    }
                  />
                  <Route path="/workflow-guide"
                    element={<ProtectedRoute><WorkflowGuide /></ProtectedRoute>}
                  />
                  <Route
                    path="/workspace-setup" element={<WorkspaceSetup />} />
                  <Route
                    path="/gantt"
                    element={
                      <ProtectedRoute>
                        <Gantt />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/analytics"
                    element={
                      <ProtectedRoute>
                        <Analytics />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/developer"
                    element={
                      <ProtectedRoute>
                        <DeveloperPortal />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/time-tracking"
                    element={
                      <ProtectedRoute>
                        <TimeTracking />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/profile"
                    element={
                      <ProtectedRoute>
                        <ProfileSettings />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/workspace-settings"
                    element={
                      <ProtectedRoute>
                        <WorkspaceSettings />
                      </ProtectedRoute>
                    }
                  />
                </Routes>
              )}
              </Suspense>
              </main>
            </div>
          </div>
  );
}

/**
 * OnboardingChecklist — floating checklist for new workspaces.
 * Shows in bottom-right corner, tracks progress through key features.
 * Disappears permanently once all steps are done or dismissed.
 */
import { useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { getTasks } from "../api/tasks";
import { getProjects } from "../api/projects";
import { getGoals } from "../api/goals";
import { getTeamMembers } from "../api/team";
import { unwrapList } from "../api/client";

const STEPS = [
  {
    id: "create_project",
    icon: "📁",
    title: "Create your first project",
    desc: "Organise work into projects",
    action: "/projects?new=true",
    actionLabel: "Create Project",
    check: async () => {
      const r = await getProjects();
      return unwrapList(r).length > 0;
    },
  },
  {
    id: "create_task",
    icon: "✅",
    title: "Add your first task",
    desc: "Break projects into actionable tasks",
    action: "/tasks?new=true",
    actionLabel: "Create Task",
    check: async () => {
      const r = await getTasks();
      return unwrapList(r).length > 0;
    },
  },
  {
    id: "invite_member",
    icon: "👥",
    title: "Invite a team member",
    desc: "Collaborate with your team",
    action: "/workspace-settings",
    actionLabel: "Invite Member",
    check: async () => {
      const r = await getTeamMembers();
      return unwrapList(r).length > 1; // more than just the owner
    },
  },
  {
    id: "create_goal",
    icon: "🎯",
    title: "Set a goal",
    desc: "Track progress toward key outcomes",
    action: "/goals",
    actionLabel: "Create Goal",
    check: async () => {
      const r = await getGoals();
      return unwrapList(r).length > 0;
    },
  },
  {
    id: "explore_analytics",
    icon: "📊",
    title: "Explore Analytics",
    desc: "See your team's velocity and health scores",
    action: "/analytics",
    actionLabel: "View Analytics",
    check: async () => {
      // Mark as done once visited
      return localStorage.getItem("onboarding_analytics_visited") === "true";
    },
  },
];

export default function OnboardingChecklist() {
  const { activeWorkspace } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen]           = useState(false);
  const [completed, setCompleted] = useState({});
  const [dismissed, setDismissed] = useState(false);
  const [, setLoading]     = useState(true);

  const storageKey = `onboarding_dismissed_${activeWorkspace?.id}`;
  const completedKey = `onboarding_completed_${activeWorkspace?.id}`;

  // Collapse back to the small pill on every route change. This widget is
  // mounted once at the app-shell level (not per-page), so its `open`
  // state otherwise survives client-side navigation — expand it once on
  // Dashboard, then browse anywhere else, and it stays expanded, pushing
  // that page's real content down. Costs little screen space as a small
  // floating pill on desktop; on a phone screen it can eat most of the
  // visible viewport on whatever page you land on next. Re-expanding is
  // one tap away, so this doesn't lose any functionality.
  //
  // Also re-checks progress on every navigation — covers "create a
  // project on /projects, then click over to /dashboard" near-instantly,
  // rather than waiting for the open-panel poll below (which only runs
  // while the panel is actually open).
  useEffect(() => {
    setOpen(false);
    if (activeWorkspace?.id && !dismissed) checkAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately only route changes trigger this
  }, [location.pathname]);

  // Check if dismissed for this workspace
  useEffect(() => {
    if (!activeWorkspace?.id) return;
    if (localStorage.getItem(storageKey) === "true") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from localStorage on mount/workspace change
      setDismissed(true);
      return;
    }
    // Load saved completed state
    const saved = localStorage.getItem(completedKey);
    if (saved) setCompleted(JSON.parse(saved));
    // Auto-open once per workspace, and only where there is room beside the
    // work (wide screens). On laptops/tablets/phones the panel used to open
    // over the page's own content and primary action on every visit; the
    // toggle is still there to open it any time.
    const autoKey = `${storageKey}_autoopened`;
    const roomy = typeof window !== "undefined" && window.matchMedia?.("(min-width: 1680px)")?.matches;
    if (!roomy || localStorage.getItem(autoKey) === "true") return;
    const t = setTimeout(() => { setOpen(true); localStorage.setItem(autoKey, "true"); }, 2000);
    return () => clearTimeout(t);
  }, [activeWorkspace?.id, storageKey, completedKey]);

  // Check completion status. Runs on mount/workspace change, AND is
  // re-triggered (below) whenever the panel is opened or the tab regains
  // focus — otherwise a step never updates after the user completes it
  // elsewhere in the app, since this widget stays mounted persistently
  // across route changes and nothing was ever telling it to re-check.
  const checkAll = useCallback(async () => {
    if (!activeWorkspace?.id) return;
    setLoading(true);
    const results = {};
    await Promise.allSettled(
      STEPS.map(async (step) => {
        try { results[step.id] = await step.check(); }
        catch { results[step.id] = false; }
      })
    );
    setCompleted(results);
    localStorage.setItem(completedKey, JSON.stringify(results));
    setLoading(false);
  }, [activeWorkspace?.id, completedKey]);

  useEffect(() => {
    if (!activeWorkspace?.id || dismissed) return;
    checkAll();
  }, [activeWorkspace?.id, dismissed, checkAll]);

  // Re-check whenever the panel is opened — the moment someone actually
  // looks at their progress is exactly when it needs to be fresh (e.g.
  // right after creating a project, then clicking the widget to check).
  useEffect(() => {
    if (open && !dismissed) checkAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only "open" should trigger this, not checkAll identity changes
  }, [open]);

  // Re-check periodically while the panel stays open. The triggers above
  // (mount, open-transition, window focus) all miss the same real case:
  // the panel is already open, and the user creates a project/task/goal/
  // invite via a modal or another part of the page WITHOUT navigating
  // away or blurring the browser tab — nothing was telling this widget
  // to look again, so a just-completed step stayed shown as incomplete
  // until a full page reload remounted everything. Polling while open is
  // simpler and more reliable than instrumenting every single creation
  // flow in the app (Projects/Tasks/Goals/Team all have their own modals
  // and forms) to explicitly notify this widget — a few seconds' delay is
  // a fine trade-off for an onboarding checklist.
  useEffect(() => {
    if (!open || dismissed) return;
    const interval = setInterval(checkAll, 8000);
    return () => clearInterval(interval);
  }, [open, dismissed, checkAll]);

  // Re-check on window focus too — covers creating something in another
  // tab, or just tabbing away and back without closing/reopening the panel.
  useEffect(() => {
    if (dismissed || !activeWorkspace?.id) return;
    const onFocus = () => checkAll();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [dismissed, activeWorkspace?.id, checkAll]);

  // Detect visiting Analytics through ANY entry point (sidebar, direct
  // link, etc.), not just a click through this widget's own action button —
  // previously only handleStepClick's explicit path set this flag, so
  // someone who found Analytics on their own would never get credit for it.
  useEffect(() => {
    if (dismissed) return;
    if (location.pathname.startsWith("/analytics")) {
      if (localStorage.getItem("onboarding_analytics_visited") !== "true") {
        localStorage.setItem("onboarding_analytics_visited", "true");
      }
      setCompleted(prev => prev.explore_analytics ? prev : { ...prev, explore_analytics: true });
    }
  }, [location.pathname, dismissed]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    localStorage.setItem(storageKey, "true");
  }, [storageKey]);

  const handleStepClick = (step) => {
    if (step.id === "explore_analytics") {
      localStorage.setItem("onboarding_analytics_visited", "true");
      setCompleted(prev => ({ ...prev, explore_analytics: true }));
    }
    navigate(step.action);
  };

  const doneCount  = STEPS.filter(s => completed[s.id]).length;
  const allDone    = doneCount === STEPS.length;
  const pct        = Math.round(doneCount / STEPS.length * 100);

  // Hide if dismissed or all steps done after 3 seconds
  useEffect(() => {
    if (allDone && !dismissed) {
      const t = setTimeout(handleDismiss, 4000);
      return () => clearTimeout(t);
    }
  }, [allDone, dismissed, handleDismiss]);

  if (dismissed || !activeWorkspace?.id) return null;

  return (
    <div className="onboarding-widget">
      {/* Toggle button */}
      <button className="onboarding-toggle" onClick={() => setOpen(o => !o)}>
        <div className="onboarding-toggle-left">
          <span className="onboarding-toggle-icon">🚀</span>
          <div>
            <div className="onboarding-toggle-title">Getting Started</div>
            <div className="onboarding-toggle-sub">{doneCount}/{STEPS.length} complete</div>
          </div>
        </div>
        <div className="onboarding-toggle-right">
          <div className="onboarding-ring">
            <svg viewBox="0 0 36 36" width="36" height="36">
              <circle cx="18" cy="18" r="15.9" fill="none"
                stroke="var(--gray-200)" strokeWidth="3" />
              <circle cx="18" cy="18" r="15.9" fill="none"
                stroke={allDone ? "#10b981" : "var(--brand-500)"}
                strokeWidth="3"
                strokeDasharray={`${pct} ${100 - pct}`}
                strokeDashoffset="25"
                strokeLinecap="round"
                transform="rotate(-90 18 18)"
              />
            </svg>
            <span className="onboarding-ring-pct">{pct}%</span>
          </div>
          <span className="onboarding-chevron">{open ? "▼" : "▲"}</span>
        </div>
      </button>

      {/* Checklist panel */}
      {open && (
        <div className="onboarding-panel">
          <div className="onboarding-panel-header">
            <div>
              <div className="onboarding-panel-title">
                {allDone ? "🎉 You're all set!" : "Welcome to Prowosma!"}
              </div>
              <div className="onboarding-panel-sub">
                {allDone
                  ? "You've completed all onboarding steps."
                  : "Complete these steps to get the most out of Prowosma"}
              </div>
            </div>
            <button className="onboarding-dismiss" onClick={handleDismiss}
              title="Dismiss checklist">✕</button>
          </div>

          {/* Progress bar */}
          <div className="onboarding-progress-bar">
            <div className="onboarding-progress-fill"
              style={{ width: `${pct}%`, background: allDone ? "#10b981" : "var(--brand-500)" }} />
          </div>

          {/* Steps */}
          <div className="onboarding-steps">
            {STEPS.map((step) => {
              const done = !!completed[step.id];
              return (
                <div key={step.id}
                  className={`onboarding-step ${done ? "done" : ""}`}
                  onClick={() => !done && handleStepClick(step)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => !done && handleStepClick(step))?.(e); } }}
                >
                  <div className={`onboarding-step-check ${done ? "checked" : ""}`}>
                    {done && <span>✓</span>}
                  </div>
                  <div className="onboarding-step-body">
                    <div className="onboarding-step-icon">{step.icon}</div>
                    <div className="onboarding-step-text">
                      <div className={`onboarding-step-title ${done ? "done-text" : ""}`}>
                        {step.title}
                      </div>
                      <div className="onboarding-step-desc">{step.desc}</div>
                    </div>
                  </div>
                  {!done && (
                    <span className="onboarding-step-action">{step.actionLabel} →</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

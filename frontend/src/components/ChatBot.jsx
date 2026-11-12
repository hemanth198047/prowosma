import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { chatWithAI, getAISettings, toggleAI } from "../api/ai";

/* ─── Help guide content (offline fallback when AI is off) ─── */
const HELP_CONTENT = {
  tasks: {
    keywords: ["task","tasks","todo","create task","add task","overdue","checklist","subtask","priority","assign"],
    answer: "**Tasks** — Go to **Tasks** in the sidebar.\n\n- Click **+ New Task** to create one.\n- Set priority (Low/Medium/High), due date, and assignee.\n- Add subtasks with **Add subtask** inside a task.\n- Use checklists for step-by-step tracking.\n- Filter by status, priority, or assignee using the filter bar.\n- Overdue tasks show in red on the dashboard.\n\n📍 Navigate: [Tasks →](/tasks)"
  },
  projects: {
    keywords: ["project","projects","active project","create project","new project","project progress"],
    answer: "**Projects** — Go to **Projects** in the sidebar.\n\n- Click **+ New Project** (or use the dashboard button) to create one.\n- Set name, colour, start/end date, and owner.\n- Assign team members from the project detail page.\n- Progress is automatically calculated from task completion.\n- Filter by status: Active, Paused, Completed.\n\n📍 Navigate: [Projects →](/projects)"
  },
  goals: {
    keywords: ["goal","goals","okr","objective","target","goal health","new goal"],
    answer: "**Goals** — Go to **Goals** in the sidebar.\n\n- Click **+ New Goal** from the dashboard or Goals page.\n- Set a target value and unit (%, $, count, etc.).\n- Link tasks or projects for auto-progress updates.\n- Monitor health: On Track 🟢, At Risk 🟡, Off Track 🔴.\n- Goal health % is shown on the dashboard hero.\n\n📍 Navigate: [Goals →](/goals)"
  },
  kanban: {
    keywords: ["kanban","board","card","drag","column","swimlane","wip"],
    answer: "**Kanban Board** — Go to **Kanban** in the sidebar.\n\n- Drag cards between columns to update task status.\n- Click **+ Column** to add a new column.\n- Set WIP (Work-in-Progress) limits per column.\n- Filter the board by assignee, priority, or project.\n- Click a card to open the full task detail.\n\n📍 Navigate: [Kanban →](/kanban)"
  },
  sprints: {
    keywords: ["sprint","sprints","backlog","velocity","burndown","iteration"],
    answer: "**Sprints** — Go to **Sprints** in the sidebar.\n\n- Create a sprint with name, start and end date (typically 2 weeks).\n- Add tasks from the backlog.\n- Start the sprint to lock scope and begin the countdown.\n- View burndown chart and remaining tasks.\n- Complete a sprint to auto-move incomplete tasks.\n\n📍 Navigate: [Sprints →](/sprints)"
  },
  gantt: {
    keywords: ["gantt","timeline","chart","dependency","milestone","schedule"],
    answer: "**Gantt Chart** — Go to **Gantt** in the sidebar.\n\n- Rows show projects (collapsed) and tasks (expanded).\n- Drag bar edges to change start/end dates.\n- Connect tasks with dependency arrows.\n- Zoom: Day / Week / Month / Quarter views.\n- Export as image or PDF for stakeholder reports.\n\n📍 Navigate: [Gantt →](/gantt)"
  },
  docs: {
    keywords: ["doc","docs","document","wiki","note","notes","knowledge","write","editor"],
    answer: "**Docs** — Go to **Docs** in the sidebar.\n\n- Click **+ New Doc** to create a document.\n- Use the toolbar for headings, tables, code blocks, and images.\n- Mention teammates with **@name** to notify them.\n- View version history with the clock icon (top-right).\n- Share with a workspace or public link.\n\n📍 Navigate: [Docs →](/docs)"
  },
  analytics: {
    keywords: ["analytics","report","reports","chart","metric","performance","insights","dashboard"],
    answer: "**Analytics** — Go to **Analytics** in the sidebar.\n\n- Select a date range (7d, 30d, 90d, or custom).\n- Switch between project, team, or workspace views.\n- Hover over chart points to see exact values.\n- Compare this period vs the last with the toggle.\n- Export charts as PNG or data as CSV.\n\n📍 Navigate: [Analytics →](/analytics)"
  },
  team: {
    keywords: ["team","member","members","invite","role","permission","workload","colleague"],
    answer: "**Team** — Go to **Team** in the sidebar.\n\n- Click **Invite Member** to add someone by email.\n- Assign roles: Manager, Admin, Member, or Guest.\n- View each member's current task workload.\n- Reassign tasks in bulk from the workload view.\n- Deactivate members without deleting their data.\n\n📍 Navigate: [Team →](/team)"
  },
  channels: {
    keywords: ["channel","channels","chat","message","mention","thread","communication"],
    answer: "**Channels** — Go to **Channels** in the sidebar.\n\n- Click **+** to create a new channel and invite members.\n- Use **@mention** to notify specific teammates.\n- Reply in threads to keep discussions organised.\n- Pin important messages for easy reference.\n- Link a channel to a project for auto-posted updates.\n\n📍 Navigate: [Channels →](/channels)"
  },
  automations: {
    keywords: ["automation","automations","rule","trigger","action","workflow","bpm","automate"],
    answer: "**Automations** — Go to **Automate → Automations** in the sidebar.\n\n- Click **+ New Automation** to open the rule builder.\n- Choose a Trigger (Task Created, Status Changed, Due Date Approaching, etc.).\n- Add Conditions to narrow when it fires.\n- Set Actions: Send notification, Update field, Create task, etc.\n- Test with a dry run before enabling.\n\n📍 Navigate: [Automations →](/automations)"
  },
  integrations: {
    keywords: ["integration","integrations","connect","slack","jira","github","webhook","api","import"],
    answer: "**Integrations** — Go to **Automate → Integrations** in the sidebar.\n\n- Click **+ Add Integration** and choose a service.\n- Authenticate via OAuth or API key.\n- Configure sync direction and field mapping.\n- Set sync frequency: real-time, hourly, or daily.\n- Test before activating.\n\n📍 Navigate: [Integrations →](/integrations)"
  },
  settings: {
    keywords: ["setting","settings","configure","workspace","admin","custom field","category","developer","api key"],
    answer: "**Workspace Settings** — Go to **Configure → Workspace** in the sidebar.\n\n- Set workspace name, logo, and timezone.\n- Configure default task statuses for new projects.\n- Manage email notification templates.\n- Custom Fields: Configure → Custom Fields.\n- Categories: Configure → Categories.\n- API Keys: Configure → Developer.\n\n📍 Navigate: [Workspace Settings →](/workspace-settings)"
  },
  licensing: {
    keywords: ["plan","plans","pricing","upgrade","license","billing","subscription","feature","enterprise","pro","starter"],
    answer: "**Licensing & Plans** — Prowosma has 3 plans:\n\n- **Starter** — Free · 5 users · 3 projects · basic features\n- **Pro** — $18/user/mo · 25 users · unlimited projects · 49 features\n- **Enterprise** — $45/user/mo · Unlimited everything · SSO/SAML · AI Intelligence · ROI Engine · 68 features\n\nClick **💎 Upgrade** in the topbar or sidebar to see the full comparison.\n\n📍 Navigate: [View Plans →](/licensing)"
  },
  help: {
    keywords: ["help","how","what","guide","tutorial","how to","explain","feature","support"],
    answer: "**Prowosma Help** — Here's what I can help you with (even without AI enabled):\n\n- 📋 **Tasks** — creating, filtering, subtasks\n- 📁 **Projects** — setup, progress tracking\n- 🎯 **Goals** — OKR tracking, health\n- 🗂 **Kanban** — boards, columns, WIP limits\n- 🏃 **Sprints** — agile planning, burndown\n- 📅 **Gantt** — timeline, dependencies\n- 📝 **Docs** — editor, versioning, sharing\n- 📈 **Analytics** — reports, exports\n- 👥 **Team** — members, roles, workload\n- ⚡ **Automations** — rules, triggers, BPM\n- 🔌 **Integrations** — Slack, Jira, GitHub\n- 💎 **Plans** — pricing, features, upgrades\n\nJust ask me about any of these!"
  }
};

/* Find best offline answer for a question */
function findOfflineAnswer(question) {
  const q = question.toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const [, topic] of Object.entries(HELP_CONTENT)) {
    const score = topic.keywords.filter(k => q.includes(k)).length;
    if (score > bestScore) { bestScore = score; best = topic; }
  }
  if (bestScore === 0) return HELP_CONTENT.help.answer;
  return best.answer;
}

/* ─── Quick actions ──────────────────────────────────────────── */
const QUICK_ACTIONS = [
  { label:"📋 Summarise my workspace",  msg:"Give me a summary of my current workspace — active projects, pending tasks, and any risks." },
  { label:"⚠️ What's overdue?",         msg:"List all my overdue tasks and projects with their current status." },
  { label:"🎯 Goal health check",        msg:"Check the health of all my active goals. Which are on track, at risk, or off track?" },
  { label:"🚀 What should I focus on?", msg:"Based on my tasks, deadlines, and goals, what should I focus on today?" },
  { label:"📈 Project progress",         msg:"Give me a progress report on all active projects with completion % and blockers." },
  { label:"📝 Draft standup notes",      msg:"Generate my daily standup notes based on my recent task activity." },
  { label:"⚡ Detect risks",             msg:"Analyse my projects and tasks for risks, blockers, and dependencies I should know about." },
  { label:"👥 Team workload",            msg:"Show me the current workload distribution across my team." },
];

const OFFLINE_QUICK = [
  { label:"📋 How do I create tasks?",      msg:"How do I create and manage tasks?" },
  { label:"📁 How do projects work?",        msg:"Explain how projects work in Prowosma." },
  { label:"🎯 How do I set up goals?",       msg:"How do I create and track goals?" },
  { label:"💎 What plans are available?",    msg:"What plans and pricing does Prowosma offer?" },
  { label:"⚡ How do automations work?",     msg:"How do I set up automations?" },
  { label:"🔌 How do I connect integrations?",msg:"How do integrations work?" },
  { label:"👥 How do I invite team members?",msg:"How do I add team members to my workspace?" },
  { label:"📅 How do I use the Gantt chart?",msg:"How does the Gantt chart work?" },
];

/* ─── Smart action generator ────────────────────────────────────
   Analyses the bot reply + user question to pick the most
   relevant clickable actions to show after every response.    ─── */
const ALL_ACTIONS = [
  // Navigation actions
  { label:"📋 Go to Tasks",          type:"nav",  path:"/tasks" },
  { label:"📁 Go to Projects",        type:"nav",  path:"/projects" },
  { label:"🎯 Go to Goals",           type:"nav",  path:"/goals" },
  { label:"🗂 Open Kanban",           type:"nav",  path:"/kanban" },
  { label:"🏃 Go to Sprints",         type:"nav",  path:"/sprints" },
  { label:"📅 Open Gantt",            type:"nav",  path:"/gantt" },
  { label:"🗓 Open Calendar",         type:"nav",  path:"/calendar" },
  { label:"📝 Go to Docs",            type:"nav",  path:"/docs" },
  { label:"📈 View Analytics",        type:"nav",  path:"/analytics" },
  { label:"👥 Go to Team",            type:"nav",  path:"/team" },
  { label:"💬 Open Channels",         type:"nav",  path:"/channels" },
  { label:"⚡ Go to Automations",     type:"nav",  path:"/automations" },
  { label:"🔌 Go to Integrations",    type:"nav",  path:"/integrations" },
  { label:"🗺️ Open Roadmap & RAID",  type:"nav",  path:"/roadmap" },
  { label:"📊 View KPIs",             type:"nav",  path:"/kpis" },
  { label:"💰 Open ROI Engine",       type:"nav",  path:"/roi" },
  { label:"🏗 Open Portfolio",         type:"nav",  path:"/portfolio" },
  { label:"🎯 Executive View",        type:"nav",  path:"/executive" },
  { label:"🔮 Scenario Planning",     type:"nav",  path:"/scenarios" },
  { label:"⏱ Time Tracking",          type:"nav",  path:"/time-tracking" },
  { label:"📋 View Reports",          type:"nav",  path:"/reports" },
  { label:"⚙️ AI Settings",          type:"nav",  path:"/ai-settings" },
  { label:"💎 View Plans",            type:"nav",  path:"/licensing" },
  { label:"🚀 Deployment Analytics",  type:"nav",  path:"/deployments" },
  { label:"🕸 Knowledge Graph",       type:"nav",  path:"/knowledge-graph" },
  { label:"🧠 AI Intelligence",       type:"nav",  path:"/ai-intelligence" },
  // Follow-up questions
  { label:"📋 Create a task now",           type:"ask", msg:"I want to create a new task. Ask me for the details." },
  { label:"📁 Create a new project",        type:"ask", msg:"Help me create a new project." },
  { label:"🎯 Create a new goal",           type:"ask", msg:"Help me set up a new goal with a target." },
  { label:"⚠️ Show me overdue items",       type:"ask", msg:"List all my overdue tasks and projects." },
  { label:"🚀 What should I focus on?",    type:"ask", msg:"What should I focus on right now based on my workspace?" },
  { label:"📝 Generate standup notes",     type:"ask", msg:"Generate my daily standup notes." },
  { label:"⚡ Detect risks & blockers",    type:"ask", msg:"Detect all risks, blockers, and dependencies in my current projects." },
  { label:"📈 Summarise my workspace",     type:"ask", msg:"Give me a full summary of my workspace." },
  { label:"👥 Check team workload",        type:"ask", msg:"Show me the current workload distribution across my team." },
  { label:"🎯 Check goal health",          type:"ask", msg:"What is the health of all my active goals?" },
  { label:"📊 Project progress report",   type:"ask", msg:"Give me a progress report on all active projects." },
  { label:"🔮 Run what-if scenario",      type:"ask", msg:"Help me create a what-if scenario for my current project plan." },
  { label:"💰 Calculate project ROI",     type:"ask", msg:"Help me calculate the ROI for my current projects." },
  { label:"📧 Send team reminder",        type:"ask", msg:"Help me send a reminder to my team about pending tasks." },
  { label:"🤖 More AI features",          type:"ask", msg:"What else can you help me with in Prowosma?" },
];

const KEYWORD_RULES = [
  // topic → which actions to show
  { keywords:["task","tasks","todo","overdue","due","assign","priority","checklist","subtask"],
    actions:["📋 Go to Tasks","📋 Create a task now","⚠️ Show me overdue items","🗂 Open Kanban","📅 Open Calendar"] },
  { keywords:["project","projects","active","progress","completion","milestone"],
    actions:["📁 Go to Projects","📁 Create a new project","📊 Project progress report","⚡ Detect risks & blockers","📈 Summarise my workspace"] },
  { keywords:["goal","goals","okr","objective","target","health","on track","at risk"],
    actions:["🎯 Go to Goals","🎯 Create a new goal","🎯 Check goal health","📈 Summarise my workspace"] },
  { keywords:["kanban","board","column","card","drag","wip"],
    actions:["🗂 Open Kanban","📋 Go to Tasks","📁 Go to Projects"] },
  { keywords:["sprint","sprints","backlog","velocity","burndown","iteration"],
    actions:["🏃 Go to Sprints","📅 Open Gantt","📋 Go to Tasks"] },
  { keywords:["gantt","timeline","dependency","milestone","schedule","delay"],
    actions:["📅 Open Gantt","🗺️ Open Roadmap & RAID","⚡ Detect risks & blockers"] },
  { keywords:["doc","docs","document","wiki","knowledge","note"],
    actions:["📝 Go to Docs","🕸 Knowledge Graph","💬 Open Channels"] },
  { keywords:["risk","risks","blocker","blocked","dependency","issue"],
    actions:["⚡ Detect risks & blockers","🗺️ Open Roadmap & RAID","📊 Project progress report","🏗 Open Portfolio"] },
  { keywords:["team","member","workload","capacity","assign","colleague"],
    actions:["👥 Go to Team","👥 Check team workload","💬 Open Channels","📝 Generate standup notes"] },
  { keywords:["standup","daily","yesterday","today","tomorrow","update"],
    actions:["📝 Generate standup notes","📋 Go to Tasks","👥 Go to Team"] },
  { keywords:["analytic","analytics","report","metric","insight","performance"],
    actions:["📈 View Analytics","📊 View KPIs","📋 View Reports","💰 Open ROI Engine"] },
  { keywords:["focus","priority","important","urgent","what should"],
    actions:["🚀 What should I focus on?","⚠️ Show me overdue items","📊 Project progress report"] },
  { keywords:["automat","automation","rule","trigger","workflow","bpm"],
    actions:["⚡ Go to Automations","🔌 Go to Integrations"] },
  { keywords:["integrat","connect","slack","jira","github","webhook"],
    actions:["🔌 Go to Integrations","⚡ Go to Automations"] },
  { keywords:["roi","return","cost","budget","financ","billing"],
    actions:["💰 Open ROI Engine","📈 View Analytics","💎 View Plans"] },
  { keywords:["scenario","what if","what-if","plan","planning"],
    actions:["🔮 Run what-if scenario","🗺️ Open Roadmap & RAID","📈 View Analytics"] },
  { keywords:["portfolio","initiative","programme","program","strategic"],
    actions:["🏗 Open Portfolio","🎯 Executive View","📈 View Analytics"] },
  { keywords:["kpi","metric","measure","indicator","target"],
    actions:["📊 View KPIs","📈 View Analytics","💰 Open ROI Engine"] },
  { keywords:["deploy","deployment","dora","release","ci","cd"],
    actions:["🚀 Deployment Analytics","📈 View Analytics"] },
  { keywords:["channel","chat","message","communicate","discuss"],
    actions:["💬 Open Channels","👥 Go to Team"] },
  { keywords:["time","billing","invoice","hour","timesheet","billable"],
    actions:["⏱ Time Tracking","📋 View Reports","📈 View Analytics"] },
  { keywords:["plan","pricing","upgrade","feature","enterprise","pro","starter","license"],
    actions:["💎 View Plans","⚙️ AI Settings"] },
  { keywords:["ai","intelligence","smart","predict","insight","assistant"],
    actions:["🧠 AI Intelligence","⚙️ AI Settings","🤖 More AI features"] },
  { keywords:["create","add","new","set up","setup","build","make"],
    actions:["📋 Create a task now","📁 Create a new project","🎯 Create a new goal"] },
  { keywords:["summary","overview","how am i","how are","workspace","status"],
    actions:["📈 Summarise my workspace","📊 Project progress report","🎯 Check goal health","⚠️ Show me overdue items"] },
];

const DEFAULT_ACTIONS = [
  "🚀 What should I focus on?",
  "⚠️ Show me overdue items",
  "📊 Project progress report",
  "📈 Summarise my workspace",
  "🤖 More AI features",
];

function generateActions(userMsg, botReply, currentPage) {
  const combined = ((userMsg||"") + " " + (botReply||"") + " " + (currentPage||"")).toLowerCase();
  const scored = {};

  KEYWORD_RULES.forEach(rule => {
    const hits = rule.keywords.filter(k => combined.includes(k)).length;
    if (hits > 0) {
      rule.actions.forEach(a => {
        scored[a] = (scored[a] || 0) + hits;
      });
    }
  });

  // Sort by score, deduplicate, take top 5
  const sorted = Object.entries(scored)
    .sort(([,a],[,b]) => b - a)
    .map(([label]) => label);

  // Fill with defaults if not enough matches
  const result = [...new Set([...sorted, ...DEFAULT_ACTIONS])].slice(0, 5);
  return result;
}



/* ─── Context tag ────────────────────────────────────────────── */
function buildContext(pathname) {
  const map = {
    "/":"Dashboard", "/tasks":"Tasks", "/projects":"Projects",
    "/goals":"Goals", "/kanban":"Kanban", "/sprints":"Sprints",
    "/gantt":"Gantt", "/calendar":"Calendar", "/docs":"Docs",
    "/analytics":"Analytics", "/team":"Team", "/channels":"Channels",
    "/roadmap":"Roadmap", "/kpis":"KPI Tracker", "/roi":"ROI Engine",
    "/automations":"Automations", "/integrations":"Integrations",
    "/licensing":"Pricing", "/ai":"AI Assistant",
  };
  for (const [p,l] of Object.entries(map)) {
    if (p==="/" ? pathname==="/" : pathname.startsWith(p)) return l;
  }
  return "Prowosma";
}

/* ─── Render markdown-lite ───────────────────────────────────── */
function renderMarkdown(text="") {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^### (.+)$/gm, "<div class='cb-h3'>$1</div>")
    .replace(/^## (.+)$/gm,  "<div class='cb-h2'>$1</div>")
    .replace(/^- (.+)$/gm,   "<div class='cb-li'>• $1</div>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<a class='cb-link' href='$2'>$1</a>")
    .split("\n").join("<br/>");
}

/* ─── Message bubble ─────────────────────────────────────────── */
function Message({ msg, onSend, onAction }) {
  const isUser = msg.role === "user";
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(msg.content); setCopied(true); setTimeout(()=>setCopied(false),1500); };

  return (
    <div className={"cb-msg "+(isUser?"cb-msg-user":"cb-msg-bot")}>
      {!isUser && <div className="cb-msg-avatar">✨</div>}
      <div className="cb-msg-body">
        <div className="cb-msg-bubble"
          dangerouslySetInnerHTML={{__html: renderMarkdown(msg.content)}}
          onClick={e=>{
            // Handle navigation links in offline mode
            if(e.target.tagName==="A"&&e.target.href){
              e.preventDefault();
              const url = new URL(e.target.href);
              window.location.pathname = url.pathname;
            }
          }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (e=>{
            // Handle navigation links in offline mode
            if(e.target.tagName==="A"&&e.target.href){
              e.preventDefault();
              const url = new URL(e.target.href);
              window.location.pathname = url.pathname;
            }
          })?.(e); } }}
        />
        <div className="cb-msg-meta">
          <span>{new Date(msg.timestamp).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span>
          {msg.mode==="offline" && <span className="cb-offline-tag">Guide</span>}
          {!isUser && <button className="cb-copy-btn" onClick={copy}>{copied?"✓":"⎘"}</button>}
        </div>
        {/* Suggestion chips from backend */}
        {Array.isArray(msg.suggestions) && msg.suggestions.length>0 && (
          <div className="cb-suggestions">
            {msg.suggestions.map((s,i)=>(
              <button key={i} className="cb-suggestion-chip" onClick={()=>onSend(s,true)}>{s}</button>
            ))}
          </div>
        )}
        {/* Action chips — always shown after every bot message */}
        {!isUser && Array.isArray(msg.actions) && msg.actions.length>0 && (
          <div className="cb-actions-row">
            <div className="cb-actions-label">Actions</div>
            <div className="cb-actions-chips">
              {msg.actions.map((label,i)=>{
                const action = ALL_ACTIONS.find(a=>a.label===label);
                if(!action) return null;
                return (
                  <button key={i}
                    className={"cb-action-chip cb-action-"+action.type}
                    onClick={()=>onAction(action)}
                    title={action.type==="nav"?"Navigate to page":"Ask AI"}>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
      {isUser && <div className="cb-msg-avatar cb-msg-avatar-user">You</div>}
    </div>
  );
}

/* ═══ MAIN CHATBOT ═══════════════════════════════════════════ */
export default function ChatBot() {
  const { user, activeWorkspace } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();

  const [open,       setOpen]      = useState(false);
  const [minimised,  setMinimised] = useState(false);
  const [messages,   setMessages]  = useState([]);
  const [input,      setInput]     = useState("");
  const [loading,    setLoading]   = useState(false);
  const [unread,     setUnread]    = useState(0);
  const [showQuick,  setShowQuick] = useState(true);
  const [aiEnabled,  setAiEnabled] = useState(true);   // assume on until checked
  const [aiChecked,  setAiChecked] = useState(false);  // have we fetched settings?
  const [mode,       setMode]      = useState("ai");   // "ai" | "offline"
  const [sessionId]  = useState(()=>"sess_"+Math.random().toString(36).slice(2));

  const messagesEndRef = useRef(null);
  const inputRef       = useRef(null);
  const context = buildContext(location.pathname);

  /* Auto-scroll */
  useEffect(()=>{ messagesEndRef.current?.scrollIntoView({behavior:"smooth"}); },[messages,loading]);

  /* Focus input on open */
  useEffect(()=>{
    if(open&&!minimised) setTimeout(()=>inputRef.current?.focus(),120);
  },[open,minimised]);

  /* Check AI settings once on open */
  useEffect(()=>{
    if(open && !aiChecked){
      getAISettings()
        .then(r=>{
          const enabled = r?.data?.aiEnabled!==false;
          setAiEnabled(enabled);
          setMode(enabled?"ai":"offline");
          setAiChecked(true);
        })
        .catch(()=>{ setAiEnabled(true); setAiChecked(true); }); // if backend unreachable assume on
    }
  },[open,aiChecked]);

  const addBot = useCallback((content, suggestions=[], msgMode="ai", lastUserMsg="")=>{
    const safesugg = Array.isArray(suggestions) ? suggestions : [];
    // Generate contextual action chips for every bot response
    const actions = generateActions(lastUserMsg, content, context);
    setMessages(prev=>[...prev,{
      role:"assistant", content, timestamp:Date.now(),
      suggestions:safesugg, actions, mode:msgMode
    }]);
    if(!open||minimised) setUnread(n=>n+1);
  },[open,minimised,context]);

  /* Welcome on first open — different based on AI state */
  useEffect(()=>{
    if(open && messages.length===0 && aiChecked){
      const name = user?.name?.split(" ")[0]||"there";
      if(aiEnabled){
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time welcome message shown when the panel first opens
        addBot(
          `Hi ${name} 👋 I'm Prowosma's assistant. I have full context of your workspace — tasks, projects, goals, docs, and more.\n\nAsk me anything or pick a quick action below.`,
          [], "ai"
        );
      } else {
        addBot(
          `Hi ${name} 👋 AI is currently **turned off** for your workspace.\n\nI can still help you with **guidance from the Prowosma help guide** — how to use features, navigate the app, and answer questions about plans and settings.\n\nWant to enable AI for smarter answers?`,
          ["Enable AI now","Continue without AI","What can you help with?"],
          "offline"
        );
      }
    }
    if(open) setUnread(0);
  },[open,aiChecked,aiEnabled,addBot,messages.length,user?.name]);

  /* Enable AI from chat */
  const enableAI = useCallback(async()=>{
    try{
      await toggleAI(true);
      setAiEnabled(true);
      setMode("ai");
      addBot("✅ **AI is now enabled!** I now have full intelligence to answer questions about your workspace, create tasks, detect risks, and much more.\n\nAsk me anything!",[],"ai");
    }catch{
      addBot("I couldn't enable AI right now. Please go to **AI Settings** to turn it on.",["Open AI Settings"],"offline");
    }
  },[addBot]);

  /* Send */
  const send = useCallback(async(text)=>{
    const content=(text||input).trim();
    if(!content||loading) return;

    setInput("");
    setShowQuick(false);
    setMessages(prev=>[...prev,{role:"user",content,timestamp:Date.now()}]);
    setLoading(true);

    /* Handle special suggestion actions */
    if(content==="Enable AI now"){ setLoading(false); await enableAI(); return; }
    if(content==="Open AI Settings"){ setLoading(false); navigate("/ai-settings"); return; }
    if(content==="Continue without AI"){
      setLoading(false);
      setMode("offline");
      addBot("Understood! I'll answer from the **Prowosma help guide**. Ask me how to use any feature.",["How do tasks work?","How do I create a project?","What plans are available?"],"offline");
      return;
    }
    if(content==="What can you help with?"||content==="What can you help me with?"){
      setLoading(false);
      addBot(findOfflineAnswer("help"), [], "offline");
      return;
    }

    /* AI mode */
    if(mode==="ai" && aiEnabled){
      try{
        const history = messages.slice(-12).map(m=>({role:m.role==="user"?"user":"assistant",content:m.content}));
        const res = await chatWithAI({
          message: content,
          history,
          userName: user?.name?.split(" ")[0] || "there",
          userFullName: user?.name || "there",
          userId: user?.id,
          sessionId,
          context:{ page:context, workspace:activeWorkspace?.name, workspaceId:activeWorkspace?.id },
        });
        const reply = res?.data?.reply||res?.data?.message||res?.data?.response||"Could you rephrase that?";
        addBot(reply, res?.data?.suggestions||[], "ai", content);
      }catch{
        // Backend error → fallback to offline
        addBot(
          "⚠️ I couldn't reach the AI backend right now.\n\nI'll answer from the **help guide** instead:",
          [], "offline"
        );
        setTimeout(()=>{
          addBot(findOfflineAnswer(content), [], "offline");
        }, 300);
      }
    } else {
      /* Offline / guide mode */
      await new Promise(r=>setTimeout(r,400)); // small delay feels natural
      const answer = findOfflineAnswer(content);
      addBot(answer, [], "offline", content);

      // Offer to enable AI after 2 offline answers
      const offlineCount = messages.filter(m=>m.mode==="offline"&&m.role==="assistant").length;
      if(offlineCount===2 && !aiEnabled){
        setTimeout(()=>{
          addBot(
            "💡 **Tip:** Enable AI for smarter, real-time answers about your actual workspace data — not just generic guides.",
            ["Enable AI now","Keep using guide mode"],
            "offline"
          );
        }, 800);
      }
    }

    setLoading(false);
  },[input,loading,messages,mode,aiEnabled,context,activeWorkspace,user,sessionId,addBot,enableAI,navigate]);

  /* Keyboard shortcut */
  useEffect(()=>{
    const h=(e)=>{
      if((e.ctrlKey||e.metaKey)&&e.key==="/"){e.preventDefault();setOpen(o=>!o);}
      if(e.key==="Escape"&&open) setOpen(false);
    };
    window.addEventListener("keydown",h);
    return()=>window.removeEventListener("keydown",h);
  },[open]);

  const clearChat=()=>{
    setMessages([]); setShowQuick(true); setInput(""); setAiChecked(false);
  };

  const isHidden=location.pathname==="/login"||location.pathname.startsWith("/auth");
  if(isHidden) return null;

  const currentQuicks = (mode==="offline"||!aiEnabled) ? OFFLINE_QUICK : QUICK_ACTIONS;
  const isOffline = mode==="offline"||!aiEnabled;

  return (
    <>
      {/* ── FAB ──────────────────────────────────────────── */}
      <button
        className={"cb-fab"+(open?" cb-fab-open":"")+(isOffline?" cb-fab-offline":"")}
        onClick={()=>{setOpen(o=>!o);setMinimised(false);}}
        title="Ask me anything (Ctrl+/)"
        aria-label="Open help assistant"
      >
        <span className="cb-fab-icon">{open?"✕":"💬"}</span>
        {!open&&unread>0&&<span className="cb-fab-badge">{unread}</span>}
        {!open&&<span className="cb-fab-label">Ask me</span>}
      </button>

      {/* ── Window ───────────────────────────────────────── */}
      {open&&(
        <div className={"cb-window"+(minimised?" cb-window-min":"")}>

          {/* Header */}
          <div className={"cb-header"+(isOffline?" cb-header-offline":"")}>
            <div className="cb-header-left">
              <div className={"cb-header-avatar"+(isOffline?" cb-header-avatar-offline":"")}>
                {isOffline?"📖":"✨"}
              </div>
              <div>
                <div className="cb-header-title">
                  {isOffline?"Prowosma Guide":"Prowosma AI"}
                </div>
                <div className="cb-header-status">
                  <span className={"cb-status-dot"+(isOffline?" cb-status-dot-offline":"")}/>
                  {isOffline
                    ? <span style={{color:"#fbbf24"}}>Guide mode · AI is off</span>
                    : <>{context} · {activeWorkspace?.name||"Workspace"}</>
                  }
                </div>
              </div>
            </div>
            <div className="cb-header-actions">
              {isOffline&&(
                <button className="cb-hdr-btn cb-hdr-enable"
                  onClick={()=>send("Enable AI now")} title="Enable AI">⚡</button>
              )}
              <button className="cb-hdr-btn" onClick={clearChat} title="Clear">⊘</button>
              <button className="cb-hdr-btn" onClick={()=>navigate(isOffline?"/ai-settings":"/ai")} title="Open full page">⤢</button>
              <button className="cb-hdr-btn" onClick={()=>setMinimised(m=>!m)}>{minimised?"▲":"▼"}</button>
              <button className="cb-hdr-btn cb-hdr-close" onClick={()=>setOpen(false)}>✕</button>
            </div>
          </div>

          {/* AI-off banner strip */}
          {!minimised&&isOffline&&(
            <div className="cb-ai-off-strip">
              <span>AI is off — answering from the help guide</span>
              <button className="cb-ai-off-enable" onClick={()=>send("Enable AI now")}>
                Enable AI
              </button>
            </div>
          )}

          {!minimised&&(
            <>
              <div className="cb-messages">
                {messages.map((msg,i)=>(
                  <Message key={i} msg={msg}
                    onSend={(text)=>send(text)}
                    onAction={(action)=>{
                      if(action.type==="nav") navigate(action.path);
                      else send(action.msg);
                    }} />
                ))}

                {loading&&(
                  <div className="cb-msg cb-msg-bot">
                    <div className="cb-msg-avatar">✨</div>
                    <div className="cb-msg-body">
                      <div className="cb-msg-bubble cb-typing"><span/><span/><span/></div>
                    </div>
                  </div>
                )}

                {showQuick&&messages.length<=1&&(
                  <div className="cb-quick-actions">
                    <div className="cb-quick-label">
                      {isOffline?"Help topics":"Quick actions"}
                    </div>
                    <div className="cb-quick-grid">
                      {currentQuicks.map((a,i)=>(
                        <button key={i} className="cb-quick-chip" onClick={()=>send(a.msg)}>{a.label}</button>
                      ))}
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef}/>
              </div>

              {/* Input */}
              <div className="cb-input-area">
                <div className="cb-input-row">
                  <textarea
                    ref={inputRef}
                    className="cb-input"
                    placeholder={isOffline
                      ?"Ask about any Prowosma feature…"
                      :"Ask anything about your workspace…"}
                    value={input}
                    rows={1}
                    onChange={e=>{
                      setInput(e.target.value);
                      e.target.style.height="auto";
                      e.target.style.height=Math.min(e.target.scrollHeight,120)+"px";
                    }}
                    onKeyDown={e=>{
                      if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}
                    }}
                    disabled={loading}
                  />
                  <button
                    className={"cb-send-btn"+((!input.trim()||loading)?" cb-send-disabled":"")}
                    onClick={()=>send()}
                    disabled={!input.trim()||loading}
                  >
                    {loading?"⏳":"➤"}
                  </button>
                </div>
                <div className="cb-input-footer">
                  <span>Ctrl+/ to toggle · Enter to send</span>
                  <button className="cb-footer-link"
                    onClick={()=>navigate(isOffline?"/ai-settings":"/ai")}>
                    {isOffline?"Enable AI →":"Full AI page →"}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

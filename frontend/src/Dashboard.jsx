import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { getDashboardSummary } from "../api/dashboard";
import { useAuth } from "../hooks/useAuth";
import {
  PieChart, Pie, Cell, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import client from "../api/client";

/* ── helpers ──────────────────────────────────────────────────── */
function greeting() {
  const h = new Date().getHours();
  if (h >= 5  && h < 12) return "Good morning";
  if (h >= 12 && h < 17) return "Good afternoon";
  if (h >= 17 && h < 21) return "Good evening";
  return "Good night";
}
function fmtDate(d) {
  return new Date(d).toLocaleDateString("en-US",{
    weekday:"long", year:"numeric", month:"long", day:"numeric"
  });
}

/* ── 120 inspiring quotes ─────────────────────────────────────── */
const QUOTES = [
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "It always seems impossible until it's done.", author: "Nelson Mandela" },
  { text: "Done is better than perfect.", author: "Sheryl Sandberg" },
  { text: "Focus on being productive instead of busy.", author: "Tim Ferriss" },
  { text: "Work smarter, not harder.", author: "Allan F. Mogensen" },
  { text: "The way to get started is to quit talking and begin doing.", author: "Walt Disney" },
  { text: "You don't have to be great to start, but you have to start to be great.", author: "Zig Ziglar" },
  { text: "Success is not final, failure is not fatal: it is the courage to continue that counts.", author: "Winston Churchill" },
  { text: "Productivity is never an accident. It is always the result of a commitment to excellence.", author: "Paul J. Meyer" },
  { text: "The key is not to prioritize what's on your schedule, but to schedule your priorities.", author: "Stephen Covey" },
  { text: "Amateurs sit and wait for inspiration. The rest of us just show up and get to work.", author: "Stephen King" },
  { text: "Hard work beats talent when talent doesn't work hard.", author: "Tim Notke" },
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { text: "Your time is limited, so don't waste it living someone else's life.", author: "Steve Jobs" },
  { text: "Innovation distinguishes between a leader and a follower.", author: "Steve Jobs" },
  { text: "Strive not to be a success, but rather to be of value.", author: "Albert Einstein" },
  { text: "Two roads diverged in a wood, and I took the one less traveled by.", author: "Robert Frost" },
  { text: "I find that the harder I work, the more luck I seem to have.", author: "Thomas Jefferson" },
  { text: "In the middle of every difficulty lies opportunity.", author: "Albert Einstein" },
  { text: "Opportunities don't happen. You create them.", author: "Chris Grosser" },
  { text: "Don't watch the clock; do what it does. Keep going.", author: "Sam Levenson" },
  { text: "Great things are not done by impulse, but by a series of small things brought together.", author: "Vincent Van Gogh" },
  { text: "It's not the hours you put in your work that counts, it's the work you put in the hours.", author: "Sam Ewing" },
  { text: "Either you run the day or the day runs you.", author: "Jim Rohn" },
  { text: "To think is easy. To act is hard. But the hardest thing in the world is to act in accordance with your thinking.", author: "Goethe" },
  { text: "Start where you are. Use what you have. Do what you can.", author: "Arthur Ashe" },
  { text: "The future depends on what you do today.", author: "Mahatma Gandhi" },
  { text: "You miss 100% of the shots you don't take.", author: "Wayne Gretzky" },
  { text: "The best time to plant a tree was 20 years ago. The second best time is now.", author: "Chinese Proverb" },
  { text: "Whether you think you can or you think you can't, you're right.", author: "Henry Ford" },
  { text: "Act as if what you do makes a difference. It does.", author: "William James" },
  { text: "Success usually comes to those who are too busy to be looking for it.", author: "Henry David Thoreau" },
  { text: "Don't be afraid to give up the good to go for the great.", author: "John D. Rockefeller" },
  { text: "I never dreamed about success. I worked for it.", author: "Estée Lauder" },
  { text: "If you are not willing to risk the usual, you will have to settle for the ordinary.", author: "Jim Rohn" },
  { text: "Take the risk or lose the chance.", author: "Unknown" },
  { text: "The man who moves a mountain begins by carrying away small stones.", author: "Confucius" },
  { text: "What seems to us as bitter trials are often blessings in disguise.", author: "Oscar Wilde" },
  { text: "The road to success and the road to failure are almost exactly the same.", author: "Colin R. Davis" },
  { text: "Build your own dreams, or someone else will hire you to build theirs.", author: "Farrah Gray" },
  { text: "The function of leadership is to produce more leaders, not more followers.", author: "Ralph Nader" },
  { text: "Remember that not getting what you want is sometimes a wonderful stroke of luck.", author: "Dalai Lama" },
  { text: "You can't use up creativity. The more you use, the more you have.", author: "Maya Angelou" },
  { text: "Dream big and dare to fail.", author: "Norman Vaughan" },
  { text: "Excellence is not a destination; it is a continuous journey that never ends.", author: "Brian Tracy" },
  { text: "Do one thing every day that scares you.", author: "Eleanor Roosevelt" },
  { text: "Motivation is what gets you started. Habit is what keeps you going.", author: "Jim Ryun" },
  { text: "Champions keep playing until they get it right.", author: "Billie Jean King" },
  { text: "The beautiful thing about learning is nobody can take it away from you.", author: "B.B. King" },
  { text: "Don't let yesterday take up too much of today.", author: "Will Rogers" },
  { text: "You've got to get up every morning with determination if you're going to go to bed with satisfaction.", author: "George Lorimer" },
  { text: "It does not matter how slowly you go as long as you do not stop.", author: "Confucius" },
  { text: "The only person you are destined to become is the person you decide to be.", author: "Ralph Waldo Emerson" },
  { text: "Believe you can and you're halfway there.", author: "Theodore Roosevelt" },
  { text: "I am not a product of my circumstances. I am a product of my decisions.", author: "Stephen Covey" },
  { text: "Every child is an artist. The problem is how to remain an artist once he grows up.", author: "Pablo Picasso" },
  { text: "You can never cross the ocean until you have the courage to lose sight of the shore.", author: "Christopher Columbus" },
  { text: "I've learned that people will forget what you said, people will forget what you did, but people will never forget how you made them feel.", author: "Maya Angelou" },
  { text: "Either write something worth reading or do something worth writing.", author: "Benjamin Franklin" },
  { text: "Winning isn't everything, but wanting to win is.", author: "Vince Lombardi" },
  { text: "The most common way people give up their power is by thinking they don't have any.", author: "Alice Walker" },
  { text: "The mind is everything. What you think you become.", author: "Buddha" },
  { text: "Twenty years from now you will be more disappointed by the things that you didn't do than by the ones you did do.", author: "Mark Twain" },
  { text: "A person who never made a mistake never tried anything new.", author: "Albert Einstein" },
  { text: "The person who says it cannot be done should not interrupt the person who is doing it.", author: "Chinese Proverb" },
  { text: "There are no traffic jams along the extra mile.", author: "Roger Staubach" },
  { text: "Too many of us are not living our dreams because we are living our fears.", author: "Les Brown" },
  { text: "I find that when you have a real interest in life and a curious life, that sleep is not the most important thing.", author: "Martha Stewart" },
  { text: "It is never too late to be what you might have been.", author: "George Eliot" },
  { text: "A successful man is one who can lay a firm foundation with the bricks others have thrown at him.", author: "David Brinkley" },
  { text: "No one can make you feel inferior without your consent.", author: "Eleanor Roosevelt" },
  { text: "The difference between ordinary and extraordinary is that little extra.", author: "Jimmy Johnson" },
  { text: "Do what you can, with what you have, where you are.", author: "Theodore Roosevelt" },
  { text: "The best revenge is massive success.", author: "Frank Sinatra" },
  { text: "People often say that motivation doesn't last. Well, neither does bathing — that's why we recommend it daily.", author: "Zig Ziglar" },
  { text: "Life shrinks or expands in proportion to one's courage.", author: "Anaïs Nin" },
  { text: "If you want to lift yourself up, lift up someone else.", author: "Booker T. Washington" },
  { text: "I am not afraid of tomorrow, for I have seen yesterday and I love today.", author: "William Allen White" },
  { text: "Certain things catch your eye, but pursue only those that capture the heart.", author: "Ancient Indian Proverb" },
  { text: "Definiteness of purpose is the starting point of all achievement.", author: "W. Clement Stone" },
  { text: "Learn as if you will live forever, live like you will die tomorrow.", author: "Mahatma Gandhi" },
  { text: "We may encounter many defeats but we must not be defeated.", author: "Maya Angelou" },
  { text: "Never let the fear of striking out keep you from playing the game.", author: "Babe Ruth" },
  { text: "What you get by achieving your goals is not as important as what you become by achieving your goals.", author: "Zig Ziglar" },
  { text: "Happiness is not something ready made. It comes from your own actions.", author: "Dalai Lama" },
  { text: "First, have a definite, clear practical ideal — a goal, an objective. Second, have the necessary means to achieve your ends.", author: "Aristotle" },
  { text: "If the wind will not serve, take to the oars.", author: "Latin Proverb" },
  { text: "You can't fall if you don't climb. But there's no joy in living your whole life on the ground.", author: "Unknown" },
  { text: "We become what we think about most of the time, and that's the strangest secret.", author: "Earl Nightingale" },
  { text: "Life is not measured by the number of breaths we take, but by the moments that take our breath away.", author: "Maya Angelou" },
  { text: "Nothing is impossible, the word itself says 'I'm possible'!", author: "Audrey Hepburn" },
  { text: "The only way to achieve the impossible is to believe it is possible.", author: "Charles Kingsleigh" },
  { text: "There is only one corner of the universe you can be certain of improving, and that's your own self.", author: "Aldous Huxley" },
  { text: "When everything seems to be going against you, remember that the airplane takes off against the wind, not with it.", author: "Henry Ford" },
  { text: "It's not whether you get knocked down, it's whether you get up.", author: "Vince Lombardi" },
  { text: "A goal without a plan is just a wish.", author: "Antoine de Saint-Exupéry" },
  { text: "Everything you've ever wanted is on the other side of fear.", author: "George Addair" },
  { text: "Strength does not come from physical capacity. It comes from an indomitable will.", author: "Mahatma Gandhi" },
  { text: "The question isn't who is going to let me; it's who is going to stop me.", author: "Ayn Rand" },
  { text: "In the end, it's not the years in your life that count. It's the life in your years.", author: "Abraham Lincoln" },
  { text: "Change your thoughts and you change your world.", author: "Norman Vincent Peale" },
  { text: "You don't need to see the whole staircase, just take the first step.", author: "Martin Luther King Jr." },
  { text: "Begin anywhere.", author: "John Cage" },
  { text: "Leadership is not about being in charge. It is about taking care of those in your charge.", author: "Simon Sinek" },
  { text: "Clarity is the most important thing. I can compare clarity to pruning in gardening.", author: "Gary Keller" },
  { text: "The successful warrior is the average man, with laser-like focus.", author: "Bruce Lee" },
  { text: "Your most important work is always ahead of you, never behind you.", author: "Stephen Covey" },
  { text: "One of the best pieces of advice I ever got was from a horse master. He told me to go slow to go fast.", author: "Monty Roberts" },
  { text: "If you spend too much time thinking about a thing, you'll never get it done.", author: "Bruce Lee" },
  { text: "A year from now you may wish you had started today.", author: "Karen Lamb" },
  { text: "Things may come to those who wait, but only the things left by those who hustle.", author: "Abraham Lincoln" },
  { text: "The secret of success is to do the common thing uncommonly well.", author: "John D. Rockefeller Jr." },
  { text: "If you genuinely want something, don't wait for it — teach yourself to be impatient.", author: "Gurbaksh Chahal" },
  { text: "Real integrity is doing the right thing, knowing that nobody's going to know whether you did it or not.", author: "Oprah Winfrey" },
  { text: "The true measure of success is how many times you can bounce back from failure.", author: "Stephen Richards" },
  { text: "If you want to achieve greatness stop asking for permission.", author: "Eddie Colla" },
  { text: "Things work out best for those who make the best of how things work out.", author: "John Wooden" },
  { text: "Everything you want is out there waiting for you to ask. Everything you want also wants you. But you have to take action to get it.", author: "Jules Renard" },
];

function pickQuote() {
  // Random on every mount — changes on every page visit / refresh
  return QUOTES[Math.floor(Math.random() * QUOTES.length)];
}

function QuoteBar() {
  // useEffect so it re-runs whenever the component mounts (navigation back to dashboard)
  const [quote, setQuote] = useState(pickQuote);
  useEffect(() => { setQuote(pickQuote()); }, []);
  return (
    <div className="cc3-quote-bar">
      <span className="cc3-quote-icon">✦</span>
      <span className="cc3-quote-text">"{quote.text}"</span>
      <span className="cc3-quote-dash">—</span>
      <span className="cc3-quote-author">{quote.author}</span>
    </div>
  );
}



/* ── Small stat chip ──────────────────────────────────────────── */
function Chip({ icon, value, label, color, bg, border, onClick }) {
  return (
    <div className="cc3-chip" onClick={onClick}
      style={{ background:bg, borderColor:border, cursor:onClick?"pointer":"default" }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (onClick)?.(e); } }}>
      <span className="cc3-chip-icon">{icon}</span>
      <span className="cc3-chip-value" style={{ color }}>{value}</span>
      <span className="cc3-chip-label" style={{ color }}>{label}</span>
    </div>
  );
}

/* ── Hub tile ─────────────────────────────────────────────────── */
function HubTile({ icon, label, sub, subColor, to, navigate }) {
  return (
    <div className="cc3-hub-tile" onClick={() => navigate(to)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => navigate(to))?.(e); } }}>
      <span className="cc3-hub-icon">{icon}</span>
      <span className="cc3-hub-label">{label}</span>
      {sub && <span className="cc3-hub-sub" style={{ color: subColor||"var(--gray-400)" }}>{sub}</span>}
    </div>
  );
}

/* ── Section header ───────────────────────────────────────────── */
function SH({ icon, title, action, actionTo, navigate }) {
  return (
    <div className="cc3-sh">
      <span className="cc3-sh-title">{icon} {title}</span>
      {action && <button className="cc3-sh-link" onClick={() => navigate(actionTo)}>{action} →</button>}
    </div>
  );
}

/* ── Project card (compact) ───────────────────────────────────── */
function ProjCard({ p, navigate }) {
  return (
    <div className="cc3-item-card" onClick={() => navigate(`/tasks?projectId=${p.id}`)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => navigate(`/tasks?projectId=${p.id}`))?.(e); } }}>
      <div className="cc3-item-card-top">
        <span className="cc3-item-dot" style={{ background: p.color||"#6366f1" }} />
        <span className="cc3-item-name">{p.name}</span>
        <span className={`badge badge-${p.status?.toLowerCase()}`} style={{ fontSize:9, padding:"1px 6px" }}>{p.status}</span>
      </div>
      <div className="cc3-item-bar">
        <div className="cc3-item-fill" style={{ width:`${p.progress}%`, background: p.color||"#6366f1" }} />
      </div>
      <span className="cc3-item-pct" style={{ color: p.color||"#6366f1" }}>{p.progress}%</span>
    </div>
  );
}

/* ── Goal card (compact) ──────────────────────────────────────── */
function GoalCard({ g, navigate }) {
  const pct = g.progress || 0;
  const color = pct >= 70 ? "#10b981" : pct >= 40 ? "#f59e0b" : "#8b5cf6";
  return (
    <div className="cc3-item-card" onClick={() => navigate("/goals")} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => navigate("/goals"))?.(e); } }}>
      <div className="cc3-item-card-top">
        <span className="cc3-item-dot" style={{ background: "#8b5cf6" }} />
        <span className="cc3-item-name">{g.title}</span>
        <span className={`badge badge-${g.status?.toLowerCase()}`} style={{ fontSize:9, padding:"1px 6px" }}>{g.status}</span>
      </div>
      <div className="cc3-item-bar">
        <div className="cc3-item-fill" style={{ width:`${pct}%`, background: color }} />
      </div>
      <span className="cc3-item-pct" style={{ color }}>{pct}%</span>
    </div>
  );
}

/* ── Charts panel ─────────────────────────────────────────────── */
function ChartsPanel({ summary, navigate }) {
  const [tab, setTab] = useState("tasks");
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const axisColor = isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.15)";
  const tickColor = isDark ? "rgba(255,255,255,0.5)" : "#94a3b8";

  const taskData = [
    { name:"Todo",        value: summary.todoTasks||0,       color:"#6366f1" },
    { name:"In Progress", value: summary.inProgressTasks||0, color:"#f59e0b" },
    { name:"Done",        value: summary.doneTasks||0,        color:"#10b981" },
  ].filter(d => d.value > 0);

  const projData = (summary.projectsWithProgress||[]).map(p => ({
    name: p.name.length>14 ? p.name.slice(0,14)+"…" : p.name,
    progress: p.progress, color: p.color||"#6366f1", id: p.id,
  }));

  const goalData = (summary.activeGoalList||[]).map(g => ({
    name: g.title.length>14 ? g.title.slice(0,14)+"…" : g.title,
    progress: g.progress||0, id: g.id,
  }));

  const completionRate = summary.totalTasks > 0
    ? Math.round((summary.doneTasks/summary.totalTasks)*100) : 0;

  return (
    <div className="cc3-chart-panel">
      <div className="cc3-chart-tabs">
        {["tasks","projects","goals"].map(k => (
          <button key={k} className={"cc3-chart-tab"+(tab===k?" active":"")}
            onClick={() => setTab(k)}>
            {k.charAt(0).toUpperCase()+k.slice(1)}
          </button>
        ))}
      </div>

      {tab === "tasks" && (
        <>
          <div className="cc3-chart-title">Task status</div>
          {taskData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart style={{outline:"none"}}>
                  <Pie data={taskData} cx="50%" cy="50%"
                    innerRadius={46} outerRadius={68}
                    paddingAngle={3} dataKey="value"
                    isAnimationActive={false} stroke="none"
                    style={{outline:"none"}}>
                    {taskData.map((e,i) => <Cell key={i} fill={e.color} stroke="none" strokeWidth={0} />)}
                  </Pie>
                  <Tooltip
                    contentStyle={{ fontSize:11, background:"var(--bg-card)", border:"1px solid var(--border)", borderRadius:8 }}
                    formatter={(v,n) => [`${v} tasks`, n]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="cc3-stat-grid">
                {[
                  { l:"Todo",       v:summary.todoTasks,              c:"#6366f1", p:"/tasks?status=TODO" },
                  { l:"Progress",   v:summary.inProgressTasks,        c:"#f59e0b", p:"/tasks?status=IN_PROGRESS" },
                  { l:"Done",       v:summary.doneTasks,               c:"#10b981", p:"/tasks?status=DONE" },
                  { l:"Rate",       v:`${completionRate}%`,            c:"#ec4899", p:null },
                  { l:"Overdue",    v:summary.overdueTasks?.length||0, c:"#ef4444", p:"/tasks?filter=overdue" },
                  { l:"Today",      v:summary.todayTasks?.length||0,   c:"#d97706", p:"/tasks?filter=today" },
                ].map((s,i) => (
                  <div key={i} className="cc3-mini-stat"
                    style={{ borderLeft:`2px solid ${s.c}`, cursor:s.p?"pointer":"default" }}
                    onClick={() => s.p && navigate(s.p)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => s.p && navigate(s.p))?.(e); } }}>
                    <div className="cc3-mini-val" style={{ color:s.c }}>{s.v}</div>
                    <div className="cc3-mini-lbl">{s.l}{s.p?" ↗":""}</div>
                  </div>
                ))}
              </div>
            </>
          ) : <div className="cc3-chart-empty">No tasks yet</div>}
        </>
      )}

      {tab === "projects" && (
        <>
          <div className="cc3-chart-title">Project progress</div>
          {projData.length > 0 ? (
            <ResponsiveContainer width="100%" height={Math.max(140, projData.length*36)}>
              <BarChart data={projData} layout="vertical" margin={{ left:4, right:28, top:4, bottom:4 }}>
                <XAxis type="number" domain={[0,100]} tickFormatter={v=>`${v}%`}
                  tick={{ fontSize:10, fill:tickColor }} axisLine={{ stroke:axisColor }}
                  tickLine={{ stroke:axisColor }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize:10, fill:tickColor }}
                  axisLine={{ stroke:axisColor }} tickLine={false} width={90} />
                <Tooltip contentStyle={{ fontSize:11, background:"var(--bg-card)", border:"1px solid var(--border)", borderRadius:8 }}
                  formatter={v => [`${v}%`,"Progress"]} />
                <Bar dataKey="progress" radius={[0,3,3,0]} cursor="pointer"
                  onClick={e => navigate(`/tasks?projectId=${e.id}`)}>
                  {projData.map((e,i) => <Cell key={i} fill={e.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="cc3-chart-empty">No projects yet</div>}
        </>
      )}

      {tab === "goals" && (
        <>
          <div className="cc3-chart-title">Goal progress</div>
          {goalData.length > 0 ? (
            <ResponsiveContainer width="100%" height={Math.max(140, goalData.length*36)}>
              <BarChart data={goalData} layout="vertical" margin={{ left:4, right:28, top:4, bottom:4 }}>
                <XAxis type="number" domain={[0,100]} tickFormatter={v=>`${v}%`}
                  tick={{ fontSize:10, fill:tickColor }} axisLine={{ stroke:axisColor }}
                  tickLine={{ stroke:axisColor }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize:10, fill:tickColor }}
                  axisLine={{ stroke:axisColor }} tickLine={false} width={90} />
                <Tooltip contentStyle={{ fontSize:11, background:"var(--bg-card)", border:"1px solid var(--border)", borderRadius:8 }}
                  formatter={v => [`${v}%`,"Progress"]} />
                <Bar dataKey="progress" fill="#8b5cf6" radius={[0,3,3,0]} cursor="pointer"
                  onClick={() => navigate("/goals")}>
                  {goalData.map((_,i) => <Cell key={i} fill="#8b5cf6" />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="cc3-chart-empty">No goals yet</div>}
        </>
      )}
    </div>
  );
}

/* ── Overdue modal ────────────────────────────────────────────── */
function OverdueModal({ summary, onClose, navigate }) {
  const goTo = p => { navigate(p); onClose(); };
  return (
    <div className="modal-overlay">
      <div className="modal">
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
          <h2 style={{ color:"#ef4444", fontSize:16 }}>⚠️ Overdue Items</h2>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        {[
          { title:"Tasks",    color:"#ef4444", bg:"#fff5f5", badgeBg:"#fecaca", items:summary.overdueTasks||[],    path:t=>`/tasks?highlight=${t.id}`,    key:"title" },
          { title:"Projects", color:"#f59e0b", bg:"#fff7ed", badgeBg:"#fed7aa", items:summary.overdueProjects||[], path:p=>`/projects?highlight=${p.id}`, key:"name"  },
          { title:"Goals",    color:"#8b5cf6", bg:"#faf5ff", badgeBg:"#e9d5ff", items:summary.overdueGoals||[],    path:g=>`/goals?highlight=${g.id}`,    key:"title" },
        ].map(s => (
          <div key={s.title} className="overdue-section">
            <div className="overdue-section-header" style={{ background:s.bg, color:s.color }}>
              {s.title}
              <span className="task-status-badge" style={{ background:s.badgeBg, color:s.color }}>{s.items.length}</span>
            </div>
            {s.items.length > 0
              ? <div className="overdue-section-body">
                  {s.items.map(item => (
                    <div key={item.id} className="overdue-item overdue-item-clickable" onClick={() => goTo(s.path(item))} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => goTo(s.path(item)))?.(e); } }}>
                      <div className="task-status-dot" style={{ background:s.color }} />
                      <div className="task-info"><div className="task-title">{item[s.key]}</div></div>
                      <span className="overdue-arrow">→</span>
                    </div>
                  ))}
                </div>
              : <p className="overdue-empty">None</p>}
          </div>
        ))}
        <div className="form-actions">
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   DASHBOARD — Concept 3 v2
   ════════════════════════════════════════════════════════════════ */
export default function Dashboard() {
  const { user }  = useAuth();
  const navigate  = useNavigate();
  const [summary,     setSummary]     = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [showOverdue, setShowOverdue] = useState(false);

  useEffect(() => {
    getDashboardSummary()
      .then(r => { setSummary(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const handleSendReminder = async () => {
    try   { await client.post("/reminders/send-now"); alert("Reminder sent!"); }
    catch { alert("Failed to send reminder. Check email configuration."); }
  };

  if (loading) return (
    <div className="cc3-loading">
      <div className="cc3-loading-spinner" />
      <span>Loading your command center…</span>
    </div>
  );
  if (!summary) return (
    <div className="cc3-error-card">
      <div className="cc3-error-icon">⚠️</div>
      <div className="cc3-error-title">Cannot connect to backend</div>
      <div className="cc3-error-sub">Make sure Spring Boot is running on port 9090.</div>
    </div>
  );

  /* computed */
  const completionRate = summary.totalTasks > 0
    ? Math.round((summary.doneTasks/summary.totalTasks)*100) : 0;
  const totalOverdue = (summary.overdueTasks?.length||0)
    + (summary.overdueProjects?.length||0)
    + (summary.overdueGoals?.length||0);
  const goalHealth = summary.totalGoals > 0
    ? Math.round(((summary.achievedGoals||0)/summary.totalGoals)*100) : 0;
  const userName = user?.name?.split(" ")[0] || "there";
  const todayStr = fmtDate(new Date());

  /* hub definitions */
  const workTiles = [
    { icon:"📁", label:"Projects",  sub:`${summary.totalProjects||0} active`,  to:"/projects" },
    { icon:"✅", label:"Tasks",     sub:totalOverdue>0?`${totalOverdue} overdue`:`${summary.totalTasks||0} total`, subColor:totalOverdue>0?"#ef4444":undefined, to:"/tasks" },
    { icon:"🎯", label:"Goals",     sub:`${goalHealth}% health`,               to:"/goals" },
    { icon:"🗂", label:"Kanban",    sub:`${summary.inProgressTasks||0} active`, to:"/kanban" },
    { icon:"⚡", label:"Epics",     sub:"View all",                             to:"/epics" },
    { icon:"🏃", label:"Sprints",   sub:"Current sprint",                       to:"/sprints" },
    { icon:"📅", label:"Gantt",     sub:"Timeline",                             to:"/gantt" },
    { icon:"🗓", label:"Calendar",  sub:`${summary.todayTasks?.length||0} today`, to:"/calendar" },
    { icon:"🚀", label:"Deploy",    sub:"DORA",                                 to:"/deployments" },
    { icon:"🕸", label:"Graph",     sub:"Knowledge",                            to:"/knowledge-graph" },
  ];
  const insightsTiles = [
    { icon:"📈", label:"Analytics",  sub:"Real-time",     to:"/analytics" },
    { icon:"📊", label:"KPIs",       sub:"Metric health", to:"/kpis" },
    { icon:"💰", label:"ROI Engine", sub:"Financials",    to:"/roi" },
    { icon:"🗺️", label:"Roadmap",   sub:"RAID log",      to:"/roadmap" },
    { icon:"📦", label:"Portfolio",  sub:"Initiatives",   to:"/portfolio" },
    { icon:"🏗",  label:"Portfolio+", sub:"Advanced",     to:"/portfolio-plus" },
    { icon:"🎯", label:"Executive",  sub:"C-suite",       to:"/executive" },
    { icon:"🔮", label:"Scenarios",  sub:"What-if",       to:"/scenarios" },
    { icon:"📋", label:"Reports",    sub:"Export",        to:"/reports" },
    { icon:"⏱", label:"Time",       sub:"Billing",        to:"/time-tracking" },
  ];
  const knowledgeTiles = [
    { icon:"📝", label:"Docs",      sub:"Documents", to:"/docs" },
    { icon:"🤝", label:"Meetings",  sub:"Schedule",  to:"/meetings" },
    { icon:"⚖️", label:"Decisions", sub:"Log",       to:"/decisions" },
    { icon:"📖", label:"SOPs",      sub:"Procedures",to:"/sops" },
  ];
  const automateTiles = [
    { icon:"🔀", label:"BPM Studio",  sub:"Design",    to:"/bpm" },
    { icon:"⚡", label:"Automations", sub:"Rules",     to:"/automations" },
    { icon:"🔌", label:"Integrations",sub:"Connect",   to:"/integrations" },
    { icon:"📥", label:"Import",      sub:"Bulk data", to:"/import" },
  ];
  const teamTiles = [
    { icon:"💬", label:"Channels", sub:"Chat",    to:"/channels" },
    { icon:"👥", label:"Team",     sub:"Members", to:"/team" },
    { icon:"📋", label:"Activity", sub:"Audit",   to:"/activity" },
  ];
  const aiTiles = [
    { icon:"🤖", label:"Assistant",    sub:"Chat",     to:"/ai" },
    { icon:"🧠", label:"Intelligence", sub:"Insights", to:"/ai-intelligence" },
    { icon:"✨", label:"AI Settings",  sub:"Config",   to:"/ai-settings" },
  ];
  const configureTiles = [
    { icon:"🏷",  label:"Categories",    sub:"Organise",  to:"/categories" },
    { icon:"⚙️", label:"Custom Fields", sub:"Schemas",   to:"/custom-fields" },
    { icon:"🏢", label:"Workspace",      sub:"Settings",  to:"/workspace-settings" },
    { icon:"🛡",  label:"Admin",         sub:"Users",     to:"/admin" },
    { icon:"🛠",  label:"Developer",     sub:"API",       to:"/developer" },
  ];

  return (
    <div className="cc3-root">

      {/* 0. QUOTE BAR */}
      <QuoteBar />

      {/* ① HERO ──────────────────────────────────────────────── */}
      <div className="cc3-hero">
        {/* Rainbow accent bar */}
        <div className="cc3-hero-bar" />

        {/* Top row: greeting + action buttons all on one line */}
        <div className="cc3-hero-top-row">
          <div className="cc3-hero-left">
            <div className="cc3-hero-greeting">{greeting()}, {userName} 👋</div>
            <div className="cc3-hero-date">Your command center · {todayStr}</div>
          </div>
          <div className="cc3-hero-actions">
            <div className="cc3-hero-live">
              <span className="cc3-live-dot" /><span>Live</span>
            </div>
            <button className="btn-primary cc3-hero-btn"
              onClick={() => navigate("/projects?new=true")}>+ New Project</button>
            <button className="btn-secondary cc3-hero-btn"
              onClick={handleSendReminder}>📧 Reminder</button>
          </div>
        </div>
        {/* Chips row — all chips on one consistent line */}
        <div className="cc3-chips-row">
          {totalOverdue > 0 && (
            <Chip icon="⚠️" value={totalOverdue} label="overdue"
              color="#ef4444" bg="rgba(239,68,68,0.08)" border="rgba(239,68,68,0.25)"
              onClick={() => setShowOverdue(true)} />
          )}
          <Chip icon="✅" value={summary.inProgressTasks||0} label="in progress"
            color="#6366f1" bg="rgba(99,102,241,0.08)" border="rgba(99,102,241,0.2)"
            onClick={() => navigate("/tasks?status=IN_PROGRESS")} />
          <Chip icon="🎯" value={`${goalHealth}%`} label="goal health"
            color={goalHealth>=70?"#10b981":"#f59e0b"}
            bg={goalHealth>=70?"rgba(16,185,129,0.08)":"rgba(245,158,11,0.08)"}
            border={goalHealth>=70?"rgba(16,185,129,0.25)":"rgba(245,158,11,0.25)"}
            onClick={() => navigate("/goals")} />
          <Chip icon="📊" value={`${completionRate}%`} label="completion"
            color="#8b5cf6" bg="rgba(139,92,246,0.08)" border="rgba(139,92,246,0.2)"
            onClick={() => navigate("/analytics")} />
          <Chip icon="🛡" value={summary.raidRisks||0} label="RAID risks"
            color="#dc2626" bg="rgba(220,38,38,0.07)" border="rgba(220,38,38,0.2)"
            onClick={() => navigate("/roadmap")} />
          <Chip icon="💰" value={summary.roiForecast||"–"} label="ROI forecast"
            color="#0d9488" bg="rgba(13,148,136,0.07)" border="rgba(13,148,136,0.2)"
            onClick={() => navigate("/roi")} />
          <Chip icon="🟢" value={summary.onlineCount||0} label="online"
            color="#10b981" bg="rgba(16,185,129,0.07)" border="rgba(16,185,129,0.2)"
            onClick={() => navigate("/team")} />
        </div>
      </div>

      {/* ③ WORK HUB + CHART PANEL ────────────────────────────── */}
      <div className="cc3-main-grid">
        <div className="cc3-work-col">

          {/* Work Hub tiles */}
          <div className="cc3-section-card">
            <SH icon="⚡" title="Work Hub" action="All projects" actionTo="/projects" navigate={navigate} />
            <div className="cc3-hub-grid">
              {workTiles.map(t => <HubTile key={t.to} {...t} navigate={navigate} />)}
            </div>
          </div>

          {/* Active Projects + Goals — same row */}
          <div className="cc3-proj-goals-row">

            <div className="cc3-section-card cc3-half-card">
              <SH icon="📁" title="Active Projects" action="View all" actionTo="/projects" navigate={navigate} />
              {summary.projectsWithProgress?.length > 0 ? (
                <div className="cc3-item-grid-compact">
                  {summary.projectsWithProgress.slice(0,3).map(p => (
                    <ProjCard key={p.id} p={p} navigate={navigate} />
                  ))}
                </div>
              ) : (
                <div className="cc3-empty">No projects —{" "}
                  <button className="btn-link" onClick={() => navigate("/projects?new=true")}>create one</button>
                </div>
              )}
            </div>

            <div className="cc3-section-card cc3-half-card">
              <SH icon="🎯" title="Active Goals" action="View all" actionTo="/goals" navigate={navigate} />
              {summary.activeGoalList?.length > 0 ? (
                <div className="cc3-item-grid-compact">
                  {summary.activeGoalList.slice(0,3).map(g => (
                    <GoalCard key={g.id} g={g} navigate={navigate} />
                  ))}
                </div>
              ) : (
                <div className="cc3-empty">No goals —{" "}
                  <button className="btn-link" onClick={() => navigate("/goals?new=true")}>set one</button>
                </div>
              )}
            </div>

          </div>

        </div>

        {/* Sticky chart panel */}
        <div className="cc3-charts-col">
          <ChartsPanel summary={summary} navigate={navigate} />
          <div className="cc3-chart-ai">
            <div className="cc3-chart-ai-top">
              <span className="cc3-chart-ai-badge">✨ AI Insight</span>
            </div>
            <div className="cc3-chart-ai-text">
              {summary.inProgressTasks||0} tasks in flight across {summary.activeProjects||summary.totalProjects||0} active projects.
              {totalOverdue > 0 && <span className="cc3-chart-ai-warn"> ⚠️ {totalOverdue} overdue — address these first.</span>}
              {completionRate >= 70 && <span className="cc3-chart-ai-good"> 🎉 Completion rate above target.</span>}
              {completionRate < 40 && <span> Consider reviewing task assignments.</span>}
            </div>
            <button className="cc3-chart-ai-btn" onClick={() => navigate("/ai")}>Open AI →</button>
          </div>
        </div>
      </div>

      {/* ④ INSIGHTS HUB ──────────────────────────────────────── */}
      <div className="cc3-section-card">
        <SH icon="📈" title="Insights Hub" action="Analytics" actionTo="/analytics" navigate={navigate} />
        <div className="cc3-hub-grid">
          {insightsTiles.map(t => <HubTile key={t.to} {...t} navigate={navigate} />)}
        </div>
      </div>

      {/* ⑤ KNOWLEDGE + AUTOMATE ──────────────────────────────── */}
      <div className="cc3-two-col">
        <div className="cc3-section-card">
          <SH icon="📚" title="Knowledge" action="Docs" actionTo="/docs" navigate={navigate} />
          <div className="cc3-hub-grid">
            {knowledgeTiles.map(t => <HubTile key={t.to} {...t} navigate={navigate} />)}
          </div>
        </div>
        <div className="cc3-section-card">
          <SH icon="⚡" title="Automate" action="BPM" actionTo="/bpm" navigate={navigate} />
          <div className="cc3-hub-grid">
            {automateTiles.map(t => <HubTile key={t.to} {...t} navigate={navigate} />)}
          </div>
        </div>
      </div>

      {/* ⑥ TEAM + AI + CONFIGURE — compact inline layout ────── */}
      <div className="cc3-three-col">

        {/* Team */}
        <div className="cc3-section-card">
          <SH icon="👥" title="Team" navigate={navigate} />
          <div className="cc3-compact-list">
            {teamTiles.map(t => (
              <div key={t.to} className="cc3-compact-item" onClick={() => navigate(t.to)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => navigate(t.to))?.(e); } }}>
                <span className="cc3-compact-icon">{t.icon}</span>
                <span className="cc3-compact-name">{t.label}</span>
                <span className="cc3-compact-sub">{t.sub}</span>
              </div>
            ))}
          </div>
          <div className="cc3-online-row">
            <span className="cc3-live-dot" style={{ background:"#10b981", width:6, height:6 }} />
            <span style={{ fontSize:11, color:"#10b981", fontWeight:600 }}>Team active</span>
            <button className="cc3-sh-link" style={{ marginLeft:"auto" }} onClick={() => navigate("/team")}>See all →</button>
          </div>
        </div>

        {/* AI */}
        <div className="cc3-section-card">
          <SH icon="🤖" title="AI Hub" navigate={navigate} />
          <div className="cc3-compact-list">
            {aiTiles.map(t => (
              <div key={t.to} className="cc3-compact-item" onClick={() => navigate(t.to)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => navigate(t.to))?.(e); } }}>
                <span className="cc3-compact-icon">{t.icon}</span>
                <span className="cc3-compact-name">{t.label}</span>
                <span className="cc3-compact-sub">{t.sub}</span>
              </div>
            ))}
          </div>
          <div className="cc3-ai-nudge" onClick={() => navigate("/ai")} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => navigate("/ai"))?.(e); } }}>
            <span>✨</span><span>Ask AI anything…</span>
          </div>
        </div>

        {/* Configure */}
        <div className="cc3-section-card">
          <SH icon="⚙️" title="Configure" navigate={navigate} />
          <div className="cc3-compact-list">
            {configureTiles.map(t => (
              <div key={t.to} className="cc3-compact-item" onClick={() => navigate(t.to)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => navigate(t.to))?.(e); } }}>
                <span className="cc3-compact-icon">{t.icon}</span>
                <span className="cc3-compact-name">{t.label}</span>
                <span className="cc3-compact-sub">{t.sub}</span>
              </div>
            ))}
          </div>
        </div>

      </div>

      {showOverdue && (
        <OverdueModal summary={summary} onClose={() => setShowOverdue(false)} navigate={navigate} />
      )}
    </div>
  );
}

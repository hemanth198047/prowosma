import { unwrapList } from "../api/client";
import { useState, useEffect, useRef, useCallback } from "react";
import PageHeader from "../components/PageHeader";
import client from "../api/client";
import { useToast } from "../components/ToastContext";
import { useConfirm } from "../hooks/useConfirm";

const getChannels    = ()         => client.get("/channels");
const createChannel  = (data)     => client.post("/channels", data);
const deleteChannel  = (id)       => client.delete(`/channels/${id}`);
const getMessages    = (id)       => client.get(`/channels/${id}/messages`);
const postMessage    = (id, data) => client.post(`/channels/${id}/messages`, data);

const MOOD_META = {
  GREAT:"🚀",GOOD:"😊",NEUTRAL:"😐",BAD:"😔"
};

// ── Standup Panel ─────────────────────────────────────────────
function StandupPanel() {
  const [entries,  setEntries]  = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ yesterday:"", today:"", blockers:"", mood:"GOOD" });
  const { show:toast } = useToast();
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  const load = () => client.get("/standup").then(r=>setEntries(unwrapList(r))).catch(()=>{});
  useEffect(()=>{ load(); },[]);

  const handleSubmit = async () => {
    if (!form.yesterday || !form.today) return;
    await client.post("/standup", form);
    setForm({ yesterday:"", today:"", blockers:"", mood:"GOOD" });
    setShowForm(false);
    load();
    toast("Standup posted","success");
  };

  return (
    <div className="channel-standup">
      <div className="channel-standup-header">
        <div>
          <div className="channel-standup-title">Async Standup</div>
          <div className="channel-standup-sub">Share your daily update with the team</div>
        </div>
        <button className="btn-primary" onClick={()=>setShowForm(v=>!v)}>
          {showForm ? "Cancel" : "+ Post Update"}
        </button>
      </div>

      {showForm && (
        <div className="channel-standup-form">
          <div className="form-group">
            <label htmlFor={"channels-what-did-you-do-yesterday"}>What did you do yesterday?</label>
            <textarea rows={2} value={form.yesterday} onChange={e=>set("yesterday",e.target.value)}
              placeholder="Completed the auth module, fixed 3 bugs…" id={"channels-what-did-you-do-yesterday"} />
          </div>
          <div className="form-group">
            <label htmlFor={"channels-what-will-you-do-today"}>What will you do today?</label>
            <textarea rows={2} value={form.today} onChange={e=>set("today",e.target.value)}
              placeholder="Work on the dashboard, review PRs…" id={"channels-what-will-you-do-today"} />
          </div>
          <div className="form-group">
            <label htmlFor={"channels-any-blockers"}>Any blockers?</label>
            <textarea rows={1} value={form.blockers} onChange={e=>set("form.blockers",e.target.value)}
              placeholder="None / Waiting for design review…" id={"channels-any-blockers"} />
          </div>
          <div className="form-group">
            <span id="channels-mood-label">How are you feeling?</span>
            <div className="channel-mood-row" role="radiogroup" aria-labelledby="channels-mood-label">
              {Object.entries(MOOD_META).map(([m,icon])=>(
                <button key={m}
                  className={`channel-mood-btn${form.mood===m?" active":""}`}
                  role="radio" aria-checked={form.mood===m}
                  onClick={()=>set("mood",m)}>
                  {icon} {m}
                </button>
              ))}
            </div>
          </div>
          <div className="form-actions">
            <button className="btn-secondary" onClick={()=>setShowForm(false)}>Cancel</button>
            <button className="btn-primary" disabled={!form.yesterday||!form.today}
              onClick={handleSubmit}>Post Standup</button>
          </div>
        </div>
      )}

      <div className="channel-standup-feed">
        {entries.slice(0,10).map(e=>(
          <div key={e.id} className="channel-standup-card">
            <div className="channel-standup-card-header">
              <div className="channel-standup-avatar">
                {(e.authorName||e.authorEmail||"?").slice(0,2).toUpperCase()}
              </div>
              <div>
                <div className="channel-standup-author">{e.authorName||e.authorEmail}</div>
                <div className="channel-standup-date">
                  {new Date(e.createdAt).toLocaleDateString([], {weekday:"short",month:"short",day:"numeric"})}
                  {e.mood && <span className="channel-standup-mood">{MOOD_META[e.mood]}</span>}
                </div>
              </div>
            </div>
            {e.yesterday && <div className="channel-standup-item"><span>✅</span><div>{e.yesterday}</div></div>}
            {e.today     && <div className="channel-standup-item"><span>🎯</span><div>{e.today}</div></div>}
            {e.blockers  && <div className="channel-standup-item"><span>🚧</span><div style={{color:"var(--danger)"}}>{e.blockers}</div></div>}
          </div>
        ))}
        {entries.length===0 && <div className="empty-state">No standups yet. Post the first one above.</div>}
      </div>
    </div>
  );
}

// ── Channel chat view ─────────────────────────────────────────
function ChannelView({ channel, onDelete }) {
  const [messages, setMessages] = useState([]);
  const [text,     setText]     = useState("");
  const [sending,  setSending]  = useState(false);
  const bottomRef = useRef(null);

  const load = useCallback(() => getMessages(channel.id).then(r=>setMessages(unwrapList(r))).catch(()=>{}), [channel.id]);
  useEffect(()=>{ load(); const t = setInterval(load, 5000); return ()=>clearInterval(t); },[load]);
  useEffect(()=>{ bottomRef.current?.scrollIntoView({behavior:"smooth"}); },[messages]);

  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    try { await postMessage(channel.id, { content:text }); setText(""); load(); }
    finally { setSending(false); }
  };

  return (
    <div className="channel-view">
      <div className="channel-view-header">
        <span className="channel-view-icon">#</span>
        <div>
          <div className="channel-view-name">{channel.name}</div>
          {channel.description && <div className="channel-view-desc">{channel.description}</div>}
        </div>
        <span className="channel-view-type">{channel.type}</span>
        <button className="btn-icon" title="Delete channel" onClick={() => onDelete(channel)}>🗑️</button>
      </div>

      <div className="channel-messages">
        {messages.map((m,i)=>{
          const prevSameAuthor = i > 0 && messages[i-1].authorEmail===m.authorEmail;
          return (
            <div key={m.id} className={`channel-msg${prevSameAuthor?" channel-msg-cont":""}`}>
              {!prevSameAuthor && (
                <div className="channel-msg-avatar">
                  {(m.authorName||m.authorEmail||"?").slice(0,2).toUpperCase()}
                </div>
              )}
              {prevSameAuthor && <div className="channel-msg-avatar-spacer" />}
              <div className="channel-msg-body">
                {!prevSameAuthor && (
                  <div className="channel-msg-meta">
                    <span className="channel-msg-author">{m.authorName||m.authorEmail}</span>
                    <span className="channel-msg-time">
                      {new Date(m.createdAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
                    </span>
                  </div>
                )}
                <div className="channel-msg-content">{m.content}</div>
                {m.linkedTaskId && <div className="channel-msg-link">Linked task</div>}
              </div>
            </div>
          );
        })}
        {messages.length===0 && (
          <div className="channel-empty">No messages yet. Start the conversation!</div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="channel-input-bar">
        <input
          value={text}
          onChange={e=>setText(e.target.value)}
          onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); send(); }}}
          placeholder={`Message #${channel.name}…`}
          className="channel-input"
        />
        <button className="channel-send-btn" onClick={send} disabled={sending||!text.trim()}>
          {sending ? "⏳" : "➤"}
        </button>
      </div>
    </div>
  );
}

// ── Main Channels page ────────────────────────────────────────
export default function Channels() {
  const [channels,   setChannels]   = useState([]);
  const [active,     setActive]     = useState(null);
  const [tab,        setTab]        = useState("channels");
  const [showCreate, setShowCreate] = useState(false);
  const [form,       setForm]       = useState({ name:"", description:"", type:"TEAM" });
  const { show:toast } = useToast();
  const confirm = useConfirm();

  const load = useCallback(() => getChannels().then(r=>{
    const list = unwrapList(r);
    setChannels(list);
    setActive(prev => prev || (list.length > 0 ? list[0] : prev));
  }).catch(()=>{}), []);
  useEffect(()=>{ load(); },[load]);

  const handleDeleteChannel = async (channel) => {
    const ok = await confirm({ title:"Delete Channel?", message:`This will permanently delete #${channel.name} and all its messages.`, danger:true });
    if (!ok) return;
    await deleteChannel(channel.id);
    toast("Channel deleted", "success");
    setChannels(prev => {
      const next = prev.filter(c => c.id !== channel.id);
      setActive(a => a?.id === channel.id ? (next[0] || null) : a);
      return next;
    });
  };

  const handleCreate = async () => {
    if (!form.name) return;
    await createChannel({ ...form, name: form.name.replace(/^#*/,"") });
    setForm({ name:"", description:"", type:"TEAM" });
    setShowCreate(false);
    load();
    toast("Channel created","success");
  };

  return (
    <div>
      <PageHeader icon="💬" title="Channels & Standup"
        description="Team communication, project channels, and async daily standups" />

      <div className="admin-tab-bar">
        {[["channels","Channels"],["standup","Standup"]].map(([t,l])=>(
          <button key={t} className={`admin-tab-btn${tab===t?" active":""}`}
            onClick={()=>setTab(t)}>{l}</button>
        ))}
      </div>

      {tab==="standup" && <StandupPanel />}

      {tab==="channels" && (
        <div className="channel-layout">
          {/* Sidebar */}
          <div className="channel-sidebar">
            <div className="channel-sidebar-header">
              <span className="channel-sidebar-title">Channels</span>
              <button className="btn-icon" title="New channel" onClick={()=>setShowCreate(v=>!v)}>+</button>
            </div>

            {showCreate && (
              <div className="channel-create-form">
                <input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}
                  placeholder="channel-name" />
                <input value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))}
                  placeholder="Description (optional)" />
                <select value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))}>
                  <option value="TEAM">Team channel</option>
                  <option value="PROJECT">Project channel</option>
                  <option value="ANNOUNCEMENT">Announcements</option>
                </select>
                <div style={{display:"flex",gap:"6px"}}>
                  <button className="btn-secondary" style={{flex:1,fontSize:"11px"}}
                    onClick={()=>setShowCreate(false)}>Cancel</button>
                  <button className="btn-primary" style={{flex:1,fontSize:"11px"}}
                    onClick={handleCreate}>Create</button>
                </div>
              </div>
            )}

            <div className="channel-list">
              {channels.map(c=>(
                <button key={c.id}
                  className={`channel-list-item${active?.id===c.id?" active":""}`}
                  onClick={()=>setActive(c)}>
                  <span className="channel-list-hash">#</span>
                  <span className="channel-list-name">{c.name}</span>
                  {c.type==="ANNOUNCEMENT" && <span className="channel-list-badge">📢</span>}
                </button>
              ))}
              {channels.length===0 && (
                <div className="channel-empty-sidebar">No channels. Create one above.</div>
              )}
            </div>
          </div>

          {/* Main view */}
          <div className="channel-main">
            {active
              ? <ChannelView channel={active} onDelete={handleDeleteChannel} />
              : <div className="channel-empty">Select a channel to start chatting</div>}
          </div>
        </div>
      )}
    </div>
  );
}

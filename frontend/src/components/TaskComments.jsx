import { useState, useRef, useEffect } from "react";
import { addComment, deleteComment, toggleReaction } from "../api/tasks";
import { useAuth } from "../hooks/useAuth";
import { usePresence } from "../hooks/usePresence";
import { getTeamMembers } from "../api/team";

// A-10: Supported emoji reactions
const REACTIONS = ["👍","❤️","🔥","✅","😄","👀","🎉","⚠️"];

// Parse @mentions from comment text
function parseMentions(text) {
  const matches = text.match(/@[\w.@+-]+/g) || [];
  return matches.map(m => m.slice(1));
}

// Highlight @mentions in rendered text
function CommentText({ text }) {
  const parts = text.split(/(@[\w.@+-]+)/g);
  return (
    <span>
      {parts.map((part, i) =>
        part.startsWith("@")
          ? <span key={i} className="comment-mention">{part}</span>
          : part
      )}
    </span>
  );
}

// Reaction bar component
function ReactionBar({ comment, taskId, currentUser, onRefresh }) {
  const [showPicker, setShowPicker] = useState(false);

  const handleToggle = async (emoji) => {
    await toggleReaction(taskId, comment.id, emoji);
    setShowPicker(false);
    onRefresh();
  };

  const reactions = comment.reactions || {};

  return (
    <div className="comment-reaction-row">
      {/* Existing reactions */}
      {Object.entries(reactions).map(([emoji, users]) => {
        const reacted = users.includes(currentUser);
        return (
          <button key={emoji}
            className={`comment-reaction-chip${reacted ? " reacted" : ""}`}
            onClick={() => handleToggle(emoji)}
            title={users.join(", ")}>
            {emoji} <span className="comment-reaction-count">{users.length}</span>
          </button>
        );
      })}

      {/* Add reaction button */}
      <div className="comment-reaction-add-wrap">
        <button className="comment-reaction-add-btn"
          onClick={() => setShowPicker(v => !v)}
          title="Add reaction">
          😊 +
        </button>
        {showPicker && (
          <div className="comment-reaction-picker">
            {REACTIONS.map(emoji => (
              <button key={emoji}
                className="comment-reaction-picker-btn"
                onClick={() => handleToggle(emoji)}>
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Presence dot — shows if a team member is "online"
// We use a simple heuristic: active within the last 5 minutes based on last activity
function PresenceDot({ email, onlineUsers }) {
  const isOnline = onlineUsers?.includes(email);
  return (
    <span className={`presence-dot${isOnline ? " online" : " offline"}`}
      title={isOnline ? "Online" : "Offline"} />
  );
}

export default function TaskComments({ task, onRefresh }) {
  const [open,         setOpen]         = useState(false);
  const [text,         setText]         = useState("");
  const [members,      setMembers]      = useState([]);
  const [mentionQuery, setMentionQuery] = useState(null); // {query, cursorPos}
  const [mentionIndex, setMentionIndex] = useState(0);
  const [typingUsers] = useState([]); // names currently typing (populated once real-time typing events are wired up)
  const textareaRef = useRef(null);
  const panelRef    = useRef(null);
  const { user }    = useAuth();
  const { onlineUsers } = usePresence();
  const currentUser = user?.email || user?.name || "Me";

  // Load team members for @mention autocomplete
  useEffect(() => {
    if (!open) return;
    getTeamMembers().then(r => setMembers(r.data || [])).catch(() => {});
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleTextChange = (e) => {
    const val = e.target.value;
    setText(val);

    // Detect @mention trigger
    const cursor = e.target.selectionStart;
    const before = val.slice(0, cursor);
    const match  = before.match(/@([\w.]*)$/);
    if (match) {
      setMentionQuery({ query: match[1], cursorPos: cursor });
      setMentionIndex(0);
    } else {
      setMentionQuery(null);
    }
  };

  const filteredMembers = mentionQuery
    ? members.filter(m =>
        m.name?.toLowerCase().includes(mentionQuery.query.toLowerCase()) ||
        m.email?.toLowerCase().includes(mentionQuery.query.toLowerCase())
      ).slice(0, 5)
    : [];

  const insertMention = (member) => {
    const cursor = mentionQuery.cursorPos;
    const before = text.slice(0, cursor);
    const after  = text.slice(cursor);
    const atStart = before.lastIndexOf("@");
    const newText = before.slice(0, atStart) + "@" + member.email + " " + after;
    setText(newText);
    setMentionQuery(null);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (mentionQuery && filteredMembers.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex(i => Math.min(i+1, filteredMembers.length-1)); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setMentionIndex(i => Math.max(i-1, 0)); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertMention(filteredMembers[mentionIndex]); return; }
      if (e.key === "Escape") { setMentionQuery(null); return; }
    }
    if (e.key === "Enter" && e.ctrlKey) handleAdd();
  };

  const handleAdd = async () => {
    if (!text.trim()) return;
    const mentions = parseMentions(text);
    await addComment(task.id, { text: text.trim(), author: currentUser, mentions });
    setText("");
    setMentionQuery(null);
    onRefresh();
  };

  const handleDelete = async (commentId) => {
    await deleteComment(task.id, commentId);
    onRefresh();
  };

  const count = task.comments?.length || 0;

  return (
    <div className="task-comments-wrapper" ref={panelRef}>
      <button className="task-comments-toggle"
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}>
        💬 {count > 0 ? `${count} Comment${count > 1 ? "s" : ""}` : "Comments"}
        {" "}{open ? "▲" : "▼"}
      </button>

      {open && (
        <div className="task-comments-panel" onClick={e => e.stopPropagation()} role="presentation">
          <div className="task-comments-header">
            💬 Comments
            <span className="task-comments-count">{count}</span>
          </div>

          {/* Comment list */}
          <div className="task-comments-list">
            {count > 0 ? task.comments.map(c => (
              <div key={c.id} className="task-comment-item">
                {/* Avatar */}
                <div className="task-comment-avatar">
                  {(c.author || "?").slice(0, 2).toUpperCase()}
                </div>

                <div className="task-comment-body">
                  <div className="task-comment-meta">
                    <span className="task-comment-author">{c.author}</span>
                    <PresenceDot email={c.author} onlineUsers={onlineUsers} />
                    <span className="task-comment-date">
                      {new Date(c.createdAt).toLocaleString([], {
                        month:"short", day:"numeric",
                        hour:"2-digit", minute:"2-digit"
                      })}
                    </span>
                    {c.author === currentUser && (
                      <button className="task-comment-delete"
                        onClick={() => handleDelete(c.id)} title="Delete">✕</button>
                    )}
                  </div>

                  <div className="task-comment-text">
                    <CommentText text={c.text} />
                  </div>

                  {/* A-10: Reaction bar */}
                  <ReactionBar
                    comment={c}
                    taskId={task.id}
                    currentUser={currentUser}
                    onRefresh={onRefresh}
                  />
                </div>
              </div>
            )) : (
              <div className="task-comments-empty">
                No comments yet. Be the first to comment!
              </div>
            )}
          </div>

          {/* Add comment */}
          <div className="task-comment-add">
            <div className="task-comment-add-avatar">
              {currentUser.slice(0, 2).toUpperCase()}
            </div>
            <div className="task-comment-input-wrap">
              <div className="task-comment-input-row" style={{ position:"relative" }}>
                <textarea
                  ref={textareaRef}
                  value={text}
                  onChange={handleTextChange}
                  onKeyDown={handleKeyDown}
                  placeholder="Add a comment… (type @ to mention someone, Ctrl+Enter to submit)"
                  rows={2}
                  className="task-comment-textarea"
                />

                {/* @mention autocomplete */}
                {mentionQuery && filteredMembers.length > 0 && (
                  <div className="mention-dropdown">
                    {filteredMembers.map((m, i) => (
                      <div key={m.id}
                        className={`mention-option${i === mentionIndex ? " active" : ""}`}
                        onMouseDown={() => insertMention(m)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => insertMention(m))?.(e); } }}>
                        <div className="mention-avatar">{(m.name||"?").slice(0,2).toUpperCase()}</div>
                        <div className="mention-info">
                          <div className="mention-name">{m.name}</div>
                          <div className="mention-email">{m.email}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {typingUsers.length > 0 && (
                <div className="comment-typing-indicator">
                  <span className="comment-typing-dots">
                    <span /><span /><span />
                  </span>
                  <span className="comment-typing-text">
                    {typingUsers.join(", ")} {typingUsers.length===1?"is":"are"} typing…
                  </span>
                </div>
              )}
              <div className="task-comment-actions">
                <span className="task-comment-hint">Ctrl+Enter to submit · @name to mention</span>
                <button className="btn-primary" style={{ fontSize:"12px", padding:"5px 14px" }}
                  onClick={handleAdd} disabled={!text.trim()}>
                  Comment
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

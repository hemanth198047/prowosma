import { useEffect, useRef } from "react";
import { usePeople } from "../../context/PeopleContext";
import { initials } from "../../utils/org";

/**
 * A person's avatar. Hover to peek at their profile card, click (or Enter) to pin it open.
 * Pass `person` (from the org list) or just `email`/`id`; unknown people render as a plain circle.
 */
export default function PersonAvatar({ person, email, id, name, size = 32, showName = false, subtitle, className = "", interactive = true }) {
  const { byId, byEmail, ensureLoaded, hoverCard, leaveCard, openCard } = usePeople();
  const ref = useRef(null);

  useEffect(() => { if (interactive) ensureLoaded(); }, [interactive, ensureLoaded]);

  const known = (person?.id && byId.get(person.id))
    || (id && byId.get(id))
    || ((person?.email || email) && byEmail.get(String(person?.email || email).toLowerCase()))
    || null;
  const p = known || person || { name, email, id };
  const label = p.name || p.email || "Unknown person";
  const canOpen = interactive && !!known;

  const circle = (
    <span
      className="person-avatar-circle"
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)), background: p.color || "var(--brand-500)" }}
      aria-hidden="true"
    >
      {p.avatar && /^https?:\/\//.test(p.avatar)
        ? <img src={p.avatar} alt="" />
        : initials(p.name, p.email)}
    </span>
  );

  const body = showName ? (
    <>
      {circle}
      <span className="person-avatar-text">
        <span className="person-avatar-name">{label}</span>
        {(subtitle ?? p.title) && <span className="person-avatar-sub">{subtitle ?? p.title}</span>}
      </span>
    </>
  ) : circle;

  if (!canOpen) {
    return <span className={`person-avatar ${className}`} title={label}>{body}</span>;
  }

  return (
    <button
      ref={ref}
      type="button"
      className={`person-avatar person-avatar-btn ${className}`}
      aria-label={showName ? undefined : `${label} — open profile card`}
      aria-haspopup="dialog"
      onMouseEnter={() => hoverCard(known.id, ref.current)}
      onMouseLeave={leaveCard}
      onClick={(e) => { e.stopPropagation(); openCard(known.id, ref.current); }}
    >
      {body}
    </button>
  );
}

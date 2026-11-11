/**
 * Avatar — initials on a soft tone picked from the person's name or email,
 * so the same person always gets the same colour across the app.
 */
import { initialsOf, toneOf } from "./meta";
export default function Avatar({ name, email, size = 24, title }) {
  const key = email || name || "";
  return (
    <span
      className={`ui-avatar ui-avatar--t${toneOf(key)}`}
      style={{ "--avatar-size": `${size}px` }}
      title={title ?? (name || email)}
      aria-label={title ?? (name || email)}
      role="img"
    >
      {initialsOf(name || email)}
    </span>
  );
}

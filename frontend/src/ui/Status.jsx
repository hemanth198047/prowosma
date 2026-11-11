/**
 * Status — Prowosma's progress glyph + label.
 *
 * One glyph family for every kind of work item (tasks, projects, goals,
 * sprints): a circle that fills as work moves forward. Blocked / overdue /
 * at-risk use a diamond instead, so "late" never hides inside "in progress".
 * The label is always shown (or given to screen readers), so state never
 * depends on colour alone.
 */
import { statusMeta } from "./meta";
/** Just the glyph (decorative; pair it with text). */
export function StatusGlyph({ status, size = 12 }) {
  const m = statusMeta(status);
  const shape = m.diamond ? "diamond" : m.pause ? "pause" : m.cancel ? "cancel" : "circle";
  return (
    <span
      className={`ui-glyph ui-glyph--${shape} ui-tone--${m.tone}`}
      style={{ "--glyph-fill": `${m.fill ?? 0}%`, "--glyph-size": `${size}px` }}
      aria-hidden="true"
    />
  );
}

/** Glyph + label. `hideLabel` keeps the label for screen readers only. */
export default function Status({ status, label, hideLabel = false, className = "" }) {
  const m = statusMeta(status);
  const text = label || m.label;
  return (
    <span className={`ui-status ${className}`} title={hideLabel ? text : undefined}>
      <StatusGlyph status={status} />
      <span className={hideLabel ? "ui-sr-only" : "ui-status-label"}>{text}</span>
    </span>
  );
}

/**
 * Priority — direction mark + label (▲ high, ■ medium, ▼ low).
 * Shape carries the meaning; colour only reinforces it.
 */
import { priorityMeta } from "./meta";
export default function Priority({ priority, hideLabel = false }) {
  const m = priorityMeta(priority);
  return (
    <span className={`ui-priority ui-priority--${m.tone}`} title={hideLabel ? m.label : undefined}>
      <span className="ui-priority-mark" aria-hidden="true" />
      <span className={hideLabel ? "ui-sr-only" : undefined}>{m.label}</span>
    </span>
  );
}

import { statusClass, statusText } from "../../utils/statusText";

/**
 * A status as a pill: tinted background, a dot in the status colour and a
 * sentence-case label ("On hold"). Styles come from the shared .badge
 * families in components.css, so every module shows a status the same way.
 */
export default function StatusPill({ status, label, className = "" }) {
  if (!status && !label) return null;
  return (
    <span className={`badge badge-${statusClass(status)} ${className}`.trim()}>
      {label ?? statusText(status)}
    </span>
  );
}

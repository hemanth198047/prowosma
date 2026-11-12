const LEVELS = {
  URGENT: { bars: 3, label: "Urgent", cls: "high" },
  CRITICAL: { bars: 3, label: "Critical", cls: "high" },
  HIGH: { bars: 3, label: "High", cls: "high" },
  MEDIUM: { bars: 2, label: "Medium", cls: "medium" },
  LOW: { bars: 1, label: "Low", cls: "low" },
};

/**
 * Priority as three signal bars plus the word, so it reads without colour
 * (WCAG 1.4.1). Unknown values fall back to their own text with no bars lit.
 */
export default function PriorityTag({ priority, showLabel = true }) {
  if (!priority) return null;
  const key = String(priority).toUpperCase();
  const lvl = LEVELS[key] || { bars: 0, label: String(priority), cls: "low" };
  return (
    <span className={`priority-tag priority-tag--${lvl.cls}`} title={`${lvl.label} priority`}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <rect x="3" y="14" width="4" height="7" rx="1" opacity={lvl.bars >= 1 ? 1 : 0.25} />
        <rect x="10" y="9" width="4" height="12" rx="1" opacity={lvl.bars >= 2 ? 1 : 0.25} />
        <rect x="17" y="4" width="4" height="17" rx="1" opacity={lvl.bars >= 3 ? 1 : 0.25} />
      </svg>
      {showLabel ? lvl.label : <span className="sr-only">{lvl.label} priority</span>}
    </span>
  );
}

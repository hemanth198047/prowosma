/**
 * EmptyState — says what will appear here and how to add the first one.
 * No illustration: a single line icon, a sentence, and the action.
 */
export default function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="ui-empty" role="status">
      {Icon && <Icon className="ui-empty-icon" aria-hidden="true" />}
      {title && <p className="ui-empty-title">{title}</p>}
      {children && <p className="ui-empty-text">{children}</p>}
      {action && <div className="ui-empty-action">{action}</div>}
    </div>
  );
}

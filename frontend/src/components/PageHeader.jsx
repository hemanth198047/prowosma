/**
 * The title row every page opens with: the page name, one line on what it's
 * for, and the page's main actions on the right. Same look as Projects and
 * Tasks (page-kit.css). `icon` is still accepted so callers don't break, but
 * pages no longer show an emoji beside their title.
 */
// eslint-disable-next-line no-unused-vars
export default function PageHeader({ title, description, icon, action }) {
  return (
    <header className="pg-title-row page-header-block">
      <div className="pg-title-text">
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="pg-title-actions page-header-action">{action}</div>}
    </header>
  );
}

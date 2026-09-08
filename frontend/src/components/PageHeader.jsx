export default function PageHeader({ title, description, icon, action }) {
  return (
    <div className="page-header-block">
      <div className="page-header-left">
        <div className="page-header-breadcrumb">Prowosma</div>
        <div className="page-header-title">
          {icon && <span className="page-header-icon">{icon}</span>}
          <h1>{title}</h1>
        </div>
        {description && <p className="page-header-desc">{description}</p>}
      </div>
      {action && <div className="page-header-action">{action}</div>}
    </div>
  );
}
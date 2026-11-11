import { useInRouterContext, useLocation } from "react-router-dom";
import { sectionForPath } from "../config/navigation";

/**
 * Compact page title row: section › title, an optional one-line description,
 * and the page's actions on the right.
 *
 * `icon` is still accepted so the 49 screens that pass one keep working, but
 * it is no longer drawn: the sidebar already shows each page's icon, and an
 * emoji next to every title was decoration rather than information.
 */
function RouteSectionInRouter() {
  const { pathname } = useLocation();
  return sectionForPath(pathname);
}
// Works inside or outside a router (unit tests render it bare).
function RouteSection() {
  return useInRouterContext() ? <RouteSectionInRouter /> : null;
}

// eslint-disable-next-line no-unused-vars
export default function PageHeader({ title, description, icon, action, section }) {
  const group = section ?? <RouteSection />;
  return (
    <div className="page-header-block">
      <div className="page-header-left">
        <div className="page-header-breadcrumb">{group}</div>
        <div className="page-header-title">
          <h1>{title}</h1>
        </div>
        {description && <p className="page-header-desc">{description}</p>}
      </div>
      {action && <div className="page-header-action">{action}</div>}
    </div>
  );
}

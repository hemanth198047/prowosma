import { useLocation, useNavigate } from "react-router-dom";

const routeMap = {
  "/": { label: "Dashboard", icon: "📊" },
  "/projects": { label: "Projects", icon: "📁" },
  "/tasks": { label: "Tasks", icon: "✅" },
  "/goals": { label: "Goals", icon: "🎯" },
  "/categories": { label: "Project Categories", icon: "🏷️" },
  "/credits": { label: "Credits", icon: "🙏" },
};

export default function Breadcrumb() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = [new URLSearchParams(location.search)];

  const crumbs = [{ label: "Home", icon: "🏠", path: "/" }];

  const route = routeMap[location.pathname];
  if (route && location.pathname !== "/") {
    crumbs.push({ ...route, path: location.pathname });
  }

  const projectId = searchParams.get("projectId");
  const status = searchParams.get("status");
  const filter = searchParams.get("filter");
  const categoryId = searchParams.get("categoryId");
  const highlight = searchParams.get("highlight");

  if (categoryId)
    crumbs.push({ label: "Category Filter", icon: "🏷️", path: null });
  if (projectId)
    crumbs.push({ label: "Project Filter", icon: "📁", path: null });
  if (status)
    crumbs.push({
      label: `Status: ${status.replace("_", " ")}`,
      icon: "🔵",
      path: null,
    });
  if (filter === "overdue")
    crumbs.push({ label: "Overdue", icon: "⚠️", path: null });
  if (filter === "today")
    crumbs.push({ label: "Due Today", icon: "📅", path: null });
  if (highlight)
    crumbs.push({ label: "Highlighted Item", icon: "🎯", path: null });

  if (crumbs.length <= 1) return null;

  return (
    <div className="breadcrumb-bar">
      {crumbs.map((crumb, i) => (
        <span key={i} className="breadcrumb-item">
          {i > 0 && <span className="breadcrumb-sep">›</span>}
          {crumb.path && i < crumbs.length - 1 ? (
            <button
              className="breadcrumb-link"
              onClick={() => navigate(crumb.path)}
            >
              {crumb.icon} {crumb.label}
            </button>
          ) : (
            <span className="breadcrumb-current">
              {crumb.icon} {crumb.label}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

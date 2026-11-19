import { useLocation, useNavigate } from "react-router-dom";
import { Calendar as IcCalendar, ChartColumn as IcChartColumn, CircleCheck as IcCircleCheck, Folder as IcFolder, Hand as IcHand, House as IcHouse, Tag as IcTag, Target as IcTarget, TriangleAlert as IcTriangleAlert } from "lucide-react";

const routeMap = {
  "/": { label: "Dashboard", icon: <IcChartColumn size={16} strokeWidth={1.5} aria-hidden="true" /> },
  "/projects": { label: "Projects", icon: <IcFolder size={16} strokeWidth={1.5} aria-hidden="true" /> },
  "/tasks": { label: "Tasks", icon: <IcCircleCheck size={16} strokeWidth={1.5} aria-hidden="true" /> },
  "/goals": { label: "Goals", icon: <IcTarget size={16} strokeWidth={1.5} aria-hidden="true" /> },
  "/categories": { label: "Project Categories", icon: <IcTag size={16} strokeWidth={1.5} aria-hidden="true" /> },
  "/credits": { label: "Credits", icon: <IcHand size={16} strokeWidth={1.5} aria-hidden="true" /> },
};

export default function Breadcrumb() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = [new URLSearchParams(location.search)];

  const crumbs = [{ label: "Home", icon: <IcHouse size={16} strokeWidth={1.5} aria-hidden="true" />, path: "/" }];

  const route = routeMap[location.pathname];
  if (route && location.pathname !== "/") {
    crumbs.push({ ...route, path: location.pathname });
  }

  // The top bar already says which page this is; the crumbs here only earn
  // their place when a filter narrows the page (Tasks › Overdue).
  const pageCrumbs = crumbs.length;

  const projectId = searchParams.get("projectId");
  const status = searchParams.get("status");
  const filter = searchParams.get("filter");
  const categoryId = searchParams.get("categoryId");
  const highlight = searchParams.get("highlight");

  if (categoryId)
    crumbs.push({ label: "Category Filter", icon: <IcTag size={16} strokeWidth={1.5} aria-hidden="true" />, path: null });
  if (projectId)
    crumbs.push({ label: "Project Filter", icon: <IcFolder size={16} strokeWidth={1.5} aria-hidden="true" />, path: null });
  if (status)
    crumbs.push({
      label: `Status: ${status.replace("_", " ")}`,
      icon: <span className="emo-dot emo-dot--blue" aria-hidden="true" />,
      path: null,
    });
  if (filter === "overdue")
    crumbs.push({ label: "Overdue", icon: <IcTriangleAlert size={16} strokeWidth={1.5} aria-hidden="true" />, path: null });
  if (filter === "today")
    crumbs.push({ label: "Due Today", icon: <IcCalendar size={16} strokeWidth={1.5} aria-hidden="true" />, path: null });
  if (highlight)
    crumbs.push({ label: "Highlighted Item", icon: <IcTarget size={16} strokeWidth={1.5} aria-hidden="true" />, path: null });

  if (crumbs.length === pageCrumbs) return null;

  return (
    <nav className="breadcrumb-bar" aria-label="Filters">
      {crumbs.map((crumb, i) => (
        <span key={i} className="breadcrumb-item">
          {i > 0 && <span className="breadcrumb-sep">›</span>}
          {crumb.path && i < crumbs.length - 1 ? (
            <button
              className="breadcrumb-link"
              onClick={() => navigate(crumb.path)}
            >
              {crumb.label}
            </button>
          ) : (
            <span className="breadcrumb-current">
              {crumb.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}

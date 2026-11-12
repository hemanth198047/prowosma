import { useLocation } from "react-router-dom";
import { locate } from "./navConfig";

/** "Work / Projects" — where you are, named the way the sidebar names it. */
export default function TopbarTrail() {
  const { pathname } = useLocation();
  const { section, label } = locate(pathname);
  return (
    <div className="topbar-trail">
      {section && <><span className="topbar-trail-section">{section}</span><span className="topbar-trail-sep" aria-hidden="true">/</span></>}
      <span className="topbar-trail-current" aria-current="page">{label}</span>
    </div>
  );
}

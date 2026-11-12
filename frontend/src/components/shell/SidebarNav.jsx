import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import WorkspaceSwitcher from "../WorkspaceSwitcher";
import SidebarBadge from "../SidebarBadge";
import CanDo from "../CanDo";
import { useAccess } from "../../hooks/useAccess";
import { NAV_TOP, NAV_GROUPS, NAV_BOTTOM, NAV_RESTRICTED, matchesPath } from "./navConfig";

function NavItem({ item, onNav, badges, can }) {
  if (item.gate?.can && !can(item.gate.can)) return null;
  const Icon = item.icon;
  const link = (
    <NavLink to={item.to} end={item.end} onClick={onNav} className="sb-link">
      <Icon className="sb-icon" size={16} strokeWidth={1.75} aria-hidden="true" />
      <span className="sb-label">{item.label}</span>
      {item.badge && <SidebarBadge count={badges?.[item.badge]} />}
    </NavLink>
  );
  return item.gate?.cando ? <CanDo action={item.gate.cando}>{link}</CanDo> : link;
}

function NavGroup({ group, onNav, badges, can, pathname }) {
  // null = follow the route (open while you're inside the group); a click pins it.
  const [toggled, setToggled] = useState(null);
  const holdsCurrent = group.items.some(i => matchesPath(i, pathname));
  const open = toggled ?? (holdsCurrent || !!group.defaultOpen);
  const id = `sb-group-${group.id}`;
  return (
    <div className={`sb-group${holdsCurrent ? " sb-group-current" : ""}`}>
      <button
        type="button"
        className="sb-group-head"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setToggled(!open)}
      >
        <span className="sb-group-label">{group.label}</span>
        <ChevronRight className={`sb-chevron${open ? " open" : ""}`} size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="sb-group-items" id={id}>
          {group.items.map(item => (
            <NavItem key={item.to} item={item} onNav={onNav} badges={badges} can={can} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function SidebarNav({ onNav, badges }) {
  const { restricted, can } = useAccess();
  const { pathname } = useLocation();

  if (restricted) {
    // Department / assigned-work access: only the areas scoped to them. The API refuses the rest.
    return (
      <>
        <WorkspaceSwitcher />
        <div className="sb-scroll">
          <div className="sb-list">
            {NAV_RESTRICTED.map(item => (
              <NavItem key={item.to} item={item} onNav={onNav} badges={badges} can={can} />
            ))}
          </div>
        </div>
        <div className="sb-bottom">
          {NAV_BOTTOM.map(item => <NavItem key={item.to} item={item} onNav={onNav} can={can} />)}
        </div>
      </>
    );
  }

  return (
    <>
      <WorkspaceSwitcher />
      <div className="sb-scroll">
        <div className="sb-list">
          {NAV_TOP.map(item => (
            <NavItem key={item.to} item={item} onNav={onNav} badges={badges} can={can} />
          ))}
        </div>
        {NAV_GROUPS.map(group => (
          <NavGroup key={group.id} group={group} onNav={onNav} badges={badges} can={can} pathname={pathname} />
        ))}
      </div>
      <div className="sb-bottom">
        {NAV_BOTTOM.map(item => <NavItem key={item.to} item={item} onNav={onNav} can={can} />)}
      </div>
    </>
  );
}

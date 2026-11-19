import { NavLink } from "react-router-dom";
import { Home, SquareCheckBig, FolderKanban, MessageSquare, Menu } from "lucide-react";
import "../../styles/mobile-tabbar.css";

/**
 * Phones: the five places people on the job use most, always one tap away at the bottom of the screen.
 * "Menu" opens the full sidebar for everything else. Hidden on wider screens.
 */
export default function MobileTabBar({ onMenu, restricted = false }) {
  const items = [
    !restricted && { to: "/", label: "Home", icon: Home, end: true },
    { to: "/tasks", label: "Tasks", icon: SquareCheckBig },
    { to: "/projects", label: "Projects", icon: FolderKanban },
    { to: "/channels", label: "Chat", icon: MessageSquare },
  ].filter(Boolean);
  return (
    <nav className="mtb" aria-label="Main">
      {items.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => "mtb-item" + (isActive ? " on" : "")}>
          <Icon size={22} aria-hidden="true" /><span>{label}</span>
        </NavLink>
      ))}
      <button type="button" className="mtb-item" onClick={onMenu}>
        <Menu size={22} aria-hidden="true" /><span>Menu</span>
      </button>
    </nav>
  );
}

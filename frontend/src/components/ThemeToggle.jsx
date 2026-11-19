import { useEffect, useState } from "react";
import { Moon as IcMoon, Sun as IcSun } from "lucide-react";

export default function ThemeToggle() {
  const [dark, setDark] = useState(
    () => localStorage.getItem("theme") === "dark",
  );

  useEffect(() => {
    document.documentElement.setAttribute(
      "data-theme",
      dark ? "dark" : "light",
    );
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  return (
    <button
      className="theme-toggle"
      onClick={() => setDark((d) => !d)}
      title="Toggle dark mode"
      aria-label="Toggle dark mode"
    >
      {dark ? <IcSun size={16} strokeWidth={1.5} aria-hidden="true" /> : <IcMoon size={16} strokeWidth={1.5} aria-hidden="true" />}
    </button>
  );
}

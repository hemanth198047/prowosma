import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES } from "../i18n";

/**
 * Minimal language switcher — a real, working example of the i18n setup
 * in action, not just scaffolding. Persists the choice via
 * i18next-browser-languagedetector's localStorage cache (see
 * src/i18n/index.js's detection config), so it's remembered on return
 * visits.
 */
export default function LanguageSwitcher({ style }) {
  const { i18n } = useTranslation();

  return (
    <select
      aria-label="Language"
      value={i18n.resolvedLanguage || "en"}
      onChange={(e) => i18n.changeLanguage(e.target.value)}
      style={{ fontSize: "12px", padding: "4px 6px", borderRadius: "6px", ...style }}
    >
      {SUPPORTED_LANGUAGES.map((lang) => (
        <option key={lang.code} value={lang.code}>{lang.label}</option>
      ))}
    </select>
  );
}

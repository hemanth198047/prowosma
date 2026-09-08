// i18n setup — previously no i18n/l10n framework existed anywhere in
// this codebase; the UI was English-only with no locale-switching
// mechanism. i18next + react-i18next is the standard, most widely-used
// choice for React (not a niche pick) — see docs/I18N.md for the honest
// scope of what's actually translated as of this change versus what
// still needs conversion.
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import en from "./locales/en.json";
import es from "./locales/es.json";

export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
];

i18n
  .use(LanguageDetector)   // auto-detects from browser/localStorage, falls back to English
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      es: { translation: es },
    },
    fallbackLng: "en",
    interpolation: {
      escapeValue: false, // React already escapes — double-escaping would break intentional HTML-ish content
    },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
    },
  });

export default i18n;

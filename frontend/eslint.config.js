import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'coverage']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      // Previously nothing in this project's lint config caught
      // accessibility issues at all — only 6 of 92 page/component files
      // had any aria-* attribute, and nothing flagged the other 86. This
      // is "recommended" (not "strict") to start: enough to catch real,
      // concrete issues (missing alt text, non-interactive elements with
      // click handlers, form inputs without labels) without an
      // immediate wall of hundreds of errors on day one — see
      // docs/ACCESSIBILITY.md for the measured baseline this produced
      // and the plan to tighten it over time.
      jsxA11y.flatConfigs.recommended,
    ],
    rules: {
      // Real, measured baseline the day this gate was added: 863
      // violations across 72 of 92 page/component files (see
      // docs/ACCESSIBILITY.md for the full breakdown by rule and file,
      // and for the remediation history). As of the follow-up pass
      // documented there, all five rules below are at a real, verified
      // zero violations (npx eslint . -f json), so they're promoted
      // from "warn" to "error" to act as a regression gate.
      "jsx-a11y/label-has-associated-control": "error",
      "jsx-a11y/click-events-have-key-events": "error",
      "jsx-a11y/no-static-element-interactions": "error",
      "jsx-a11y/no-noninteractive-element-interactions": "error",
      "jsx-a11y/no-autofocus": "error",
    },
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // Config files run under Node, not the browser — they need
    // `process`, `__dirname`, etc., not `window`/`document`.
    files: ['e2e/playwright.config.js', 'vite.config.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // Service workers run in a distinct global scope (self, clients,
    // caches, registration, skipWaiting, etc.) — not the regular
    // browser window scope the rest of the app uses. Without this,
    // `clients` (used for notification-click focus/openWindow) was
    // flagged as an undefined global even though it's a real,
    // correct part of the Service Worker API. This block comes after
    // the general one above so its globals take precedence for sw.js.
    files: ['public/sw.js'],
    languageOptions: {
      globals: globals.serviceworker,
    },
  },
])

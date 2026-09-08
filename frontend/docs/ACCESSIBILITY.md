# Accessibility (a11y)

## Status: jsx-a11y baseline fully remediated

As of this update, all five `jsx-a11y` rules that were enabled (see history below) are at a
**real, measured zero violations** across all 92 page/component files, verified by running
`npx eslint . -f json` and counting `jsx-a11y/*` messages directly (not estimated, not sampled).
All five rules have been promoted from `"warn"` to `"error"` in `eslint.config.js`, so this is now
a real regression gate: a PR that reintroduces a violation of any of these rules will fail lint.

```
jsx-a11y/label-has-associated-control        0
jsx-a11y/click-events-have-key-events        0
jsx-a11y/no-static-element-interactions      0
jsx-a11y/no-noninteractive-element-interactions  0
jsx-a11y/no-autofocus                        0
jsx-a11y/anchor-is-valid                     0
jsx-a11y/no-noninteractive-element-to-interactive-role  0
```

Also verified after the full remediation pass (not just the lint count):
- `npm run build` — clean, no new errors (only pre-existing bundle-size warnings unrelated to this
  work).
- `npx vitest run` — all 23 existing tests pass.

**What this status does *not* mean**: `npx eslint .` as a whole is **not** clean. There are 336
pre-existing errors and 40 warnings from *other* rules (`no-unused-vars`, `no-undef`,
`react-hooks/*`, `no-empty`, etc.) that were already present before this work started (337 errors
measured in the original baseline) and are out of scope for this change. Don't read "a11y gate is
green" as "lint is green" — they're two different things tracked separately.

## History

### Original baseline (tooling added, 6 rules turned on)

Previously, only 6 of 92 page/component files had any `aria-*` attribute, there was no documented
standard, no automated checking, and no accessibility statement. That earlier change added
`eslint-plugin-jsx-a11y` (wired into `eslint.config.js`, set to `"warn"`) and `vitest-axe` for
runtime checks, fixed 5 violations in `Login.jsx`, and documented a real measured baseline:

```
863 jsx-a11y violations across 72 of 92 page/component files
```

| Rule | Count | What it means |
|---|---|---|
| `label-has-associated-control` | 424 | A `<label>` isn't linked to its input via `htmlFor`/`id` (or nesting) |
| `no-static-element-interactions` | 203 | A `<div>`/`<span>` has an `onClick` but isn't a real interactive element |
| `click-events-have-key-events` | 196 | A click handler with no matching keyboard handler |
| `no-autofocus` | 35 | `autoFocus` used |
| `no-noninteractive-element-interactions` | 4 | A non-interactive element (e.g. `<li>`) has an interaction handler |
| `anchor-is-valid` | 1 | An `<a>` with no valid `href` |

That change deliberately fixed only 5 of the 863 and documented the rest as a real, sized backlog
rather than claiming completion — see the git history / PR description for that change's own
reasoning about why a blind mechanical fix across 72 files was judged too risky to do in one pass
without a way to visually verify results.

### This update: full remediation pass

Every remaining violation (858, after accounting for the 5 already fixed) was fixed and verified.
Roughly, in order of volume:

1. **`no-autofocus` (35)** — mechanical: `autoFocus` prop removed. Scripted, verified via lint diff.
2. **`no-static-element-interactions` + `click-events-have-key-events` (203 + 196, mostly the same
   elements)** — for divs/spans with only `onClick={e => e.stopPropagation()}` (modal-content click
   guards), added `role="presentation"` (the standard exemption for non-semantic click guards). For
   everything else, added `role="button" tabIndex={0}` plus an `onKeyDown` that invokes the *same*
   handler on Enter/Space (`(originalHandler)?.(e)`), so the keyboard path is guaranteed to do
   exactly what the mouse path does — no behavior was reimplemented or guessed at.
3. **`no-noninteractive-element-interactions` (4)** and the `no-noninteractive-element-to-interactive-role`
   violations that the mechanical pass above introduced as a side effect (assigning `role="button"`
   to elements like `<h2>`, `<h3>`, `<label>` that structurally shouldn't take a widget role) — each
   fixed individually by hand: click-to-edit headings got a real nested `<button>` (reset-styled to
   look identical, verified against the actual CSS rules targeting those elements so the visual
   result doesn't change); a fake "radio card" built from a bare `<label>` with no real control
   became a real `<button>`; a label wrapping a real `<input type="radio">` had its redundant
   `onClick` moved to the input's own `onChange` instead of being patched with ARIA.
4. **`label-has-associated-control` (419)** — the largest chunk, done in three passes:
   - **Direct control (346)**: `<label>Text</label>` immediately followed by a sibling
     `<input>/<select>/<textarea>` — added matching `htmlFor`/`id`. IDs are generated from the
     label text (or the control's `name` attribute as fallback), prefixed per-file, and made
     dynamic (`` `prefix-${key}` ``) for anything rendered inside a `.map()`, using the same `key`
     the list already relies on for React — so ids stay unique across repeated rows instead of
     colliding at runtime.
   - **Wrapped control (26)**: label followed by a wrapper `<div>` containing the real control one
     level down (e.g. a colour swatch + its hex-text mirror). `htmlFor`/`id` linked to the first
     control found; any additional control in the same wrapper got an `aria-label` from the label
     text so it isn't left unlabeled.
   - **Everything else (~47)**: no adjacent native control at all — custom picker widgets
     (`role="radiogroup"` + `role="radio"` swatches/mood-pickers with `aria-labelledby`), checkbox
     groups (`<fieldset>`/`<legend>` wrapping the existing per-option `<label>`s, which were already
     individually correct), composite custom components like `DateTimePicker` or a file-upload
     widget (`<fieldset>`/`<legend>` around the whole group instead of a floating unassociated
     `<label>`), a shared `TagInput` component that got a real `id` prop threaded through so its
     inner text input can be targeted by `htmlFor`, and a couple of mislabeled hint/heading text
     nodes that were using `<label>` for plain prose (changed to `<p>`/`<span>`).

   Because several of these conversions change the tag (`<label>` → `<span>`/`<legend>`), the shared
   `.form-group label` CSS rule (in `base.css`, `themes.css`, `components.css`, light and dark theme
   variants) was extended to also match `.form-group legend` and a new `.form-group .field-label`
   class, so none of these swaps change how anything looks.

## Automated testing

`vitest-axe` (axe-core) is wired into `src/test/setup.js`:

```js
import { axe } from "vitest-axe";
const { container } = render(<MyComponent />);
expect(await axe(container)).toHaveNoViolations();
```

**Known limitation (unchanged from the original baseline, still true)**: axe-core running inside
jsdom (this project's test environment — no real browser layout engine) does not reliably catch
everything the static `jsx-a11y` lint rules catch, and doesn't check color contrast at all (that
needs real rendered layout). The `jsx-a11y` ESLint rules — now all at `"error"` — are the primary,
reliable net for the issue classes they cover; the axe tests are a complementary signal, not a
substitute. For comprehensive runtime coverage (including color contrast), axe-core would need to
run against a real browser (e.g. via Playwright) — tracked as a future improvement, not implemented
here.

## What this still doesn't cover

- **No WCAG 2.1 AA conformance statement or third-party audit.** This work closes out the
  `jsx-a11y` static-analysis backlog and keeps a real regression gate in place; it is not a
  compliance certification. A conformance claim would need things neither `jsx-a11y` nor
  jsdom-based `axe-core` check at all: full keyboard-navigation-order review, focus management
  across route changes, testing with an actual screen reader, and color contrast across every
  theme/state.
- **No accessibility statement page** for the product itself — add one once real conformance work
  (the bullet above) has actually happened; publishing one now would overclaim.
- **The 336 pre-existing non-a11y lint errors** noted at the top of this doc are a separate, real
  backlog of their own (mostly `no-unused-vars`, a batch of `react-hooks/set-state-in-effect` /
  `react-hooks/purity` findings from an apparently-recent ESLint/React-hooks-plugin upgrade, and a
  handful of genuine bugs like `client is not defined` / `onUpdate is not defined` in a few files).
  Out of scope for this change, but worth its own tracked follow-up — some of those `no-undef`
  hits look like real runtime bugs, not just lint noise.

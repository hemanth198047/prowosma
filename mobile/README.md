# Prowosma Mobile

A native mobile app (React Native + Expo) for Prowosma — built as a
completely separate application from the web app, but talking to the
**same backend** (`https://prowosma.onrender.com/api`), so data created on
one shows up on the other immediately. No shared code, no shared build —
genuinely two apps, one product.

## What's in this version

- **Login / Register** — email+password, same `/api/auth/login` and
  `/api/auth/register` endpoints the web app uses.
- **Dashboard** — task/project/goal summary from `/api/dashboard/summary`.
- **Tasks** — list, filter by status, tap to open full detail (edit
  status/priority/description/due date/assignees, delete), floating "+"
  to create a new one.
- **Projects** — list, tap to open detail (shows that project's tasks,
  create a task scoped to it, delete the project), floating "+" to create
  a new one.
- **Kanban** — horizontally-scrolling board (To Do / In Progress / Done),
  same underlying `/api/tasks` data as the Tasks tab. Tap-to-move rather
  than drag-and-drop — see the note further down for why.
- **Sprints** — list (status/goal/date range) and detail (task breakdown +
  full task list), floating "+" to create a new one.
- **Goals** — list with progress bars, status, and quarter, floating "+"
  to create a new one.
- **Meetings** — list, detail (description/agenda/notes/attendees, tap to
  toggle action items done/undone, mark meeting completed), floating "+"
  to create a new one.
- **Docs** — list and a real read-only content renderer: doc content is a
  JSON array of `{id, type, content}` blocks (confirmed against the web
  app's own editor), so headings/paragraphs/lists/quotes/code render with
  their actual formatting. Rich embed block types (task/goal embeds,
  databases, galleries, AI blocks, YouTube/Figma/Loom/iframe embeds) show
  as a labeled placeholder rather than attempting a full port of the block
  editor — this is a reader, not an editor.
- **Channels** — list, chat view (polling refresh every 4 seconds while
  the screen is open, not a real WebSocket connection — see the note
  further down), send messages, create new channels.
- **Automations** — view rules and toggle enabled/disabled. Not a rule
  editor — see the note further down for why.
- **RAID Log** — risks/assumptions/issues/dependencies, filterable by
  type, create new entries.
- **SOPs** — list and detail view (procedure text and steps).
- **Portfolio** — read-only view of Programmes and Initiatives with
  status and progress.
- **Executive Overview** — leadership rollup (project/goal/KPI health)
  computed from data already fetched elsewhere in the app, no new
  endpoint added.
- **Billing** — current plan, seat usage, feature flags; start a trial or
  open the Stripe billing portal (opens in the device browser — this app
  doesn't attempt to embed a payment webview).
- **Categories** — list and create, used across projects/tasks.
- **Custom Fields** — read-only view of field definitions (name, type,
  required, which entity type they apply to). Not an editor — see the
  note further down for why.
- **Usage** (Admin) — workspace stats (task/project/doc counts, daily/
  weekly/monthly active users). The rest of Admin Center (security
  policy, DLP, IP allowlists, data retention) is intentionally not built
  — see the note further down.
- **Team** — member list with role badges.
- **Decisions** — list of logged decisions with impact/status, create new.
- **Change Requests** — list with impact/category/status, create new.
- **KPIs** — read-only progress-vs-target view with alert highlighting.
- **Search** — global search across tasks/projects/docs/meetings/goals/
  decisions (same `/api/search/global/quick` endpoint the web app uses),
  tapping a result jumps straight to its detail screen where one exists.
  Goals and Decisions don't have a dedicated detail screen yet, so a tap
  on those result types shows an honest "open on web" message instead of
  a dead end.
- **Task time tracking** — log minutes against a task from its detail
  screen; running total shown inline.
- **More tab** — houses Search/Goals/Sprints/Meetings/Docs/Decisions/
  Change Requests/KPIs/Team/Profile so the bottom tab bar stays to five
  icons instead of getting crowded.
- **Profile** — current user info, active workspace, log out.

Not built yet (by design, per scope for this pass): BPM Studio (a visual
workflow canvas — genuinely not a mobile-appropriate interaction, closer
to a desktop design tool than something to port), the Roadmap timeline
view (distinct from the RAID log above, which is built), Knowledge Graph
(a network/graph visualization, same category as BPM Studio), White
Label, Developer Portal, and Import/Export. The architecture (see below)
is meant to make adding each of those a matter of a new screen + API
module + a line in the relevant stack navigator, not a redesign — every
section built so far follows the same list → detail → create pattern.

## Project structure

```
src/
  api/          One file per backend resource (auth, tasks, projects,
                goals, sprints, meetings, docs, decisions, changeRequests,
                kpis, search, channels, automations, raid, sops,
                portfolio, billing, categories, customFields, admin,
                team, workspaces, dashboard) — same endpoint paths and
                response shapes the web app's src/api/*.js already use,
                so both apps stay in sync with the backend contract by
                construction, not by convention.
  components/   Shared UI: Button, Card, StatusBadge.
  context/      AuthContext — session bootstrap, login/logout, active
                workspace, wired to the API client's 401 handler.
  navigation/   RootNavigator (auth vs. main app switch), MainTabs (bottom
                tab bar), and one Stack Navigator per section that needs
                list → detail → create flow (TasksStack, ProjectsStack,
                MoreStack). Adding a new section means adding its own
                stack here and a tab/menu entry pointing at it.
  screens/      One file per screen.
  theme/        Colors/spacing/type scale matching the web app's palette
                (frontend/src/styles/base.css's --brand-* variables) —
                same product, same colors, different app.
```

## Running it locally (no Android Studio / Xcode required for this part)

1. Install [Expo Go](https://expo.dev/go) on your phone (App Store /
   Play Store).
2. `npm install`
3. `npx expo start`
4. Scan the QR code with Expo Go (Android) or the Camera app (iOS).

The app will load on your phone and hit the real production backend —
log in with a real Prowosma account.

## Building an actual installable `.apk` / `.ipa`

This needs [EAS Build](https://docs.expo.dev/build/introduction/) — Expo's
cloud build service. It builds the real native binary on their servers, so
you don't need Android Studio or Xcode installed locally.

```bash
npm install -g eas-cli
eas login                      # free Expo account
eas build:configure            # links this project to your Expo account
eas build --platform android --profile preview   # produces a real .apk
eas build --platform ios --profile preview        # produces a build for TestFlight/simulator
```

`eas.json` (already in this project) has a `preview` profile configured to
output a plain installable `.apk` for Android (rather than the Play
Store's required `.aab` format) — the right choice for testing/side-loading
before you're ready to actually publish.

When you're ready for the real stores, use the `production` profile and
`eas submit` to push to the Play Store / App Store.

## Connecting to a different backend

Everything points at one constant:

```js
// src/api/client.js
export const API_BASE_URL = 'https://prowosma.onrender.com/api';
```

Point this at a staging backend or `http://<your-machine-ip>:9090/api` for
local backend development (not `localhost` — that resolves to the phone
itself, not your computer).

## Polish pass — loading, empty, and error states

Every list screen now shows a real `ActivityIndicator`-based loading state
and a proper empty state (icon + message + a one-tap "create your first
one" action where a create screen exists) instead of bare gray text.
Detail screens use the same loading component. Destructive actions
(delete task/project/sprint, log out) use a visually distinct `danger`
button style and — for logout specifically — a confirmation dialog, since
that's a single un-doable tap sitting at the bottom of a scrollable menu.

Every button press gets a light haptic tap (`expo-haptics`); `Button`,
`StatusBadge`, and `StatsBar` carry proper `accessibilityRole`/
`accessibilityLabel`/`accessibilityState` so screen readers get sensible
announcements without every screen having to add this individually.
`Card` has a real (if subtle) shadow instead of a flat border.

## Known limits of this pass

- `PortfolioScreen`'s per-section empty text and `ChannelDetailScreen`'s
  chat empty state were left as simpler inline text rather than the full
  `EmptyState` component — both are lower-stakes contexts (a section
  footer among other sections; a friendly one-line chat placeholder) where
  the extra visual weight isn't clearly better.
- Accessibility coverage is real but not exhaustive — the shared
  components (`Button`, `StatusBadge`, `StatsBar`) and Login's form fields
  got explicit treatment; per-screen custom touchables (e.g. individual
  list row taps) mostly rely on their child `Text` being read, which
  works but isn't as polished as an explicit `accessibilityLabel` on
  every single touchable in the app would be.
- FlatList performance props (`initialNumToRender`, `windowSize`,
  `removeClippedSubviews`) were added to Tasks and Projects specifically,
  not blanket-applied everywhere — the other lists are unlikely to grow
  large enough for it to matter, and adding it everywhere without
  verifying scroll behavior on a real device risks solving a performance
  problem that doesn't exist while introducing a rendering one that does.

## Known gaps / next steps

- No offline support yet — every screen requires a live connection.
- No push notifications yet — the backend already has VAPID/Web Push for
  the browser PWA; a native FCM/APNs integration would be a separate,
  fairly contained addition (`expo-notifications` handles both platforms
  from one API).
- No deep linking / universal links yet (e.g. opening a task link from an
  email into this app instead of the browser).
- No BPM Studio, Roadmap timeline, Knowledge Graph, or admin/analytics-
  heavy pages yet — see "What's in this version" above for the full
  current scope.
- Automations is read + toggle only, not a rule editor — the trigger/
  condition/action config is open-ended nested JSON on the backend
  (Automation.java), closer to a small form-builder problem than a normal
  CRUD screen; viewing what exists and turning rules on/off covers the
  highest-value daily interaction without attempting that port.
- Portfolio (Programmes/Initiatives) is read-only — both carry linked-
  project/linked-goal/milestone lists that would need their own pickers
  to create properly, and the "check status on my phone" use case this
  page serves doesn't need creation yet.
- Custom Fields is read-only — the conditional show/hide/require logic
  (CustomField.java's `conditions`) is a small rule-builder problem in
  its own right, same category as Automations.
- Admin Center is scoped to usage stats only. Security policy, DLP
  policy, IP allowlists, and data retention settings are exactly the kind
  of sensitive, high-blast-radius configuration that deserves careful,
  deliberate editing with no fat-finger risk — not built here on purpose,
  not an oversight.
- Channels chat polls every 4 seconds rather than using a real WebSocket
  connection. The web app's real-time updates go through the STOMP/SockJS
  client in useWebSocket.js; porting that to React Native needs
  react-native-sockjs or a raw WebSocket STOMP reimplementation, either of
  which is a bigger, riskier lift to verify without a physical device.
  Swapping in the real socket later is scoped to this one screen's data-
  fetching, not a redesign.
- Goals and Decisions don't have detail screens yet (list + create only)
  — Search will honestly say so rather than navigating to a dead route if
  you tap one of those result types.
- Kanban uses tap-to-move, not drag-and-drop: a real drag gesture needs an
  extra native dependency (`react-native-gesture-handler` + a
  reanimated-based DnD library) that's meaningfully riskier to ship
  without a physical device to test the gesture feel on. Tap-to-move is
  fully functional and can be upgraded later without changing the data
  layer.
- Docs are read-only — rich embed blocks (task/goal embeds, databases,
  galleries, AI blocks, video/design embeds) show as a labeled placeholder
  rather than a full port of the block editor.
- Dates (task due dates, sprint start/end, meeting date/time) use plain
  "YYYY-MM-DD" text fields rather than a native date picker — same reason
  as the Kanban gesture call: `@react-native-community/datetimepicker` is
  a reasonable, low-risk addition once this is running on an actual
  device to verify the picker UI on both platforms, but wasn't worth
  guessing at sight-unseen.

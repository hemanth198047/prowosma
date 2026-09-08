# Public Status Page

## What changed

Previously no public status page existed. `.upptimerc.yml` (repo root) is a real, ready-to-use config
for [Upptime](https://upptime.js.org) — a free, open-source, GitHub-Actions-based status page (the
same kind of tool companies like to point to, e.g. many public engineering status pages run on this
exact project).

## Why this is a config file and not a fully working page in this repo

Upptime works by forking its own template repository (`upptime/upptime`), which contains the actual
site-generation code (an Astro-based static site, uptime-history-tracking GitHub Actions workflows,
etc.) — `.upptimerc.yml` is the config that template reads, not a standalone tool. Duplicating that
template's supporting code into this repo would be maintaining a second copy of someone else's project
indefinitely; forking their template (as Upptime is explicitly designed to be used) is the correct,
low-maintenance approach.

## Setup steps

1. Fork [github.com/upptime/upptime](https://github.com/upptime/upptime) into your GitHub org, named
   e.g. `status` (matches the `repo: status` in the config below — adjust if you name it differently).
2. Replace that fork's own `.upptimerc.yml` with this repo's `.upptimerc.yml` — update the placeholder
   URLs (`your-github-org`, `your-domain.example`) to your real values first.
3. Enable GitHub Pages on the forked repo (Settings → Pages → deploy from the `gh-pages` branch, which
   Upptime's own workflows create automatically on first run).
4. If you want Slack notifications on status changes: add a repo secret
   `NOTIFICATION_SLACK_WEBHOOK_URL` in the forked repo's settings.
5. Upptime's own GitHub Actions (already in the template you forked) run on a schedule from there —
   nothing further to configure in this repo.

## What this monitors vs. what `observability/alert-rules.yml` monitors

These are deliberately separate and serve different audiences:

- **Upptime** (this doc): external, black-box, "is the site up from the outside" — for customers/the
  public, checked every 5 minutes.
- **Prometheus/Alertmanager** (`docs/OBSERVABILITY_SETUP.md`): internal, white-box, real-time metrics
  and alerting for the team's own incident response — much finer-grained (error rates, latency
  percentiles, JVM memory, etc.), not something a public status page needs to expose.

A real incident typically triggers the internal alerting first (faster, more detail) and the public
status page shortly after (once the on-call engineer confirms real customer impact and updates it,
either manually via Upptime's own status/incident file format, or by the automated up/down checks
themselves once the outage is severe enough to fail the health-check URLs above).

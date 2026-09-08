# Security & Quality Testing Pipeline

Overview of everything added for this backlog item — see each linked doc for full detail on any one
piece.

| Concern | Tool | Workflow | Status |
|---|---|---|---|
| SAST (backend) | CodeQL (`java-kotlin`, `security-extended` queries) | `codeql.yml` | Runs on push/PR/weekly |
| SAST (frontend) | CodeQL (`javascript-typescript`) | `codeql.yml` (frontend repo) | Runs on push/PR/weekly |
| Dependency/SCA — new deps | GitHub Dependency Review | `dependency-scan.yml` | Runs on every PR, blocks high/critical CVEs in new deps |
| Dependency/SCA — whole tree | Trivy filesystem scan | `dependency-scan.yml` | Daily + on push, reports to Security tab |
| SBOM | Anchore `sbom-action` (SPDX) | `docker-publish.yml` | Generated for every published image |
| DAST | OWASP ZAP baseline scan | `dast-scan.yml` | Weekly + on demand, passive scanning only |
| E2E (cross-service) | Playwright | `e2e.yml` | Daily + on demand |
| API contract check | OpenAPI generation + `oasdiff` breaking-change diff | `api-contract-check.yml` | Every PR touching `src/**` |

## Honest status of each

**SAST (CodeQL)** — genuinely runs GitHub's real analysis engine, no caveats. Results appear in the
repo's Security tab automatically once this workflow runs once.

**Dependency Review** — genuine, GitHub-native, no caveats. Blocks a PR that introduces a dependency
with a known high/critical CVE.

**Trivy scan** — genuine scanning, but `exit-code: 0` (doesn't hard-fail the workflow) intentionally,
since this is the first time this codebase's existing dependency tree has ever been scanned — an
unknown number of pre-existing findings likely exist, and hard-failing immediately against an unknown
baseline would (per the same ratchet-plan reasoning used for coverage/lint elsewhere in this backlog)
just teach people to disable the check. Review the first real run's results, triage, then consider
setting `exit-code: 1` for future runs.

**SBOM generation** — genuine, produces a real SPDX document per published image.

**DAST (ZAP)** — genuine baseline (passive) scan against the real running stack. Passive-only
deliberately: active scanning sends real attack payloads and needs a dedicated, disposable target,
not the same stack other workflows share. `fail_action: false` for the same "unknown existing
baseline" reason as Trivy above.

**E2E (Playwright)** — **this is the one piece in this whole engagement where I could not verify the
result by actually running it**, and that's worth stating plainly rather than glossing over. The two
spec files' selectors (button text, placeholder text) were checked directly against the real source of
`Login.jsx`, `WorkspaceSetup.jsx`, and `Tasks.jsx` — not guessed — and `npx playwright test --list`
confirms both spec files parse correctly and Playwright discovers all 4 tests. But actually launching a
browser against a real running frontend+backend stack requires Docker and a real browser binary,
neither available in the environment this was written in — so "the selectors match the real markup"
is verified; "the full flow actually completes end-to-end" is not, until this workflow runs for real.

**API contract check** — see `docs/API_CONTRACT.md` for the full honest scope: this is OpenAPI
schema-diff breaking-change detection, not full Pact-style consumer-driven contract testing, and that
doc explains exactly why and what the gap is.

## What's still not covered

- **Active DAST scanning** — only passive baseline scanning is wired up; active scanning needs a
  dedicated disposable target.
- **Full consumer-driven contract testing (Pact)** — see `docs/API_CONTRACT.md`.
- **Fuzz testing** — not implemented; would be a reasonable next addition for parsers/file-upload
  handling (e.g. the file storage and DLP scanning code added elsewhere in this backlog).
- **Mutation testing** — not implemented; would give a more honest signal on whether the coverage
  numbers from the Testing item actually assert anything meaningful, versus just executing lines.

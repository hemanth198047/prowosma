# Security Policy

## Reporting a Vulnerability

If you believe you've found a security vulnerability in Prowosma, please report it privately —
**do not open a public GitHub issue.**

- Preferred: use [GitHub's private vulnerability reporting](../../security/advisories/new) for this
  repository (Security tab → "Report a vulnerability").
- Alternative: email **security@[your-domain].example** (replace with a real, monitored address before
  publishing this file — a placeholder here is a bug, not a feature).

Please include:
- A description of the vulnerability and its potential impact.
- Steps to reproduce (a minimal proof-of-concept is ideal, not required).
- Any affected version/commit you've confirmed it against.

## Response Time Commitments

| Stage | Target |
|---|---|
| Acknowledgment of report | 2 business days |
| Initial assessment (severity, affected versions) | 5 business days |
| Fix for a **Critical** severity issue | 7 days from confirmed report |
| Fix for a **High** severity issue | 30 days |
| Fix for **Medium/Low** severity issues | Next regular release cycle |

Severity follows [CVSS 3.1](https://www.first.org/cvss/calculator/3.1) scoring as a starting point,
adjusted for this application's actual exposure (e.g. an issue requiring authenticated OWNER-level
access is treated as lower severity than the same bug pre-authentication).

## Disclosure

We ask reporters to give us the response window above before any public disclosure. Once a fix is
released, we credit reporters (with permission) in the release notes.

## Scope

This covers the Prowosma backend and frontend applications in this organization's repositories.
Third-party dependencies with their own vulnerabilities should generally be reported to that project
directly — though we'd still appreciate a heads-up so we can track and update on our end (see
Dependabot / Trivy scanning, which already monitors dependency CVEs on a schedule — this policy is
about vulnerabilities in Prowosma's own code).

## Automated Security Coverage

This isn't a substitute for a human report on something automated tooling missed, but for context on
what's already continuously checked (see `docs/SECURITY_TESTING.md` for full detail):

- **SAST**: CodeQL, on every push/PR and weekly.
- **Dependency/SCA**: GitHub Dependency Review (every PR) + Trivy (daily).
- **DAST**: OWASP ZAP baseline scan, weekly.
- **SBOM**: generated for every published container image.

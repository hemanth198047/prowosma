# Subprocessor List (Template — Requires Legal Review Before Publishing)

**This is a template, not a signed legal commitment.** It's built from an accurate technical inventory
of every third-party service this codebase actually integrates with, across this entire backlog — not
a generic boilerplate list. Before publishing this as a customer-facing DPA attachment: have it
reviewed by actual legal counsel, confirm each vendor's own DPA is executed, and fill in the
placeholders marked below.

## Core infrastructure (used for every deployment)

| Subprocessor | Purpose | Data involved |
|---|---|---|
| MongoDB (self-hosted or MongoDB Atlas) | Primary application database | All application data |
| `[Your cloud provider — AWS/GCP/Azure]` | Compute hosting | All application data (in transit/processing) |

## Optional, only active if configured

| Subprocessor | Purpose | Data involved | Activated by |
|---|---|---|---|
| Amazon S3 | File attachment storage | Uploaded file attachments | `FILE_STORAGE_PROVIDER=s3` |
| AWS Secrets Manager | Secrets storage | Application credentials (not customer data) | `spring.config.import=aws-secretsmanager:...` |
| Auth0 | Authentication (SSO, social login) | Email, name, auth tokens | `VITE_AUTH0_DOMAIN` configured |
| `[SMTP provider — Amazon SES / SendGrid / Postmark / Mailgun]` | Transactional email delivery | Recipient email address, email content | `SMTP_HOST` configured |
| Stripe | Billing and subscription management | Billing/payment information | Billing feature enabled |
| `[Tracing backend — Honeycomb / Grafana Cloud / Datadog / New Relic]` | Distributed tracing (operational, not customer-facing) | Request metadata, NOT typically customer content | `OTLP_TRACING_ENDPOINT` configured |
| ClamAV (self-hosted, not a subprocessor if you run your own instance) | Malware scanning of uploads | File content (scanned, not retained by ClamAV) | `VIRUS_SCAN_PROVIDER=clamav` |

## Customer-configured (the customer's own subprocessor, not this application's)

These are configured BY a customer workspace to integrate with infrastructure THEY already have a
relationship with — technically reachable by this application per that workspace's own configuration,
but not a subprocessor relationship this application's own DPA governs:

- SAML identity providers (Okta, Azure AD, Google Workspace, or a custom IdP) — see `docs/SSO_SETUP.md`
- Per-workspace SMTP settings (if a workspace configures its own mail server rather than using the
  server-wide default) — see `docs/EMAIL_SETUP.md`
- Outbound webhook destinations a workspace configures

## CI/CD tooling (does not touch production customer data)

| Tool | Purpose |
|---|---|
| GitHub (Actions, Container Registry, Dependabot) | Build/test/deploy pipeline — see `docs/RELEASE_PROCESS.md` |
| CodeQL, Trivy, OWASP ZAP | Security scanning of code/dependencies/running app — see `docs/SECURITY_TESTING.md` |

## Before publishing this list

- [ ] Fill in the bracketed placeholders above with the actual providers chosen for this deployment.
- [ ] Confirm a Data Processing Agreement is executed with each active subprocessor (most listed here —
      AWS, MongoDB Atlas, Auth0, Stripe, the major email providers — publish standard DPAs; the SOC 2 /
      ISO 27001 status of each is usually published on their own trust/security pages).
- [ ] Add a change-notification process — most privacy regulations (GDPR Article 28 in particular)
      expect customers to be notified of new subprocessors before they're added, not after.
- [ ] Have actual legal counsel review this before it's presented to a customer as a compliance
      commitment — this document is accurate about the technical inventory, not a substitute for legal
      review of the resulting obligations.

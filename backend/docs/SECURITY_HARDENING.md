# Security Hardening

## What changed

| Gap | What's now real |
|---|---|
| No managed secrets store integration | `spring-cloud-aws-starter-secrets-manager` dependency added (opt-in — see below) |
| No field-level encryption for sensitive stored data | `FieldEncryptionService` (AES-256-GCM) now protects `WorkspaceConfig.smtpPassword` |
| No security response headers | `SecurityConfig.java` now sets CSP, HSTS, X-Frame-Options, X-Content-Type-Options |
| No WAF/DDoS protection documented | Concrete Terraform examples below (AWS WAF + Cloudflare) |
| No vulnerability disclosure process | `SECURITY.md` (repo root) |

## Managed secrets store

**Dependency note**: `io.awspring.cloud:spring-cloud-aws-starter-secrets-manager:3.2.1` was added to
`build.gradle` based on Spring Cloud AWS's documented artifact convention — **confirm the current
latest version** before relying on this in a real deployment; it could not be verified against a live
Maven Central lookup from the environment this was written in (same caveat as every other dependency
added throughout this engagement).

**Entirely opt-in** — the dependency being present changes nothing by itself. To actually resolve
secrets from AWS Secrets Manager instead of plain environment variables:

```properties
# application.properties, or an env-var override of this same property
spring.config.import=aws-secretsmanager:prowosma/prod
```

This tells Spring to fetch every key/value pair from the Secrets Manager secret named
`prowosma/prod` and expose them as regular Spring properties — `MONGODB_URI`, `JWT_SECRET`,
`ENCRYPTION_KEY`, `SMTP_PASSWORD`, `STRIPE_SECRET_KEY`, etc. can all live there instead of (or blended
with) plain environment variables, with **zero application code change** — every place in this
codebase that reads `${SOME_ENV_VAR:default}` keeps working identically regardless of whether that
value came from a real env var or from Secrets Manager.

Requires the running environment to have AWS credentials with `secretsmanager:GetSecretValue` on that
secret (an IAM role is strongly preferred over long-lived keys — same guidance as
`docs/FILE_STORAGE_SETUP.md`'s S3 section).

### Alternatives (not wired up, but the equivalent path for each)

- **HashiCorp Vault**: `spring-cloud-starter-vault-config` + `spring.cloud.vault.*` properties —
  Spring Cloud Vault is the equivalent officially-supported integration.
- **Azure Key Vault**: `spring-cloud-azure-starter-keyvault-secrets` + `spring.cloud.azure.keyvault.*`
  properties.

Not implemented here because doing so would mean adding and only partially verifying three separate
cloud SDKs' worth of dependencies with no way to test any of them against a real account from this
environment — one real, well-documented path (AWS, matching the S3 integration already in this
codebase) plus clear pointers to the equivalents was judged better than three unverified ones.

### Key rotation

Secrets Manager supports automatic rotation (a Lambda function AWS provides templates for, on a
schedule) for RDS/DocumentDB-style credentials natively. For this app's secrets (JWT signing key,
`ENCRYPTION_KEY`, SMTP/Stripe credentials), rotation is more manual since they're not a database
credential Secrets Manager natively knows how to rotate:

1. Generate a new value.
2. Update the secret in Secrets Manager.
3. Restart the backend (or, if running multiple instances, do a rolling restart — see
   `k8s/backend-deployment.yaml`'s rolling-update strategy) so every instance picks up the new value.

**`ENCRYPTION_KEY` rotation specifically needs care**: `FieldEncryptionService` has no built-in
re-encryption-on-rotation — rotating that key without re-encrypting already-stored values first would
make them permanently undecryptable. A real rotation procedure: decrypt every affected field with the
old key, re-encrypt with the new key, save, only then remove the old key from the environment. Not
automated by this change — a manual, careful, one-time script per rotation event, matching the
"safer to be honest about a gap than pretend a governance process exists" pattern used elsewhere.

## Field-level encryption

See `FieldEncryptionService`'s own class-level doc comment for the full design (AES-256-GCM,
`ENCRYPTION_KEY` env var, legacy-plaintext passthrough for a safe rollout with no forced migration).
Currently applied to `WorkspaceConfig.smtpPassword` — the specific field this engagement's earlier
Email Delivery item's own doc comment flagged as "plaintext at rest."

**Extending to other sensitive fields**: the same pattern (`fieldEncryptionService.encrypt(...)` on
save, `.decrypt(...)` at the point of actual use) applies to any other stored secret — API keys stored
in `Integration.config`, SCIM bearer tokens, etc. Not applied to those in this change to keep the
change reviewable and its correctness verifiable field-by-field rather than a sweeping, harder-to-audit
change across many models at once.

## Security response headers

Added via Spring Security's own `.headers()` DSL in `SecurityConfig.java` (not hand-rolled) —
Content-Security-Policy, Strict-Transport-Security, X-Frame-Options, X-Content-Type-Options. See that
file's own comments for the specific CSP directives chosen and why (deliberately permissive enough not
to break existing inline styles, tightenable later).

## Encryption at rest (database & storage level)

- **MongoDB**: encryption at rest is a deployment/infrastructure setting, not application code —
  MongoDB Atlas encrypts at rest by default; a self-hosted replica set (see the Scalability & HA item)
  needs the WiredTiger storage engine's `--enableEncryption` option with a KMIP-compatible key
  management setup, or filesystem/disk-level encryption (e.g. AWS EBS encryption) as a simpler
  alternative that doesn't require MongoDB Enterprise.
- **S3 uploads**: already covered — `FileStorageService` sets `ServerSideEncryption.AES256` on every
  upload by default (see the File Storage item).

## WAF / DDoS protection

Infrastructure-layer, deployment-target-dependent — not implemented as running infrastructure here,
same reasoning as the CDN/autoscaling examples in the Scalability & HA item. Concrete starting points:

**AWS WAF** (paired with the CloudFront distribution from the Scalability & HA item):

```hcl
resource "aws_wafv2_web_acl" "prowosma" {
  name  = "prowosma-waf"
  scope = "CLOUDFRONT"

  default_action { allow {} }

  rule {
    name     = "RateLimitPerIP"
    priority = 1
    action { block {} }
    statement {
      rate_based_statement {
        limit              = 2000  # requests per 5-minute window per IP — a coarse edge-level
                                    # backstop ABOVE RateLimitFilter's own 300/minute application-level
                                    # limit, not a replacement for it
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      sampled_requests_enabled   = true
      cloudwatch_metrics_enabled = true
      metric_name                = "RateLimitPerIP"
    }
  }

  rule {
    name     = "AWSManagedCommonRuleSet"
    priority = 2
    override_action { none {} }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      sampled_requests_enabled   = true
      cloudwatch_metrics_enabled = true
      metric_name                = "CommonRuleSet"
    }
  }

  visibility_config {
    sampled_requests_enabled   = true
    cloudwatch_metrics_enabled = true
    metric_name                = "prowosma-waf"
  }
}
```

DDoS protection at the network layer: AWS Shield Standard is automatic and free for any
CloudFront/ALB-fronted deployment; Shield Advanced is a paid tier with SLA-backed mitigation for
larger/high-risk deployments.

**Cloudflare** (alternative, provider-agnostic to AWS): point DNS through Cloudflare, enable their WAF
managed ruleset and rate limiting rules via their dashboard or Terraform provider — broadly equivalent
protection with a different operational model (DNS-level proxy rather than CDN-attached ACL).

## Vulnerability disclosure & patch management

See `SECURITY.md` (repo root) for the disclosure process and response-time commitments. CVE monitoring
for this codebase's own dependencies is handled by Dependabot + the Trivy scan added in the Testing &
QA item — both already running on a schedule, not a separate thing to set up.

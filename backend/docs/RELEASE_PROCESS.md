# Release Process, Versioning & Rollback

## What changed

Previously there was no CI pipeline, no deployment automation, no Infrastructure-as-Code, no
blue-green/canary strategy, and no documented rollback procedure beyond "redeploy the previous image" —
which wasn't even possible before, since no image was ever published anywhere.

This document, together with `.github/workflows/backend-ci.yml`, `.github/workflows/docker-publish.yml`,
and (in the frontend repo) their equivalents, is what closes that gap.

## What's real now

- **CI on every push/PR**: `backend-ci.yml` / `frontend-ci.yml` — build, test, enforce the coverage
  gates added earlier in this backlog, confirm the Docker image builds.
- **Versioned, published container images**: `docker-publish.yml` pushes to GitHub Container Registry
  (`ghcr.io`) on every push to `main` (tagged `main` + the commit SHA) and every version tag matching
  `v*.*.*` (tagged with the real semver version + `latest`). No registry account setup needed —
  `GITHUB_TOKEN` already has push access to your own repo's GHCR packages.
- **Dependency update automation**: `dependabot.yml` in both repos — weekly PRs for Gradle/npm,
  Docker base images, and GitHub Actions versions, with routine minor/patch bumps grouped into one PR.
- **A working example Kubernetes manifest** (`k8s/backend-deployment.yaml`) demonstrating rolling
  updates gated on the app's existing health-check endpoints, and one-command rollback.

## Versioning

Semantic versioning via git tags: `v<major>.<minor>.<patch>` (e.g. `v1.4.2`).

- **Patch** (`v1.4.2` → `v1.4.3`): bug fixes, no behavior change for API consumers.
- **Minor** (`v1.4.x` → `v1.5.0`): new features, backward-compatible.
- **Major** (`v1.x.x` → `v2.0.0`): breaking API changes.

```bash
git tag v1.4.2
git push origin v1.4.2
```

Pushing the tag triggers `docker-publish.yml`, which builds and pushes
`ghcr.io/<org>/prowosma-backend:v1.4.2` (and `:1.4`, and `:latest`).

## Releasing

1. Merge to `main` (CI runs automatically on the PR — do not merge with a red build).
2. Tag the merge commit with the next version (see above).
3. Deploy that exact tag to your target environment (see "Deploying" below) — never deploy `:latest`
   or `:main` to production; always name the exact version, so a rollback has an unambiguous target.
4. Smoke-test the deployment (health endpoint, a login, one core workflow).

## Rollback

The concrete, deployment-target-agnostic version: **redeploy the previous version's tag.** Because
every release is a real, immutable, named image (see Versioning above), this is always possible and
always fast — nothing needs to be rebuilt.

- **Kubernetes**: `kubectl set image deployment/prowosma-backend backend=ghcr.io/<org>/prowosma-backend:v1.4.1`
  (or, if using the rollout history: `kubectl rollout undo deployment/prowosma-backend`).
- **ECS**: update the task definition's image to the previous tag and force a new deployment
  (`aws ecs update-service --force-new-deployment`), or use CodeDeploy's blue/green rollback if that's
  configured for the service.
- **Plain Docker host / docker-compose**: `docker pull ghcr.io/<org>/prowosma-backend:v1.4.1 && docker compose up -d`
  with the compose file's image tag updated to the prior version.

## Blue-green / canary — target-dependent, not implemented here

**This deployment target was still an open decision as of this backlog** (see this repo's own earlier
comments elsewhere referencing that). A genuine blue-green or canary strategy is inherently specific
to the target:

- **Kubernetes**: run two Deployments (or use a service mesh / Argo Rollouts) and shift a Service's
  selector or traffic-split weights between them.
- **ECS**: native support via CodeDeploy's blue/green deployment type for ECS services.
- **A plain Docker host behind a reverse proxy**: run the new version alongside the old on a different
  port, verify it, then swap the reverse proxy's upstream target — effectively a manual blue-green.

`k8s/backend-deployment.yaml` demonstrates a **rolling update** (zero-downtime, but not blue-green —
old and new pods briefly coexist during the rollout rather than a full environment swap), which is a
reasonable default for most teams and is what's actually implemented and testable here. Implementing
true blue-green requires picking a target first — this document gives the concrete recipe for each
common target so that choice, once made, has a clear next step rather than starting from nothing.

## Infrastructure as Code

Not implemented as a complete Terraform/Pulumi/CloudFormation stack in this change, for the same
reason blue-green isn't: the actual deployment target (which cloud, which account, which existing
infrastructure to integrate with) wasn't decided as of this backlog, and writing IaC against a
guessed-at target would produce something that looks complete but has never been validated against
real infrastructure — exactly the kind of unverified, overclaiming change avoided everywhere else in
this engagement. `k8s/backend-deployment.yaml` and `k8s/backup-cronjob.yaml` are real, working
Kubernetes manifests once a cluster exists; a Terraform module to provision that cluster (EKS/GKE/AKS)
plus its supporting infrastructure (VPC, managed MongoDB or a self-hosted replica set, load balancer,
DNS, secrets store) is the concrete next piece of work once the target is chosen — each of those is
itself a well-documented, standard Terraform pattern for whichever cloud gets picked.

## What this still doesn't cover

- **Automated deployment on release** (CD, not just CI) — `docker-publish.yml` publishes the image;
  actually deploying it to a running environment needs a target-specific step (a `kubectl set image`
  call, an ECS API call, etc.) added once that target exists. Intentionally not guessed at here.
- **SAST/DAST/dependency vulnerability scanning in the pipeline** — tracked as a separate item in this
  backlog (Testing & Quality Assurance), not duplicated here.
- **A staging environment and its own pipeline stage** — depends on the deployment target existing
  first.

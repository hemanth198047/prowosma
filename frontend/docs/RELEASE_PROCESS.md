# Release Process, Versioning & Rollback (Frontend)

Same versioning and CI/CD approach as the backend repo — see its `docs/RELEASE_PROCESS.md` for the
full rationale. Summary for this repo specifically:

- `.github/workflows/frontend-ci.yml` — lint (advisory), test + coverage gate (blocking), production
  build check, on every push/PR.
- `.github/workflows/docker-publish.yml` — publishes `ghcr.io/<org>/prowosma-frontend:<tag>` on
  pushes to `main` and on `v*.*.*` tags. `VITE_API_URL`/`VITE_AUTH0_DOMAIN`/`VITE_AUTH0_CLIENT_ID` are
  baked in at that build time from repo variables — set these before publishing an image meant for a
  real deployment (see `docs/SSO_SETUP.md` / `docs/ACCESSIBILITY.md`'s referenced files for context on
  why these are build-time, not runtime, values for a Vite app).
- `.github/dependabot.yml` — weekly npm/Docker/Actions update PRs.

## Rollback

Same principle as the backend: redeploy the previous version's published image tag. Since this is a
static frontend, an alternative (if deployed to a CDN/static host like S3+CloudFront, Vercel, or
Netlify rather than as a container) is keeping the previous build's `dist/` artifact (already uploaded
as a CI artifact on every `frontend-ci.yml` run, 7-day retention) and re-publishing it — check
whichever hosting target is chosen for its own native rollback mechanism first (most static hosts have
one built in, e.g. Vercel's instant rollback, Netlify's deploy history) before falling back to a manual
re-publish.

## Deployment target — still undecided, same as backend

This repo can be deployed as: a static build (`npm run build` → `dist/`) served by any static
host/CDN, or as the Docker image (`Dockerfile` — nginx serving the same static build). Neither is
implemented as an actual live deployment in this backlog item — see the backend's
`docs/RELEASE_PROCESS.md` for why (the target itself wasn't decided) and what the concrete next step
looks like once it is.

# ── Build stage ────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

# Copy manifest files first so this layer only rebuilds when dependencies
# actually change, not on every source edit.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# VITE_API_URL is a build-time arg (Vite bakes env vars into the built JS
# at compile time, not read at container-start time like a typical backend
# env var) — see api/client.js and the other files that read
# import.meta.env.VITE_API_URL. Must be an address the BROWSER can resolve
# (this JS runs on the user's machine, not inside Docker's network) — so
# this defaults to the backend's host-mapped port, not its Docker Compose
# service name. docker-compose.yml sets this explicitly; override with
# --build-arg for any other deployment target.
ARG VITE_API_URL=http://localhost:9090
ENV VITE_API_URL=$VITE_API_URL

# Same build-time-bake caveat as VITE_API_URL above. Leave unset to fall
# back to the shared development Auth0 tenant (src/config/auth0.js); set
# both to point this build at a real, customer-owned Auth0 tenant without
# touching any source file.
ARG VITE_AUTH0_DOMAIN=""
ENV VITE_AUTH0_DOMAIN=$VITE_AUTH0_DOMAIN
ARG VITE_AUTH0_CLIENT_ID=""
ENV VITE_AUTH0_CLIENT_ID=$VITE_AUTH0_CLIENT_ID

# Same pattern — leave unset to disable client-side error tracking
# entirely (src/config/errorTracking.js).
ARG VITE_SENTRY_DSN=""
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN
ARG VITE_SENTRY_ENVIRONMENT="production"
ENV VITE_SENTRY_ENVIRONMENT=$VITE_SENTRY_ENVIRONMENT

RUN npm run build

# ── Runtime stage ──────────────────────────────────────────────
# nginx serves the static build output — there's no Node process running
# in the final image, just static files, which is both smaller and
# removes an entire runtime's worth of attack surface compared to serving
# via `vite preview` or a Node static-file server in production.
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]

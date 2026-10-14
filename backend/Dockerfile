# ── Build stage ────────────────────────────────────────────────
# Uses the same Java 21 toolchain build.gradle already declares
# (java { toolchain { languageVersion = JavaLanguageVersion.of(21) } }).
# eclipse-temurin is the same distribution the CI workflow's
# actions/setup-java step already uses (distribution: "temurin"), so local
# Docker builds and CI builds compile against the identical JDK.
FROM eclipse-temurin:21-jdk-jammy AS build
WORKDIR /app

# Copy Gradle wrapper + build files first and run a dependency-only step —
# Docker layer caching means this expensive layer is only rebuilt when
# build.gradle/gradle files actually change, not on every source edit.
COPY gradlew .
COPY gradle gradle
COPY build.gradle settings.gradle* ./
RUN chmod +x gradlew && ./gradlew dependencies --no-daemon || true

# Now copy real source and build the runnable jar
COPY src src
RUN ./gradlew bootJar --no-daemon -x test

# ── Runtime stage ──────────────────────────────────────────────
# jre (not jdk) — no compiler needed to just run the jar, meaningfully
# smaller image, smaller attack surface.
FROM eclipse-temurin:21-jre-jammy
WORKDIR /app

# curl for the HEALTHCHECK below — not guaranteed to be present in the
# slim jre-jammy base, and this couldn't be verified by actually running
# `docker build` in the sandbox this was written in (no registry network
# access there), so installing it explicitly is the safe choice rather
# than gambling wget/curl already exists.
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Run as a non-root user — the default "run as root inside the container"
# is unnecessary risk for a process that never needs it.
RUN groupadd -r prowosma && useradd -r -g prowosma prowosma
USER prowosma

COPY --from=build /app/build/libs/*.jar app.jar

# The app listens on $PORT when the host provides one (e.g. Render), otherwise 9090
# (server.port=${PORT:9090} in application.properties). EXPOSE is documentation only.
EXPOSE 9090

# Container-aware JVM defaults: respect the container's memory limit
# (set via `docker run -m` / Kubernetes resource limits) rather than the
# host's, which is the JVM's default behavior on some older setups and a
# classic cause of containers getting OOM-killed despite "having enough
# RAM" on the host.
# ExitOnOutOfMemoryError: if memory runs out, stop so the platform restarts a clean process instead of leaving a half-working one running.
ENV JAVA_OPTS="-XX:MaxRAMPercentage=75.0 -XX:+ExitOnOutOfMemoryError"

# Real health check — hits the actual HealthController endpoint (see
# HealthController.java's /api/health/ready, which pings MongoDB) rather
# than just checking the process is alive. A running-but-DB-disconnected
# instance should be reported unhealthy, not "fine".
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:${PORT:-9090}/api/health/ready || exit 1

# exec: java becomes the main process, so the platform's stop signal reaches it and it can shut down gracefully (with plain `sh -c`, the shell
# swallowed the signal and the container was killed after the grace period).
ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar app.jar"]

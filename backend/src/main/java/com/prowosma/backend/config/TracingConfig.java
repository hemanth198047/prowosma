package com.prowosma.backend.config;

import io.opentelemetry.exporter.otlp.http.trace.OtlpHttpSpanExporter;
import io.opentelemetry.sdk.trace.export.SpanExporter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Duration;

/**
 * Distributed tracing — optional exporter customization.
 *
 * Spring Boot's own auto-configuration already builds a working
 * {@link OtlpHttpSpanExporter} purely from application.properties
 * (management.otlp.tracing.endpoint/timeout/compression) — the default,
 * self-hosted-collector case (Jaeger/Tempo/an OTel Collector, e.g. the one
 * docker-compose.yml now starts locally) needs nothing beyond that, and
 * this class defines no bean at all in that case, so Spring Boot's default
 * wiring runs completely unmodified.
 *
 * The one thing Spring Boot's own OTLP tracing auto-configuration does NOT
 * expose via properties is a per-request auth header, which several
 * hosted trace backends require (Honeycomb: x-honeycomb-team, Grafana
 * Cloud: a Basic-auth Authorization header, some Datadog/New Relic OTLP
 * endpoints: a bearer token). This bean activates ONLY when
 * otlp.tracing.auth-header is actually set (see application.properties +
 * docs/OBSERVABILITY_SETUP.md) — set that one property and no code change
 * or rebuild-with-different-source is ever needed to point this at a
 * hosted vendor instead of a self-hosted collector.
 */
@Slf4j
@Configuration
public class TracingConfig {

    @Value("${management.otlp.tracing.endpoint:http://localhost:4318/v1/traces}")
    private String endpoint;

    @Value("${management.otlp.tracing.timeout:10s}")
    private Duration timeout;

    /** Format: "Header-Name=value". This whole bean is skipped unless this is set. */
    @Value("${otlp.tracing.auth-header:}")
    private String authHeader;

    @Bean
    @ConditionalOnProperty(name = "otlp.tracing.auth-header")
    public SpanExporter otlpHttpSpanExporterWithAuthHeader() {
        int eq = authHeader.indexOf('=');
        if (eq <= 0) {
            log.warn("[TracingConfig] otlp.tracing.auth-header is set but not in 'Header-Name=value' " +
                "format ('{}') — falling back to an exporter with no auth header rather than " +
                "silently disabling tracing.", authHeader);
            return OtlpHttpSpanExporter.builder()
                .setEndpoint(endpoint)
                .setTimeout(timeout)
                .build();
        }

        String headerName = authHeader.substring(0, eq).trim();
        String headerValue = authHeader.substring(eq + 1).trim();
        log.info("[TracingConfig] OTLP span exporter active with auth header '{}' for endpoint {}",
            headerName, endpoint);

        // Compression is intentionally left at the exporter's default here (rather than also
        // reading management.otlp.tracing.compression) because the OTel SDK's Compression API
        // has changed shape across versions and this project doesn't pin an explicit
        // opentelemetry-exporter-otlp version — Spring Boot's dependency-management BOM decides
        // it. Safer to leave compression alone on this less-common, header-auth path than risk
        // depending on an API shape that may not match the resolved SDK version.
        return OtlpHttpSpanExporter.builder()
            .setEndpoint(endpoint)
            .setTimeout(timeout)
            .addHeader(headerName, headerValue)
            .build();
    }
}

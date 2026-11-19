package com.prowosma.backend.config;

import org.junit.jupiter.api.Test;
import org.springframework.web.cors.CorsConfiguration;

import static org.assertj.core.api.Assertions.assertThat;

/** The app opened locally as localhost, 127.0.0.1 or [::1] (IPv6), on any port, may call the API; other sites may not. */
class CorsLocalOriginsTest {
    @Test
    void localOriginsOnAnyPort() {
        CorsConfiguration c = new CorsConfiguration();
        c.setAllowedOriginPatterns(CorsConfig.originPatterns("https://app.example.com", true));
        assertThat(c.checkOrigin("http://localhost:5174")).isNotNull();
        assertThat(c.checkOrigin("http://127.0.0.1:5173")).isNotNull();
        assertThat(c.checkOrigin("http://[::1]:5173")).isNotNull();
        assertThat(c.checkOrigin("https://app.example.com")).isNotNull();
        assertThat(c.checkOrigin("https://evil.example.org")).isNull();
    }
}

package com.prowosma.backend.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.List;

/**
 * CORS configuration.
 *
 * Previously: allowed origins hardcoded. Fixed: reads from application.properties.
 * Production set: app.cors.allowed-origins=https://app.prowosma.io,https://admin.prowosma.io
 */
@Configuration
public class CorsConfig {

    @Value("${app.cors.allowed-origins:http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173}")
    private String allowedOriginsRaw;

    /**
     * Also accept the app opened on ANY port of this computer (http://localhost:* and http://127.0.0.1:*).
     * On Windows, Hyper-V/WSL often reserve port 5173 so Vite silently starts on 5174; with only :5173 allowed,
     * every request - sign-in included - was refused with "403 Invalid CORS request". Sign-in uses a token in a header,
     * not cookies, so this doesn't let other sites act as the user. Set APP_CORS_ALLOW_ANY_LOCALHOST=false to turn it off.
     */
    @Value("${app.cors.allow-any-localhost:true}")
    private boolean allowAnyLocalhost = true;

    /** The configured origins (exact URLs or patterns), plus any localhost port when allowed. */
    public static List<String> originPatterns(String raw, boolean anyLocalhost) {
        List<String> out = new java.util.ArrayList<>();
        for (String o : raw.split(",")) if (!o.isBlank()) out.add(o.trim());
        if (anyLocalhost) { out.add("http://localhost:[*]"); out.add("http://127.0.0.1:[*]"); }
        return out;
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();

        // Split comma-separated origins from property; each can be a pattern or exact URL
        config.setAllowedOriginPatterns(originPatterns(allowedOriginsRaw, allowAnyLocalhost));

        config.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));

        config.setAllowedHeaders(List.of(
            "Authorization",
            "Content-Type",
            "X-Workspace-Id",
            "X-Requested-With",
            "Accept",
            "Origin",
            "Cache-Control"
        ));

        config.setExposedHeaders(List.of(
            "X-RateLimit-Limit",
            "X-RateLimit-Remaining",
            "X-RateLimit-Reset",
            "ETag"
        ));

        config.setAllowCredentials(true);
        config.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }
}

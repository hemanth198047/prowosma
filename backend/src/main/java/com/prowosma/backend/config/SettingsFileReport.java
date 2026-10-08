package com.prowosma.backend.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationEnvironmentPreparedEvent;
import org.springframework.context.ApplicationListener;
import org.springframework.core.Ordered;
import org.springframework.core.env.Environment;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Prints, at startup, WHERE the settings came from — so a wrong or missing setting is obvious in the first lines of the log instead of
 * showing up minutes later as a database timeout. It reports presence and non-secret facts only: it never prints a password, key,
 * secret or any part of one (the database address is shown without its username and password).
 */
public class SettingsFileReport implements ApplicationListener<ApplicationEnvironmentPreparedEvent>, Ordered {

    private static final Logger log = LoggerFactory.getLogger(SettingsFileReport.class);
    private static final Pattern MONGO = Pattern.compile("^(mongodb(?:\\+srv)?)://(?:[^/?]*@)?([^/?]+)");
    private static final String DEV_JWT_PREFIX = "prowosma-dev-secret";

    @Override
    public int getOrder() { return Ordered.LOWEST_PRECEDENCE; }          // after the settings file has been loaded

    @Override
    public void onApplicationEvent(ApplicationEnvironmentPreparedEvent event) {
        try {
            Environment env = event.getEnvironment();
            log.info("[Settings] Settings file /etc/secrets/.env: {} | ./.env: {}", describe(Path.of("/etc/secrets/.env")), describe(Path.of(".env")));
            log.info("[Settings] Files in /etc/secrets: {}", listNames(Path.of("/etc/secrets")));
            log.info("[Settings] MongoDB address: {}", describeMongo(env.getProperty("spring.mongodb.uri")));
            log.info("[Settings] Port: {} (host PORT variable {})", env.getProperty("server.port"), System.getenv("PORT") == null ? "not set" : "set");
            String jwt = env.getProperty("jwt.secret", "");
            log.info("[Settings] JWT secret: {}", jwt.isBlank() ? "EMPTY — logins will not work" : jwt.startsWith(DEV_JWT_PREFIX)
                    ? "NOT SET — using the built-in development default (insecure; set JWT_SECRET)" : "set");
            log.info("[Settings] ENCRYPTION_KEY: {} | FRONTEND_URL: {}", blank(env.getProperty("security.field-encryption-key")) ? "NOT SET" : "set",
                    env.getProperty("app.frontend.url"));
        } catch (RuntimeException e) {
            log.warn("[Settings] Could not report settings sources ({})", e.getClass().getSimpleName());      // diagnostics must never stop the app from starting
        }
    }

    static String describe(Path p) {
        try {
            if (!Files.exists(p)) return "not found";
            if (!Files.isReadable(p)) return "found but NOT readable";
            return "found (" + Files.size(p) + " bytes)";
        } catch (IOException | SecurityException e) {
            return "could not be checked";
        }
    }

    static String listNames(Path dir) {
        try (var s = Files.list(dir)) {
            String names = s.map(x -> x.getFileName().toString()).sorted().collect(Collectors.joining(", "));
            return names.isEmpty() ? "(empty)" : names;
        } catch (IOException | SecurityException e) {
            return "(folder not found)";
        }
    }

    /** "mongodb+srv://cluster0.abc.mongodb.net" — scheme and host only; credentials and options are never included. */
    static String describeMongo(String uri) {
        if (uri == null || uri.isBlank()) return "NOT SET";
        Matcher m = MONGO.matcher(uri.trim());
        if (!m.find()) return "set, but not in a recognisable mongodb:// form";
        String host = m.group(2);
        boolean local = host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.startsWith("0.0.0.0");
        return m.group(1) + "://" + host + (local ? "  <-- this is the machine itself: no hosted database address was found" : "");
    }

    private static boolean blank(String s) { return s == null || s.isBlank(); }
}

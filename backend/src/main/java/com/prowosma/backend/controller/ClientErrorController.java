package com.prowosma.backend.controller;

import io.micrometer.core.instrument.MeterRegistry;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Where the browser tells the server that something broke on a person's screen ("Something went wrong").
 * Without this a crash in someone's browser leaves no trace anywhere. Each report becomes one line in the server log starting with
 * <code>[client-error]</code> (find them with <code>journalctl -u prowosma-backend | grep client-error</code>), and is counted in the
 * <code>client.errors</code> metric. It lives under /api/auth so it is reachable before sign-in (a crash on the login page is the one
 * you most need to hear about). Everything in a report is untrusted text: control characters are removed and lengths capped, so
 * nobody can forge log lines, and no more than {@link #MAX_PER_MINUTE} reports are written per minute in total.
 */
@Slf4j
@RestController
@RequestMapping("/api/auth/client-errors")
public class ClientErrorController {
    static final int MAX_PER_MINUTE = 120;

    private final MeterRegistry meters;
    private final AtomicLong window = new AtomicLong();
    private final java.util.concurrent.atomic.AtomicInteger inWindow = new java.util.concurrent.atomic.AtomicInteger();

    public ClientErrorController(MeterRegistry meters) { this.meters = meters; }

    @PostMapping
    public ResponseEntity<Void> report(@RequestBody(required = false) Map<String, Object> body, Authentication auth) {
        if (body == null || !allowed(System.currentTimeMillis() / 60_000)) return ResponseEntity.noContent().build();
        String who = auth != null && auth.isAuthenticated() && auth.getName() != null && !"anonymousUser".equals(auth.getName()) ? auth.getName() : "-";
        String source = clean(body.get("source"), 20);
        meters.counter("client.errors", "source", source.isEmpty() ? "unknown" : source).increment();
        log.warn("[client-error] user={} page={} version={} source={} message=\"{}\" stack=\"{}\" agent=\"{}\"",
                clean(who, 120), clean(body.get("page"), 200), clean(body.get("version"), 60), source,
                clean(body.get("message"), 300), clean(body.get("stack"), 900), clean(body.get("userAgent"), 160));
        return ResponseEntity.noContent().build();
    }

    /** At most MAX_PER_MINUTE reports per clock minute, for the whole server. */
    boolean allowed(long minute) {
        synchronized (this) {
            if (window.get() != minute) { window.set(minute); inWindow.set(0); }
            return inWindow.incrementAndGet() <= MAX_PER_MINUTE;
        }
    }

    /** Text from the browser made safe for one log line: no line breaks or other control characters, no quotes, capped length. */
    static String clean(Object value, int max) {
        if (value == null) return "";
        String s = String.valueOf(value).replaceAll("[\\p{Cntrl}\\u2028\\u2029]+", " ").replace('"', '\'').trim();
        return s.length() > max ? s.substring(0, max) + "..." : s;
    }
}

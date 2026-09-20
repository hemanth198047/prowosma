package com.prowosma.backend.integration;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Real HTTP against a throw-away local server: what the integrations rely on the client to do (and not do). */
@DisplayName("OutboundHttp — no redirects, timeouts, size cap")
class OutboundHttpTest {

    private HttpServer server;
    private final AtomicReference<String> seenHeader = new AtomicReference<>();
    private final AtomicReference<String> seenContentType = new AtomicReference<>();
    private final AtomicReference<String> seenBody = new AtomicReference<>();
    private final AtomicInteger internalHits = new AtomicInteger();

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        server.createContext("/json", ex -> {
            seenHeader.set(ex.getRequestHeaders().getFirst("PRIVATE-TOKEN"));
            reply(ex, 200, "[{\"iid\":1}]");
        });
        server.createContext("/echo", ex -> {
            seenContentType.set(ex.getRequestHeaders().getFirst("Content-Type"));
            try (InputStream in = ex.getRequestBody()) { seenBody.set(new String(in.readAllBytes(), StandardCharsets.UTF_8)); }
            reply(ex, 202, "accepted");
        });
        server.createContext("/redirect", ex -> {
            ex.getResponseHeaders().add("Location", "/internal");
            ex.sendResponseHeaders(302, -1);
            ex.close();
        });
        server.createContext("/internal", ex -> { internalHits.incrementAndGet(); reply(ex, 200, "secret"); });
        server.createContext("/error", ex -> reply(ex, 401, "{\"message\":\"401 Unauthorized\"}"));
        server.createContext("/slow", ex -> {
            try { Thread.sleep(1500); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
            reply(ex, 200, "late");
        });
        server.createContext("/big", ex -> reply(ex, 200, "x".repeat(2000)));
        server.start();
    }

    private static void reply(com.sun.net.httpserver.HttpExchange ex, int status, String body) throws IOException {
        byte[] b = body.getBytes(StandardCharsets.UTF_8);
        ex.sendResponseHeaders(status, b.length);
        ex.getResponseBody().write(b);
        ex.close();
    }

    private URI uri(String path) { return URI.create("http://127.0.0.1:" + server.getAddress().getPort() + path); }

    private void stop() { server.stop(0); }

    @Test
    @DisplayName("GET returns status and body and sends the given headers")
    void get() throws Exception {
        try {
            OutboundHttp.Response r = new OutboundHttp().get(uri("/json"), Map.of("PRIVATE-TOKEN", "glpat-x"));
            assertEquals(200, r.status());
            assertTrue(r.ok());
            assertEquals("[{\"iid\":1}]", r.body());
            assertEquals("glpat-x", seenHeader.get());
        } finally { stop(); }
    }

    @Test
    @DisplayName("POST sends the JSON body with a JSON content type; any 2xx is ok")
    void post() throws Exception {
        try {
            OutboundHttp.Response r = new OutboundHttp().postJson(uri("/echo"), "{\"a\":\"é\"}");
            assertEquals(202, r.status());
            assertTrue(r.ok());
            assertEquals("application/json", seenContentType.get());
            assertEquals("{\"a\":\"é\"}", seenBody.get());
        } finally { stop(); }
    }

    @Test
    @DisplayName("a redirect is NOT followed: it comes back as a 3xx and the redirect target is never contacted")
    void noRedirects() throws Exception {
        try {
            OutboundHttp.Response r = new OutboundHttp().get(uri("/redirect"), null);
            assertEquals(302, r.status());
            assertFalse(r.ok());
            assertEquals(0, internalHits.get());
            assertEquals(302, new OutboundHttp().postJson(uri("/redirect"), "{}").status());
            assertEquals(0, internalHits.get());
        } finally { stop(); }
    }

    @Test
    @DisplayName("an error status is returned to the caller, not thrown")
    void errorStatus() throws Exception {
        try {
            OutboundHttp.Response r = new OutboundHttp().get(uri("/error"), null);
            assertEquals(401, r.status());
            assertFalse(r.ok());
            assertTrue(r.body().contains("Unauthorized"));
        } finally { stop(); }
    }

    @Test
    @DisplayName("a host that answers too slowly is given up on")
    void timeout() {
        try {
            OutboundHttp http = new OutboundHttp(Duration.ofSeconds(2), Duration.ofMillis(300), 1024);
            assertThrows(HttpTimeoutException.class, () -> http.get(uri("/slow"), null));
        } finally { stop(); }
    }

    @Test
    @DisplayName("a response over the size cap is refused instead of being read into memory")
    void sizeCap() throws Exception {
        try {
            OutboundHttp small = new OutboundHttp(Duration.ofSeconds(2), Duration.ofSeconds(5), 1000);
            assertThrows(IOException.class, () -> small.get(uri("/big"), null));
            assertEquals(2000, new OutboundHttp(Duration.ofSeconds(2), Duration.ofSeconds(5), 5000).get(uri("/big"), null).body().length());
        } finally { stop(); }
    }

    @Test
    @DisplayName("a refused connection surfaces as an IOException")
    void refused() {
        int port = server.getAddress().getPort();
        stop();
        assertThrows(IOException.class, () -> new OutboundHttp(Duration.ofSeconds(2), Duration.ofSeconds(2), 1024)
                .get(URI.create("http://127.0.0.1:" + port + "/x"), null));
    }
}

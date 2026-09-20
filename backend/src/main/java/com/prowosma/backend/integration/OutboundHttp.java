package com.prowosma.backend.integration;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;

/**
 * The HTTP client behind the outbound integrations (GitLab, Teams).
 *
 * Unlike a default {@code RestTemplate} it never follows redirects (a redirect from an
 * approved host to an internal one would defeat {@link OutboundUrlPolicy}), always has
 * timeouts (a slow or hostile host cannot hold a request thread forever), and refuses
 * responses over a size cap (it cannot be used to exhaust memory). It is built on the JDK's
 * own client, so it does not depend on a Spring HTTP-client version.
 *
 * It does not apply the URL policy itself; callers validate the URL first.
 */
public final class OutboundHttp {

    public record Response(int status, String body) {
        public boolean ok() { return status >= 200 && status < 300; }
    }

    public static final Duration DEFAULT_CONNECT_TIMEOUT = Duration.ofSeconds(10);
    public static final Duration DEFAULT_REQUEST_TIMEOUT = Duration.ofSeconds(20);
    public static final int DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

    private final HttpClient client;
    private final Duration requestTimeout;
    private final int maxBytes;

    public OutboundHttp() {
        this(DEFAULT_CONNECT_TIMEOUT, DEFAULT_REQUEST_TIMEOUT, DEFAULT_MAX_BYTES);
    }

    public OutboundHttp(Duration connectTimeout, Duration requestTimeout, int maxBytes) {
        this.client = HttpClient.newBuilder()
                .connectTimeout(connectTimeout)
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
        this.requestTimeout = requestTimeout;
        this.maxBytes = maxBytes;
    }

    public Response get(URI uri, Map<String, String> headers) throws IOException, InterruptedException {
        HttpRequest.Builder request = HttpRequest.newBuilder(uri).timeout(requestTimeout).GET();
        if (headers != null) headers.forEach(request::header);
        return send(request.build());
    }

    public Response postJson(URI uri, String json) throws IOException, InterruptedException {
        HttpRequest request = HttpRequest.newBuilder(uri).timeout(requestTimeout)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json, StandardCharsets.UTF_8))
                .build();
        return send(request);
    }

    private Response send(HttpRequest request) throws IOException, InterruptedException {
        HttpResponse<InputStream> response = client.send(request, HttpResponse.BodyHandlers.ofInputStream());
        try (InputStream in = response.body()) {
            byte[] body = in.readNBytes(maxBytes + 1);
            if (body.length > maxBytes) throw new IOException("Response is larger than " + maxBytes + " bytes");
            return new Response(response.statusCode(), new String(body, StandardCharsets.UTF_8));
        }
    }
}

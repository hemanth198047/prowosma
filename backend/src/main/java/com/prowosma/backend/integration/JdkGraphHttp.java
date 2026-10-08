package com.prowosma.backend.integration;

import org.springframework.stereotype.Component;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.Set;

/**
 * java.net.http transport with a hard allow-list: https to graph.microsoft.com and login.microsoftonline.com only (no other hosts,
 * ports or credentials in the URL), no redirects, and a response size cap so a hostile or runaway response can't exhaust memory.
 */
@Component
public class JdkGraphHttp implements GraphHttp {

    static final int MAX_BODY_BYTES = 12_000_000;
    private static final Set<String> ALLOWED_HOSTS = Set.of("graph.microsoft.com", "login.microsoftonline.com");

    private final HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();

    @Override
    public Result send(String method, String url, Map<String, String> headers, String body) throws IOException {
        URI uri = URI.create(url);
        if (!"https".equals(uri.getScheme()) || uri.getHost() == null || !ALLOWED_HOSTS.contains(uri.getHost())
                || uri.getPort() != -1 || uri.getUserInfo() != null) {
            throw new IllegalArgumentException("Outbound request blocked");
        }
        HttpRequest.Builder b = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(40));
        if (headers != null) headers.forEach(b::header);
        b.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
        try {
            HttpResponse<InputStream> r = client.send(b.build(), HttpResponse.BodyHandlers.ofInputStream());
            try (InputStream in = r.body()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[16_384];
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    if (out.size() > MAX_BODY_BYTES) throw new IOException("Response too large");
                }
                return new Result(r.statusCode(), out.toString(StandardCharsets.UTF_8));
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("Interrupted");
        }
    }
}

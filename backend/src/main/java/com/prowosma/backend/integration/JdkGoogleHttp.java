package com.prowosma.backend.integration;

import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;
import java.util.Set;

/**
 * java.net.http transport with a hard allow-list. Every URL is built from constants plus values validated
 * elsewhere, and this class refuses anything that is not https to a known Google API host — so even a
 * future bug cannot turn a meeting link or transcript into a request to an internal address.
 * Redirects are never followed.
 */
@Component
public class JdkGoogleHttp implements GoogleHttp {

    private static final Set<String> ALLOWED_HOSTS = Set.of("meet.googleapis.com", "oauth2.googleapis.com");

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
        HttpRequest.Builder b = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(25));
        if (headers != null) headers.forEach(b::header);
        b.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
        try {
            HttpResponse<String> r = client.send(b.build(), HttpResponse.BodyHandlers.ofString());
            return new Result(r.statusCode(), r.body());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("Interrupted");
        }
    }
}

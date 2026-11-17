package com.prowosma.backend.uma.core;

import com.prowosma.backend.integration.GoogleHttp;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;

/**
 * The AI Meeting Assistant's door to Google: https only, a fixed list of Google hosts, Calendar only under /calendar/v3/, no redirects.
 * (The shared Google client allows only the Meet and token hosts; Calendar lives on www.googleapis.com.)
 */
@Component
public class UmaGoogleHttp {
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10))
            .followRedirects(HttpClient.Redirect.NEVER).build();

    static boolean allowed(URI u) {
        if (!"https".equals(u.getScheme()) || u.getHost() == null || u.getPort() != -1 || u.getUserInfo() != null) return false;
        return switch (u.getHost()) {
            case "oauth2.googleapis.com", "meet.googleapis.com" -> true;
            case "www.googleapis.com" -> u.getRawPath() != null && u.getRawPath().startsWith("/calendar/v3/");
            default -> false;
        };
    }

    public GoogleHttp.Result send(String method, String url, Map<String, String> headers, String body) throws IOException {
        URI uri = URI.create(url);
        if (!allowed(uri)) throw new IllegalArgumentException("Outbound request blocked");
        HttpRequest.Builder b = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(25));
        if (headers != null) headers.forEach(b::header);
        b.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
        try {
            HttpResponse<String> r = client.send(b.build(), HttpResponse.BodyHandlers.ofString());
            return new GoogleHttp.Result(r.statusCode(), r.body());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("Interrupted");
        }
    }
}

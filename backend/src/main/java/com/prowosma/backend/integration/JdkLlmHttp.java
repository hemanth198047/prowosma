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
 * java.net.http transport. The three first-party provider hosts are allow-listed. Anything else (an administrator's
 * custom endpoint) must be https and must not resolve to a private/loopback/link-local address, checked again right
 * here before connecting — the same SSRF policy the rest of the application uses. Redirects are never followed.
 */
@Component
public class JdkLlmHttp implements LlmHttp {

    private static final Set<String> FIRST_PARTY = Set.of("api.anthropic.com", "api.openai.com", "generativelanguage.googleapis.com");

    private final HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();

    @Override
    public Result send(String method, String url, Map<String, String> headers, String body, boolean allowPrivateHosts) throws IOException {
        URI uri = OutboundUrlPolicy.parseHttps(url, "AI endpoint");
        if (!FIRST_PARTY.contains(uri.getHost().toLowerCase(java.util.Locale.ROOT)) && !allowPrivateHosts) {
            OutboundUrlPolicy.requirePublicAddress(uri, OutboundUrlPolicy.SYSTEM_RESOLVER, "AI endpoint");
        }
        HttpRequest.Builder b = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(180));
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

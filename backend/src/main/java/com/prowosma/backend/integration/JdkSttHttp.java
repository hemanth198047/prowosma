package com.prowosma.backend.integration;

import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;

/**
 * java.net.http transport for the speech-to-text server an ADMIN configured. The address must be https, carry no credentials, and — unless the
 * server is explicitly allowed to use private addresses — resolve only to public addresses (the same policy as custom AI endpoints). No redirects.
 */
@Component
public class JdkSttHttp implements SttHttp {

    private final HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();

    @Override
    public Result post(String url, Map<String, String> headers, byte[] body, boolean allowPrivateHosts) throws IOException {
        URI uri = OutboundUrlPolicy.parseHttps(url, "Speech-to-text address");
        if (!allowPrivateHosts) OutboundUrlPolicy.requirePublicAddress(uri, OutboundUrlPolicy.SYSTEM_RESOLVER, "Speech-to-text address");
        HttpRequest.Builder b = HttpRequest.newBuilder(uri).timeout(Duration.ofMinutes(5));      // CPU-only Whisper can take a while on a long piece
        if (headers != null) headers.forEach(b::header);
        b.POST(HttpRequest.BodyPublishers.ofByteArray(body));
        try {
            HttpResponse<String> r = client.send(b.build(), HttpResponse.BodyHandlers.ofString());
            return new Result(r.statusCode(), r.body());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("Interrupted");
        }
    }
}

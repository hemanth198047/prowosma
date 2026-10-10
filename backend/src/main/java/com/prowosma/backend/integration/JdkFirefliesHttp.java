package com.prowosma.backend.integration;

import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/** java.net.http transport. The endpoint is a constant, so an API key can only ever be sent to Fireflies; no redirects are followed. */
@Component
public class JdkFirefliesHttp implements FirefliesHttp {

    static final URI ENDPOINT = URI.create("https://api.fireflies.ai/graphql");
    static final int MAX_BODY_CHARS = 15_000_000;

    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NEVER).build();

    @Override
    public Result post(String jsonBody, String apiKey) throws IOException {
        HttpRequest req = HttpRequest.newBuilder(ENDPOINT).timeout(Duration.ofSeconds(60))
                .header("Content-Type", "application/json").header("Accept", "application/json").header("Authorization", "Bearer " + apiKey)
                .POST(HttpRequest.BodyPublishers.ofString(jsonBody)).build();
        try {
            HttpResponse<String> r = client.send(req, HttpResponse.BodyHandlers.ofString());
            if (r.body() != null && r.body().length() > MAX_BODY_CHARS) throw new IOException("Response too large");
            return new Result(r.statusCode(), r.body());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("Interrupted");
        }
    }
}

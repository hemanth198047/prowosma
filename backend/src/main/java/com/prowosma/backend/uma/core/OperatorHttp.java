package com.prowosma.backend.uma.core;

import com.prowosma.backend.integration.LlmHttp;
import com.prowosma.backend.integration.SttHttp;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;

/**
 * Transport for the two addresses an OPERATOR sets in server configuration ({@code app.uma.stt.base-url}, {@code app.uma.llm.base-url}),
 * typically a speech-to-text or model server on the same private network (http://stt:8000). Workspace users can't set these, so
 * plain http and private addresses are allowed here — unlike the shared clients, which keep requiring public https for addresses
 * typed into the app. Never follows redirects; no credentials in the URL.
 */
@Component
public class OperatorHttp {
    private final HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .followRedirects(HttpClient.Redirect.NEVER)
            .version(HttpClient.Version.HTTP_1_1)      // no "h2c" upgrade on plain-http POSTs; self-hosted servers often mishandle it
            .build();

    static URI check(String raw) {
        try {
            URI u = new URI(raw == null ? "" : raw.trim());
            String s = u.getScheme() == null ? "" : u.getScheme().toLowerCase(java.util.Locale.ROOT);
            if (!s.equals("http") && !s.equals("https")) throw new IllegalArgumentException("The server address must start with http:// or https://");
            if (u.getRawUserInfo() != null) throw new IllegalArgumentException("The server address must not contain a user name or password");
            if (u.getHost() == null || u.getHost().isBlank()) throw new IllegalArgumentException("The server address has no host");
            return u;
        } catch (URISyntaxException e) {
            throw new IllegalArgumentException("The server address isn't a valid URL");
        }
    }

    private record Raw(int status, String body) {}

    private Raw exchange(String method, String url, Map<String, String> headers, HttpRequest.BodyPublisher body, Duration timeout) throws IOException {
        HttpRequest.Builder b = HttpRequest.newBuilder(check(url)).timeout(timeout);
        if (headers != null) headers.forEach(b::header);
        b.method(method, body);
        try {
            HttpResponse<String> r = client.send(b.build(), HttpResponse.BodyHandlers.ofString());
            return new Raw(r.statusCode(), r.body());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("Interrupted");
        }
    }

    /** For the speech-to-text client. CPU-only Whisper can take minutes on a 10-minute piece. */
    public SttHttp stt() {
        return (url, headers, body, allowPrivate) -> {
            Raw r = exchange("POST", url, headers, HttpRequest.BodyPublishers.ofByteArray(body), Duration.ofMinutes(15));
            return new SttHttp.Result(r.status(), r.body());
        };
    }

    /** For the self-hosted language model. A small CPU model can need several minutes for a long answer. */
    public LlmHttp llm() {
        return (method, url, headers, body, allowPrivate) -> {
            Raw r = exchange(method, url, headers,
                    body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body), Duration.ofMinutes(15));
            return new LlmHttp.Result(r.status(), r.body());
        };
    }
}

package com.prowosma.backend.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.*;

/**
 * Speaks the "OpenAI transcriptions" API — POST {base}/v1/audio/transcriptions with a multipart file — which OpenAI, Groq, and the free self-hosted
 * Whisper servers (faster-whisper based: speaches, ScribeCrate, and others) all understand. So the same code serves a paid cloud key or a $0 server
 * running on the client's own VPS.
 */
@Component
public class OpenAiCompatibleSttClient implements SpeechToTextClient {

    private final SttHttp http;
    private final ObjectMapper om = new ObjectMapper();

    @Value("${app.integrations.allow-private-hosts:false}")
    private boolean allowPrivateHosts;

    public OpenAiCompatibleSttClient(SttHttp http) { this.http = http; }

    public void setAllowPrivateHosts(boolean allow) { this.allowPrivateHosts = allow; }

    /** "https://stt.example.com", ".../", and ".../v1" all end up at the same endpoint. */
    static String endpoint(String baseUrl) {
        String b = baseUrl == null ? "" : baseUrl.trim();
        while (b.endsWith("/")) b = b.substring(0, b.length() - 1);
        if (!b.endsWith("/v1")) b = b + "/v1";
        return b + "/audio/transcriptions";
    }

    @Override
    public Result transcribe(Settings s, byte[] audio, String mimeType, String fileName) {
        if (s == null || s.baseUrl() == null || s.baseUrl().isBlank())
            throw new SttException(SttException.Kind.NOT_FOUND, "No speech-to-text server address is set.");
        String url = endpoint(s.baseUrl());
        String model = s.model() == null || s.model().isBlank() ? "whisper-1" : s.model().trim();
        try {
            SttHttp.Result r = send(url, s, audio, mimeType, fileName, model, "verbose_json");
            if ((r.status() == 400 || r.status() == 422) && r.body() != null && r.body().toLowerCase(Locale.ROOT).contains("response_format"))
                r = send(url, s, audio, mimeType, fileName, model, "json");        // some servers/models only do plain json
            return handle(r);
        } catch (IllegalArgumentException blocked) {
            throw new SttException(SttException.Kind.BAD_INPUT, blocked.getMessage() + ". Use the public https address of your speech-to-text server.");
        } catch (IOException e) {
            throw new SttException(SttException.Kind.TRANSIENT, "Couldn't reach the speech-to-text server.");
        }
    }

    private SttHttp.Result send(String url, Settings s, byte[] audio, String mime, String fileName, String model, String format) throws IOException {
        String boundary = "----prowosma" + UUID.randomUUID().toString().replace("-", "");
        ByteArrayOutputStream out = new ByteArrayOutputStream(audio.length + 1024);
        field(out, boundary, "model", model);
        field(out, boundary, "response_format", format);
        if (s.language() != null && !s.language().isBlank()) field(out, boundary, "language", s.language().trim());
        out.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"" + safeName(fileName) + "\"\r\nContent-Type: "
                + (mime == null || mime.isBlank() ? "application/octet-stream" : mime) + "\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        out.write(audio);
        out.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Content-Type", "multipart/form-data; boundary=" + boundary);
        headers.put("Accept", "application/json");
        if (s.apiKey() != null && !s.apiKey().isBlank()) headers.put("Authorization", "Bearer " + s.apiKey().trim());
        return http.post(url, headers, out.toByteArray(), allowPrivateHosts);
    }

    private static void field(ByteArrayOutputStream out, String boundary, String name, String value) throws IOException {
        out.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + name + "\"\r\n\r\n" + value + "\r\n").getBytes(StandardCharsets.UTF_8));
    }

    private static String safeName(String n) {
        String s = n == null ? "audio.webm" : n.replaceAll("[^A-Za-z0-9._-]", "_");
        return s.isBlank() ? "audio.webm" : s;
    }

    /** Statuses become plain reasons; the server's own text is never copied into messages. */
    private Result handle(SttHttp.Result r) {
        int st = r.status();
        if (st >= 200 && st < 300) return parse(r.body());
        if (st == 401 || st == 403) throw new SttException(SttException.Kind.AUTH, "The speech-to-text server rejected the API key.");
        if (st == 404) throw new SttException(SttException.Kind.NOT_FOUND, "The speech-to-text server doesn't have that address or model. Check the address and the model name.");
        if (st == 408 || st == 429 || st >= 500) throw new SttException(SttException.Kind.TRANSIENT, "The speech-to-text server is busy or unavailable right now.");
        throw new SttException(SttException.Kind.BAD_INPUT, "The speech-to-text server couldn't process this audio (it replied " + st + ").");
    }

    private Result parse(String body) {
        try {
            JsonNode n = om.readTree(body == null || body.isBlank() ? "{}" : body);
            List<Segment> out = new ArrayList<>();
            for (JsonNode s : n.path("segments")) {
                String text = s.path("text").asText("").strip();
                if (text.isEmpty()) continue;
                Double nsp = s.has("no_speech_prob") && s.get("no_speech_prob").isNumber() ? s.get("no_speech_prob").asDouble() : null;
                out.add(new Segment(Math.round(s.path("start").asDouble(0) * 1000), Math.round(s.path("end").asDouble(0) * 1000), text, nsp));
            }
            if (out.isEmpty()) {                                                         // plain-json models: one block of text, no timing
                String text = n.path("text").asText("").strip();
                if (!text.isEmpty()) out.add(new Segment(0, 0, text, null));
            }
            String lang = n.path("language").asText(null);
            return new Result(lang, out);
        } catch (IOException e) {
            throw new SttException(SttException.Kind.BAD_RESPONSE, "The speech-to-text server's reply couldn't be read.");
        }
    }

    /** A valid one-second silent recording (16 kHz mono WAV) used by "Test connection". */
    public static byte[] silentWav() {
        int rate = 16000, samples = rate;
        ByteArrayOutputStream o = new ByteArrayOutputStream(44 + samples * 2);
        try {
            o.write("RIFF".getBytes(StandardCharsets.US_ASCII)); le32(o, 36 + samples * 2); o.write("WAVEfmt ".getBytes(StandardCharsets.US_ASCII));
            le32(o, 16); le16(o, 1); le16(o, 1); le32(o, rate); le32(o, rate * 2); le16(o, 2); le16(o, 16);
            o.write("data".getBytes(StandardCharsets.US_ASCII)); le32(o, samples * 2); o.write(new byte[samples * 2]);
        } catch (IOException impossible) { throw new IllegalStateException(impossible); }
        return o.toByteArray();
    }

    private static void le32(ByteArrayOutputStream o, int v) { o.write(v); o.write(v >> 8); o.write(v >> 16); o.write(v >> 24); }
    private static void le16(ByteArrayOutputStream o, int v) { o.write(v); o.write(v >> 8); }
}

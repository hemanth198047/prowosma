package com.prowosma.backend.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.meetingassistant.FirefliesMapper;
import com.prowosma.backend.meetingassistant.FirefliesMatcher.Summary;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.regex.Pattern;

/**
 * Fireflies.ai's GraphQL API: check the key, send the notetaker to a running meeting, list recent transcripts, read one transcript.
 * Every failure becomes a {@link FirefliesException} with a fixed plain-language message — the service's own wording, the key and any
 * transcript content never reach a message.
 */
@Component
public class FirefliesApi {

    public record Account(String name, String email) {}

    public record Transcript(String id, String title, String meetingLink, Instant date, boolean live, Double durationMinutes, List<FirefliesMapper.Sentence> sentences) {}

    static final Duration DEFAULT_RETRY = Duration.ofMinutes(5);
    private static final Pattern ID = Pattern.compile("^[A-Za-z0-9_-]{6,80}$");

    private static final String Q_USER = "query { user { name email } }";
    private static final String Q_ADD = "mutation AddToLiveMeeting($meetingLink: String!) { addToLiveMeeting(meeting_link: $meetingLink) { success } }";
    private static final String Q_ADD_TITLED = "mutation AddToLiveMeeting($meetingLink: String!, $title: String) { addToLiveMeeting(meeting_link: $meetingLink, title: $title) { success } }";
    private static final String Q_RECENT = "query Recent($limit: Int) { transcripts(limit: $limit) { id title dateString date duration meeting_link is_live } }";
    private static final String Q_ONE = "query Transcript($id: String!) { transcript(id: $id) { id title dateString date duration meeting_link is_live sentences { speaker_name text start_time end_time } } }";

    private final FirefliesHttp http;
    private final ObjectMapper om = new ObjectMapper();

    public FirefliesApi(FirefliesHttp http) { this.http = http; }

    // ── operations ───────────────────────────────────────────────────────────

    public Account account(String apiKey) {
        JsonNode u = call(apiKey, Q_USER, Map.of()).path("user");
        if (u.isMissingNode() || u.isNull()) throw new FirefliesException(FirefliesException.Kind.BAD_RESPONSE, "Fireflies' reply couldn't be read.");
        return new Account(text(u, "name"), text(u, "email"));
    }

    public void addToLiveMeeting(String apiKey, String meetingLink, String title) {
        Map<String, Object> vars = new LinkedHashMap<>();
        vars.put("meetingLink", meetingLink);
        boolean titled = title != null && !title.isBlank();
        if (titled) vars.put("title", title.trim().length() > 200 ? title.trim().substring(0, 200) : title.trim());
        JsonNode ok = call(apiKey, titled ? Q_ADD_TITLED : Q_ADD, vars).path("addToLiveMeeting").path("success");
        if (!ok.asBoolean(false)) throw new FirefliesException(FirefliesException.Kind.BAD_REQUEST, "Fireflies didn't accept this meeting. It has to be running right now for the notetaker to join.");
    }

    public List<Summary> recent(String apiKey, int limit) {
        JsonNode arr = call(apiKey, Q_RECENT, Map.of("limit", Math.max(1, Math.min(50, limit)))).path("transcripts");
        List<Summary> out = new ArrayList<>();
        if (arr.isArray()) {
            for (JsonNode t : arr) {
                String id = text(t, "id");
                if (id == null) continue;
                out.add(new Summary(id, text(t, "title"), text(t, "meeting_link"), date(t), t.path("is_live").asBoolean(false)));
            }
        }
        return out;
    }

    /** Empty while Fireflies is still processing the meeting (it answers with no transcript yet). */
    public Optional<Transcript> transcript(String apiKey, String id) {
        if (id == null || !ID.matcher(id).matches()) throw new FirefliesException(FirefliesException.Kind.BAD_REQUEST, "That isn't a valid Fireflies transcript id.");
        JsonNode t = call(apiKey, Q_ONE, Map.of("id", id)).path("transcript");
        if (t.isMissingNode() || t.isNull()) return Optional.empty();
        List<FirefliesMapper.Sentence> sentences = new ArrayList<>();
        for (JsonNode s : t.path("sentences")) {
            sentences.add(new FirefliesMapper.Sentence(text(s, "speaker_name"), text(s, "text"),
                    s.path("start_time").isNumber() ? s.get("start_time").asDouble() : null, s.path("end_time").isNumber() ? s.get("end_time").asDouble() : null));
        }
        Double duration = t.path("duration").isNumber() ? t.get("duration").asDouble() : null;
        return Optional.of(new Transcript(text(t, "id"), text(t, "title"), text(t, "meeting_link"), date(t), t.path("is_live").asBoolean(false), duration, sentences));
    }

    // ── plumbing ─────────────────────────────────────────────────────────────

    private JsonNode call(String apiKey, String query, Map<String, Object> variables) {
        if (apiKey == null || apiKey.isBlank()) throw new FirefliesException(FirefliesException.Kind.AUTH, "No Fireflies API key is saved.");
        String body;
        try {
            Map<String, Object> req = new LinkedHashMap<>();
            req.put("query", query);
            req.put("variables", variables);
            body = om.writeValueAsString(req);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
        FirefliesHttp.Result r;
        try {
            r = http.post(body, apiKey.trim());
        } catch (IOException e) {
            throw new FirefliesException(FirefliesException.Kind.TRANSIENT, "Couldn't reach Fireflies.");
        }
        JsonNode root = null;
        try { if (r.body() != null && !r.body().isBlank()) root = om.readTree(r.body()); } catch (IOException ignored) { /* handled by status below */ }

        JsonNode errors = root == null ? null : root.path("errors");
        if (errors != null && errors.isArray() && errors.size() > 0) throw fromGraphQlError(errors.get(0));
        int st = r.status();
        if (st == 401) throw new FirefliesException(FirefliesException.Kind.AUTH, "Fireflies rejected the API key.");
        if (st == 403) throw new FirefliesException(FirefliesException.Kind.PLAN, "Fireflies didn't allow this. Check the plan and that the account is active.");
        if (st == 429) throw new FirefliesException(FirefliesException.Kind.RATE_LIMITED, "Fireflies' request limit was reached.", Instant.now().plus(DEFAULT_RETRY));
        if (st >= 500 || st == 408) throw new FirefliesException(FirefliesException.Kind.TRANSIENT, "Fireflies is unavailable right now.");
        if (st < 200 || st >= 300 || root == null || !root.has("data") || root.get("data").isNull())
            throw new FirefliesException(FirefliesException.Kind.BAD_RESPONSE, "Fireflies' reply couldn't be read.");
        return root.get("data");
    }

    private FirefliesException fromGraphQlError(JsonNode e) {
        String code = text(e, "code");
        if (code == null) code = text(e.path("extensions"), "code");
        code = code == null ? "" : code;
        return switch (code) {
            case "auth_failed" -> new FirefliesException(FirefliesException.Kind.AUTH, "Fireflies rejected the API key.");
            case "paid_required", "account_cancelled", "forbidden", "require_elevated_privilege", "not_in_team" ->
                    new FirefliesException(FirefliesException.Kind.PLAN, "Fireflies didn't allow this. Check the plan, the account, and that the key belongs to the right person.");
            case "too_many_requests" -> new FirefliesException(FirefliesException.Kind.RATE_LIMITED, "Fireflies' request limit was reached.", retryAfter(e));
            case "unsupported_platform" -> new FirefliesException(FirefliesException.Kind.UNSUPPORTED_PLATFORM, "Fireflies can't join that kind of meeting.");
            case "object_not_found" -> new FirefliesException(FirefliesException.Kind.NOT_FOUND, "Fireflies couldn't find that, or this account has no access to it.");
            case "invalid_arguments", "args_required", "invalid_language_code", "bad_request" ->
                    new FirefliesException(FirefliesException.Kind.BAD_REQUEST, "Fireflies didn't accept the request. If you were sending the notetaker, the meeting has to be running right now.");
            case "request_timeout" -> new FirefliesException(FirefliesException.Kind.TRANSIENT, "Fireflies took too long to answer.");
            default -> new FirefliesException(FirefliesException.Kind.BAD_RESPONSE, "Fireflies returned an error this version doesn't understand.");
        };
    }

    /** Fireflies says when to resume; the value may be epoch milliseconds or an ISO time. Anything unreadable, past or absurdly far away falls back to five minutes. */
    static Instant retryAfter(JsonNode error) {
        Instant fallback = Instant.now().plus(DEFAULT_RETRY);
        JsonNode meta = error.path("extensions").path("metadata");
        JsonNode v = meta.path("retryAfter");
        if (v.isMissingNode() || v.isNull()) v = error.path("extensions").path("retryAfter");
        Instant at = null;
        try {
            if (v.isNumber()) at = v.asLong() > 100_000_000_000L ? Instant.ofEpochMilli(v.asLong()) : Instant.ofEpochSecond(v.asLong());
            else if (v.isTextual()) at = v.asText().chars().allMatch(Character::isDigit) ? Instant.ofEpochMilli(Long.parseLong(v.asText())) : Instant.parse(v.asText());
        } catch (RuntimeException ignored) { at = null; }
        Instant now = Instant.now();
        if (at == null || at.isBefore(now) || at.isAfter(now.plus(Duration.ofHours(26)))) return fallback;
        return at;
    }

    private static String text(JsonNode n, String field) {
        JsonNode v = n.path(field);
        return v.isMissingNode() || v.isNull() ? null : v.asText();
    }

    private static Instant date(JsonNode t) {
        String iso = text(t, "dateString");
        if (iso != null) { try { return Instant.parse(iso); } catch (RuntimeException ignored) { /* try the number */ } }
        JsonNode d = t.path("date");
        if (d.isNumber() && d.asLong() > 0) return d.asLong() > 100_000_000_000L ? Instant.ofEpochMilli(d.asLong()) : Instant.ofEpochSecond(d.asLong());
        return null;
    }
}

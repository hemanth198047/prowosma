package com.prowosma.backend.integration;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Reads Datadog, Sentry and Jenkins webhook payloads into {@link InboundEvent}s.
 *
 * <ul>
 *   <li><b>Datadog</b> lets you write the webhook payload yourself, so this accepts the field
 *       names Datadog's own variables produce ({@code $ALERT_TITLE}, {@code $ALERT_ID},
 *       {@code $ALERT_TRANSITION}, {@code $PRIORITY}, {@code $LINK}, {@code $TAGS}...) under
 *       either their lower-case names or common aliases. See docs/INBOUND_EVENTS.md for the
 *       recommended template.</li>
 *   <li><b>Sentry</b> sends four shapes: issue webhooks, issue-alert events, metric alerts and
 *       the legacy project webhook.</li>
 *   <li><b>Jenkins</b> is the Notification plugin's JSON format.</li>
 * </ul>
 * Payloads with nothing to act on throw {@link IllegalArgumentException}; recognised events
 * that are deliberately not acted on (a build that has only started) come back as
 * {@link InboundEvent.Action#IGNORE}.
 */
public final class InboundEventParser {

    static final int MAX_DESCRIPTION = 4000;
    static final int MAX_TITLE = 200;

    private InboundEventParser() {}

    public static InboundEvent parse(InboundSource source, Map<String, Object> payload, Map<String, String> headers) {
        if (payload == null || payload.isEmpty()) throw new IllegalArgumentException("Empty payload");
        Map<String, String> h = headers == null ? Map.of() : headers;
        switch (source) {
            case DATADOG: return datadog(payload);
            case SENTRY:  return sentry(payload, h);
            case JENKINS: return jenkins(payload);
            default:      throw new IllegalArgumentException("Unsupported source");
        }
    }

    // ── Datadog ──────────────────────────────────────────────────────────────

    private static InboundEvent datadog(Map<String, Object> p) {
        String title = firstString(p, "title", "event_title", "alert_title", "name");
        if (title == null) throw new IllegalArgumentException("Datadog payload has no title");
        String base = stripLeadingBrackets(title);
        if (base.isEmpty()) base = title;

        // A stable id is the monitor (alert_id / monitor_id / aggreg_key). $ID is the *event* id
        // and changes on every notification, so it is deliberately not used: it would open a new
        // task for every repeat of the same alert. Without a monitor id the title identifies it.
        String id = firstString(p, "alert_id", "monitor_id", "aggreg_key");
        if (id == null) id = "t-" + shortHash(base.toLowerCase(Locale.ROOT));

        String alertType = lower(firstString(p, "alert_type"));
        boolean recovered;
        String transition = lower(firstString(p, "alert_transition", "transition"));
        if (transition != null)      recovered = containsAny(transition, "recover", "resolved") || transition.equals("ok");
        else if (alertType != null)  recovered = alertType.equals("success");
        else                         recovered = containsAny(lower(firstString(p, "alert_status", "status", "event_type")), "recovered", "resolved");

        String priority = "MEDIUM", severity = "MEDIUM";
        String p1 = firstString(p, "priority", "alert_priority");
        String digits = p1 == null ? "" : p1.replaceAll("[^0-9]", "");
        if (!digits.isEmpty()) {
            switch (digits.charAt(0)) {
                case '1': priority = "HIGH";   severity = "CRITICAL"; break;
                case '2': priority = "HIGH";   severity = "HIGH";     break;
                case '3': break;
                default:  priority = "LOW";    severity = "LOW";      break;
            }
        } else if ("low".equals(lower(p1))) {
            priority = "LOW"; severity = "LOW";
        } else if ("error".equals(alertType)) {
            priority = "HIGH"; severity = "HIGH";
        }

        List<String> tags = new ArrayList<>(List.of("datadog", "incident"));
        addTags(tags, p.get("tags"), 5);

        return new InboundEvent(InboundSource.DATADOG, id,
                recovered ? InboundEvent.Action.RESOLVE : InboundEvent.Action.OPEN,
                clip(title, MAX_TITLE),
                describe(firstString(p, "body", "event_msg", "text", "message", "description"),
                        firstString(p, "link", "url", "event_url", "alert_url")),
                priority, severity, "TASK", tags);
    }

    // ── Sentry ───────────────────────────────────────────────────────────────

    @SuppressWarnings("unchecked")
    private static InboundEvent sentry(Map<String, Object> p, Map<String, String> headers) {
        Map<String, Object> data = map(p.get("data"));
        Map<String, Object> issue = map(data.get("issue"));
        Map<String, Object> event = map(data.get("event"));
        Map<String, Object> metric = map(data.get("metric_alert"));
        String action = lower(str(p.get("action")));
        String resource = lower(headers.get("sentry-hook-resource"));

        String id, title, url, level, extra = null, project = null;
        InboundEvent.Action act;

        if (!metric.isEmpty() || "metric_alert".equals(resource)) {
            String rid = idString(metric.get("id"));
            title = firstString(metric, "title");
            if (title == null) title = firstString(map(metric.get("alert_rule")), "name");
            if (title == null || rid == null) throw new IllegalArgumentException("Sentry metric alert has no title or id");
            id = "metric-" + rid;
            url = firstString(data, "web_url");
            if (url == null) url = firstString(metric, "web_url");
            level = "warning".equals(action) ? "warning" : "critical".equals(action) ? "fatal" : "error";
            act = "resolved".equals(action) ? InboundEvent.Action.RESOLVE : InboundEvent.Action.OPEN;
        } else if (!issue.isEmpty()) {
            id = idString(issue.get("id"));
            title = firstString(issue, "title");
            if (id == null || title == null) throw new IllegalArgumentException("Sentry issue has no id or title");
            url = firstString(issue, "web_url", "permalink");
            level = lower(firstString(issue, "level"));
            extra = firstString(issue, "culprit");
            project = firstString(map(issue.get("project")), "slug");
            act = switch (action == null ? "" : action) {
                case "created", "unresolved" -> InboundEvent.Action.OPEN;
                case "resolved"              -> InboundEvent.Action.RESOLVE;
                default                      -> InboundEvent.Action.IGNORE;     // assigned, archived, ignored...
            };
        } else if (!event.isEmpty()) {
            id = idString(event.get("issue_id"));
            if (id == null) id = idString(event.get("event_id"));
            title = firstString(event, "title", "message");
            if (id == null || title == null) throw new IllegalArgumentException("Sentry event has no id or title");
            url = firstString(event, "web_url", "issue_url", "url");
            level = lower(firstString(event, "level"));
            extra = firstString(event, "culprit");
            act = InboundEvent.Action.OPEN;
            Object rule = data.get("triggered_rule");
            if (rule instanceof String r && !r.isBlank()) extra = (extra == null ? "" : extra + "\n") + "Alert rule: " + r;
        } else {
            // legacy project webhook: flat payload
            Map<String, Object> legacyEvent = map(p.get("event"));
            id = idString(p.get("id"));
            if (id == null) id = idString(legacyEvent.get("event_id"));
            title = firstString(legacyEvent, "title");
            if (title == null) title = firstString(p, "message");
            if (id == null || title == null) throw new IllegalArgumentException("Unrecognised Sentry payload");
            url = firstString(p, "url");
            level = lower(firstString(p, "level"));
            extra = firstString(p, "culprit");
            project = firstString(p, "project");
            act = InboundEvent.Action.OPEN;
        }

        String priority = "MEDIUM", severity = "MEDIUM";
        if (level != null) {
            switch (level) {
                case "fatal":   priority = "HIGH"; severity = "CRITICAL"; break;
                case "error":   priority = "HIGH"; severity = "HIGH";     break;
                case "info": case "debug": case "sample": priority = "LOW"; severity = "LOW"; break;
                default: break;
            }
        }
        List<String> tags = new ArrayList<>(List.of("sentry", "error"));
        if (project != null) addTags(tags, List.of(project), 1);
        return new InboundEvent(InboundSource.SENTRY, id, act, clip(title, MAX_TITLE),
                describe(extra, url), priority, severity, "BUG", tags);
    }

    // ── Jenkins ──────────────────────────────────────────────────────────────

    private static InboundEvent jenkins(Map<String, Object> p) {
        String name = str(p.get("name"));
        if (name == null || name.isBlank()) throw new IllegalArgumentException("Jenkins payload has no job name");
        Map<String, Object> build = map(p.get("build"));
        String phase = upper(str(build.get("phase")));
        String status = upper(str(build.get("status")));
        String job = name.trim();
        String id = sanitizeId(job);
        List<String> tags = new ArrayList<>(List.of("jenkins", "ci"));

        InboundEvent.Action act = InboundEvent.Action.IGNORE;
        String priority = "MEDIUM", severity = "MEDIUM", title = "Build " + (status == null ? "update" : status.toLowerCase(Locale.ROOT)) + ": " + job;
        boolean finished = "COMPLETED".equals(phase) || "FINALIZED".equals(phase);
        if (finished && status != null) {
            switch (status) {
                case "FAILURE":
                    act = InboundEvent.Action.OPEN; priority = "HIGH"; severity = "HIGH"; title = "Build failing: " + job; break;
                case "UNSTABLE":
                    act = InboundEvent.Action.OPEN; title = "Build unstable: " + job; break;
                case "SUCCESS":
                    act = InboundEvent.Action.RESOLVE; title = "Build fixed: " + job; break;
                default:
                    break;                                             // ABORTED, NOT_BUILT
            }
        }

        StringBuilder text = new StringBuilder();
        Object number = build.get("number");
        text.append("Build ").append(number instanceof Number n ? "#" + n.longValue() + " " : "").append("of ").append(job)
            .append(" finished with status ").append(status == null ? "unknown" : status).append('.');
        Map<String, Object> scm = map(build.get("scm"));
        String branch = firstString(scm, "branch"), commit = firstString(scm, "commit");
        if (branch != null) text.append("\nBranch: ").append(branch);
        if (commit != null) text.append("\nCommit: ").append(commit);
        return new InboundEvent(InboundSource.JENKINS, id, act, clip(title, MAX_TITLE),
                describe(text.toString(), firstString(build, "full_url")), priority, severity, "BUG", tags);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    /** Datadog wraps titles in status brackets that change per transition: "[Triggered on {host:a}] CPU high". */
    static String stripLeadingBrackets(String title) {
        String t = title.trim();
        while (t.startsWith("[")) {
            int end = t.indexOf(']');
            if (end < 0) break;
            t = t.substring(end + 1).trim();
        }
        return t;
    }

    private static String describe(String text, String url) {
        StringBuilder sb = new StringBuilder();
        if (text != null && !text.isBlank()) sb.append(text.trim());
        if (url != null && !url.isBlank()) {
            if (sb.length() > 0) sb.append("\n\n");
            sb.append(url.trim());
        }
        return clip(sb.toString(), MAX_DESCRIPTION);
    }

    private static void addTags(List<String> tags, Object raw, int max) {
        List<String> candidates = new ArrayList<>();
        if (raw instanceof String s) for (String part : s.split(",")) candidates.add(part);
        else if (raw instanceof List<?> l) for (Object o : l) if (o instanceof String s) candidates.add(s);
        int added = 0;
        for (String c : candidates) {
            if (added >= max) break;
            String t = c.trim().toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9:_./-]", "-");
            if (t.isEmpty() || t.startsWith("@") || t.length() > 40 || tags.contains(t)) continue;
            tags.add(t);
            added++;
        }
    }

    static String sanitizeId(String s) {
        String t = s.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9._-]", "_");
        return t.length() <= 120 ? t : t.substring(0, 120);
    }

    private static String shortHash(String s) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8))).substring(0, 16);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String clip(String s, int max) {
        String t = s == null ? "" : s.trim();
        return t.length() <= max ? t : t.substring(0, max - 1) + "\u2026";
    }

    private static String firstString(Map<String, Object> m, String... keys) {
        for (String k : keys) {
            Object v = m.get(k);
            if (v instanceof String s && !s.isBlank()) return s.trim();
            if (v instanceof Number n) return String.valueOf(n.longValue());
        }
        return null;
    }

    private static String idString(Object o) {
        if (o instanceof String s && !s.isBlank()) return s.trim();
        if (o instanceof Number n) return String.valueOf(n.longValue());
        return null;
    }

    private static String str(Object o) { return o instanceof String s ? s : null; }
    private static String lower(String s) { return s == null ? null : s.trim().toLowerCase(Locale.ROOT); }
    private static String upper(String s) { return s == null ? null : s.trim().toUpperCase(Locale.ROOT); }

    private static boolean containsAny(String s, String... needles) {
        if (s == null) return false;
        for (String n : needles) if (s.contains(n)) return true;
        return false;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> map(Object o) {
        return o instanceof Map<?, ?> m ? (Map<String, Object>) m : new LinkedHashMap<>();
    }
}

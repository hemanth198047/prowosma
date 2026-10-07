package com.prowosma.backend.meetingassistant;

import java.util.*;

/**
 * Turns whatever the model returned into a clean, validated structure. The contract this enforces:
 *  - every statement keeps ONLY evidence line numbers that really exist in the transcript range;
 *  - a statement with no valid evidence is REMOVED (and counted), never kept "just in case";
 *  - unknown commitment kinds default to UNRESOLVED — never promoted to a commitment;
 *  - wrong types, junk entries and control characters are discarded.
 * Works on plain Maps/Lists (as produced by a JSON parser) so it has no framework dependency.
 */
public final class OutputSanitizer {

    private OutputSanitizer() {}

    public static final int MAX_TEXT = 4000;
    private static final List<String> ITEM_LISTS = List.of("agendaProvided", "inferredTopics", "outcomes", "risks", "blockers",
            "dependencies", "openQuestions", "nextSteps", "withdrawn");
    private static final Set<String> KINDS = Set.of("COMMITMENT", "SUGGESTION", "UNRESOLVED");

    public record Result(Map<String, Object> data, List<String> warnings, int dropped) {}

    public static Map<String, Object> empty() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("purpose", null);
        for (String k : ITEM_LISTS) m.put(k, new ArrayList<>());
        m.put("topics", new ArrayList<>());
        m.put("decisions", new ArrayList<>());
        m.put("actionItems", new ArrayList<>());
        m.put("followUpMeeting", null);
        m.put("participantsMentioned", new ArrayList<>());
        return m;
    }

    /** @param minSeq/maxSeq the transcript line numbers this analysis is allowed to cite */
    public static Result sanitize(Map<String, Object> raw, int minSeq, int maxSeq) {
        Counter c = new Counter();
        Map<String, Object> out = empty();
        if (raw == null) return new Result(out, List.of(), 0);

        out.put("purpose", item(raw.get("purpose"), minSeq, maxSeq, c, null));
        for (String k : ITEM_LISTS) out.put(k, items(raw.get(k), minSeq, maxSeq, c));
        out.put("followUpMeeting", item(raw.get("followUpMeeting"), minSeq, maxSeq, c, null));

        List<Object> topics = new ArrayList<>();
        for (Object o : list(raw.get("topics"))) {
            if (!(o instanceof Map<?, ?> t)) { c.dropped++; continue; }
            String title = text(t.get("title"), c);
            List<Object> points = items(t.get("points"), minSeq, maxSeq, c);
            if (title == null || points.isEmpty()) { if (title != null || !points.isEmpty()) c.dropped++; continue; }
            Map<String, Object> topic = new LinkedHashMap<>();
            topic.put("title", title);
            topic.put("points", points);
            topics.add(topic);
        }
        out.put("topics", topics);

        out.put("decisions", items(raw.get("decisions"), minSeq, maxSeq, c, "madeBy"));
        List<Object> actions = new ArrayList<>();
        for (Object o : list(raw.get("actionItems"))) {
            Map<String, Object> a = item(o, minSeq, maxSeq, c, null);
            if (a == null) continue;
            Map<?, ?> src = (Map<?, ?>) o;
            a.put("owner", shortText(src.get("owner")));
            a.put("deadline", shortText(src.get("deadline")));
            String kind = String.valueOf(src.get("kind")).trim().toUpperCase(Locale.ROOT);
            a.put("kind", KINDS.contains(kind) ? kind : "UNRESOLVED");
            actions.add(a);
        }
        out.put("actionItems", actions);

        List<Object> names = new ArrayList<>();
        for (Object o : list(raw.get("participantsMentioned"))) {
            String n = shortText(o);
            if (n != null && !names.contains(n)) names.add(n);
        }
        out.put("participantsMentioned", names);

        List<String> warnings = new ArrayList<>();
        if (c.dropped > 0) warnings.add(c.dropped + " statement(s) were removed because they didn't point to lines of the transcript.");
        if (c.truncated > 0) warnings.add(c.truncated + " very long statement(s) were shortened.");
        return new Result(out, warnings, c.dropped);
    }

    /**
     * Joins analyses of consecutive parts WITHOUT an AI call — the safe fallback when merging by the model fails.
     * Nothing is lost; duplicates across parts may remain.
     */
    public static Map<String, Object> concat(List<Map<String, Object>> parts) {
        Map<String, Object> out = empty();
        for (Map<String, Object> p : parts) {
            if (out.get("purpose") == null) out.put("purpose", p.get("purpose"));
            if (out.get("followUpMeeting") == null) out.put("followUpMeeting", p.get("followUpMeeting"));
            for (String k : new ArrayList<>(ITEM_LISTS)) addAll(out, p, k);
            for (String k : List.of("topics", "decisions", "actionItems", "participantsMentioned")) addAll(out, p, k);
        }
        return out;
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static final class Counter { int dropped; int truncated; }

    @SuppressWarnings("unchecked")
    private static void addAll(Map<String, Object> out, Map<String, Object> p, String key) {
        Object v = p.get(key);
        if (v instanceof List<?> l) ((List<Object>) out.get(key)).addAll(l);
    }

    private static List<?> list(Object o) { return o instanceof List<?> l ? l : List.of(); }

    private static List<Object> items(Object o, int min, int max, Counter c) { return items(o, min, max, c, null); }

    private static List<Object> items(Object o, int min, int max, Counter c, String extraShortField) {
        List<Object> out = new ArrayList<>();
        for (Object x : list(o)) {
            Map<String, Object> it = item(x, min, max, c, extraShortField);
            if (it != null) out.add(it);
        }
        return out;
    }

    /** One {text, evidence[, extra]} statement, or null (counted as dropped) if it has no text or no valid evidence. */
    private static Map<String, Object> item(Object o, int min, int max, Counter c, String extraShortField) {
        if (o == null) return null;
        if (!(o instanceof Map<?, ?> m)) { c.dropped++; return null; }
        String t = text(m.get("text"), c);
        List<Integer> ev = evidence(m.get("evidence"), min, max);
        if (t == null || ev.isEmpty()) { c.dropped++; return null; }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("text", t);
        out.put("evidence", ev);
        if (extraShortField != null) out.put(extraShortField, shortText(m.get(extraShortField)));
        return out;
    }

    private static List<Integer> evidence(Object o, int min, int max) {
        TreeSet<Integer> set = new TreeSet<>();
        for (Object x : list(o)) {
            Integer n = null;
            if (x instanceof Number num && num.doubleValue() == Math.rint(num.doubleValue())) n = num.intValue();
            else if (x instanceof String s && s.trim().matches("\\d{1,9}")) n = Integer.parseInt(s.trim());
            if (n != null && n >= min && n <= max) set.add(n);
        }
        return new ArrayList<>(set);
    }

    private static String text(Object o, Counter c) {
        if (!(o instanceof String s)) return null;
        String t = s.replaceAll("[\\p{Cntrl}&&[^\n\t]]", "").strip();
        if (t.isEmpty()) return null;
        if (t.length() > MAX_TEXT) { t = t.substring(0, MAX_TEXT).strip() + "…"; c.truncated++; }
        return t;
    }

    private static String shortText(Object o) {
        if (!(o instanceof String s)) return null;
        String t = s.replaceAll("[\\p{Cntrl}]", " ").strip();
        if (t.isEmpty() || t.equalsIgnoreCase("null")) return null;
        return t.length() > 120 ? t.substring(0, 120).strip() : t;
    }
}

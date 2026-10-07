package com.prowosma.backend.meetingassistant;

import java.util.*;

/**
 * Renders the validated analysis into editable Markdown for the three artifacts. Every statement keeps its evidence
 * markers ("[#12]"), so a reader can jump from any sentence to the transcript lines behind it. Nothing is added here
 * that isn't in the analysis or the meeting record.
 */
public final class MeetingRenderer {

    private MeetingRenderer() {}

    public record Meta(String title, String date, String time, String timezone, String duration, List<String> participants) {}

    private static final String NONE = "_None identified._";

    // ── Summary ──────────────────────────────────────────────────────────────

    public static String summary(Map<String, Object> d, Meta m) {
        StringBuilder s = new StringBuilder();
        s.append("# Summary — ").append(m.title()).append("\n\n");
        s.append("## Purpose\n");
        Map<String, Object> purpose = map(d.get("purpose"));
        s.append(purpose == null ? "_The purpose wasn't stated in the meeting._" : stmt(purpose)).append("\n\n");

        s.append("## Main topics\n");
        List<Map<String, Object>> topics = maps(d.get("topics"));
        if (topics.isEmpty()) s.append(NONE).append('\n');
        for (Map<String, Object> t : topics) {
            TreeSet<Integer> ev = new TreeSet<>();
            for (Map<String, Object> p : maps(t.get("points"))) ev.addAll(ints(p.get("evidence")));
            s.append("- ").append(t.get("title")).append(marker(ev)).append('\n');
        }
        s.append("\n## Outcomes\n").append(bullets(maps(d.get("outcomes"))));
        s.append("\n## Key decisions\n").append(decisions(maps(d.get("decisions"))));
        s.append("\n## Next steps\n").append(bullets(maps(d.get("nextSteps"))));
        return s.toString().stripTrailing() + "\n";
    }

    // ── Minutes of Meeting ───────────────────────────────────────────────────

    public static String mom(Map<String, Object> d, Meta m) {
        StringBuilder s = new StringBuilder();
        s.append("# Minutes of Meeting — ").append(m.title()).append("\n\n");
        s.append("- **Date:** ").append(m.date()).append('\n');
        s.append("- **Time:** ").append(m.time()).append(' ').append(m.timezone()).append('\n');
        s.append("- **Duration:** ").append(m.duration()).append("\n\n");

        s.append("## Participants\n");
        if (m.participants().isEmpty()) s.append("_The transcript doesn't name the speakers._\n");
        else {
            for (String p : m.participants()) s.append("- ").append(p).append('\n');
            s.append("\n_Names are as they appear in the transcript. Attendance was not verified._\n");
        }

        s.append("\n## Agenda\n");
        List<Map<String, Object>> provided = maps(d.get("agendaProvided"));
        List<Map<String, Object>> inferred = maps(d.get("inferredTopics"));
        if (provided.isEmpty() && inferred.isEmpty()) s.append("_No agenda was stated, and no topics could be inferred._\n");
        if (!provided.isEmpty()) s.append("**Stated in the meeting:**\n").append(bullets(provided));
        if (!inferred.isEmpty()) s.append("**Topics inferred from the discussion (no agenda was stated):**\n").append(bullets(inferred));

        s.append("\n## Discussion\n");
        List<Map<String, Object>> topics = maps(d.get("topics"));
        if (topics.isEmpty()) s.append(NONE).append('\n');
        for (Map<String, Object> t : topics) {
            s.append("### ").append(t.get("title")).append('\n').append(bullets(maps(t.get("points"))));
        }
        s.append("\n## Decisions\n").append(decisions(maps(d.get("decisions"))));

        s.append("\n## Action items (as discussed)\n");
        List<Map<String, Object>> actions = maps(d.get("actionItems"));
        if (actions.isEmpty()) s.append(NONE).append('\n');
        for (Map<String, Object> a : actions) {
            s.append("- ").append(a.get("text")).append(" _(").append(kindLabel(String.valueOf(a.get("kind")))).append(")_");
            if (a.get("owner") != null) s.append(" — Owner as spoken: ").append(a.get("owner"));
            if (a.get("deadline") != null) s.append(" — Deadline as spoken: ").append(a.get("deadline"));
            s.append(marker(ints(a.get("evidence")))).append('\n');
        }
        s.append("\n_Owners and deadlines are exactly as spoken and are not yet matched to people or dates._\n");

        s.append("\n## Risks\n").append(bullets(maps(d.get("risks"))));
        s.append("\n## Blockers\n").append(bullets(maps(d.get("blockers"))));
        s.append("\n## Dependencies\n").append(bullets(maps(d.get("dependencies"))));
        s.append("\n## Open questions\n").append(bullets(maps(d.get("openQuestions"))));

        List<Map<String, Object>> withdrawn = maps(d.get("withdrawn"));
        if (!withdrawn.isEmpty()) s.append("\n## Corrected or withdrawn\n").append(bullets(withdrawn));

        Map<String, Object> follow = map(d.get("followUpMeeting"));
        if (follow != null) s.append("\n## Follow-up meeting\n").append(stmt(follow)).append('\n');
        return s.toString().stripTrailing() + "\n";
    }

    // ── Notes ────────────────────────────────────────────────────────────────

    public static String notes(Map<String, Object> d, Meta m) {
        StringBuilder s = new StringBuilder();
        s.append("# Notes — ").append(m.title()).append("\n\n");
        List<Map<String, Object>> topics = maps(d.get("topics"));
        if (topics.isEmpty()) s.append(NONE).append('\n');
        for (Map<String, Object> t : topics) {
            s.append("## ").append(t.get("title")).append('\n').append(bullets(maps(t.get("points")))).append('\n');
        }
        List<Map<String, Object>> questions = maps(d.get("openQuestions"));
        if (!questions.isEmpty()) s.append("## Open questions\n").append(bullets(questions)).append('\n');
        List<Map<String, Object>> risks = maps(d.get("risks"));
        if (!risks.isEmpty()) s.append("## Risks\n").append(bullets(risks)).append('\n');
        return s.toString().stripTrailing() + "\n";
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static String kindLabel(String kind) {
        return switch (kind) {
            case "COMMITMENT" -> "agreed";
            case "SUGGESTION" -> "suggested, not agreed";
            default -> "unresolved";
        };
    }

    private static String bullets(List<Map<String, Object>> items) {
        if (items.isEmpty()) return NONE + "\n";
        StringBuilder s = new StringBuilder();
        for (Map<String, Object> i : items) s.append("- ").append(stmt(i)).append('\n');
        return s.toString();
    }

    private static String decisions(List<Map<String, Object>> items) {
        if (items.isEmpty()) return NONE + "\n";
        StringBuilder s = new StringBuilder();
        for (Map<String, Object> i : items) {
            s.append("- ").append(i.get("text"));
            if (i.get("madeBy") != null) s.append(" — decided by ").append(i.get("madeBy"));
            s.append(marker(ints(i.get("evidence")))).append('\n');
        }
        return s.toString();
    }

    private static String stmt(Map<String, Object> i) { return i.get("text") + marker(ints(i.get("evidence"))); }

    private static String marker(Collection<Integer> ev) {
        String f = Evidence.format(new ArrayList<>(ev));
        return f.isEmpty() ? "" : " " + f;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> map(Object o) { return o instanceof Map<?, ?> ? (Map<String, Object>) o : null; }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> maps(Object o) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (o instanceof List<?> l) for (Object x : l) if (x instanceof Map<?, ?>) out.add((Map<String, Object>) x);
        return out;
    }

    private static List<Integer> ints(Object o) {
        List<Integer> out = new ArrayList<>();
        if (o instanceof List<?> l) for (Object x : l) if (x instanceof Number n) out.add(n.intValue());
        return out;
    }
}

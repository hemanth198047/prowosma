package com.prowosma.backend.meetingassistant;

import java.util.*;

/**
 * Validates the model's action extraction. The model is only ever asked for what was SAID; everything that decides a person,
 * a project or a date is done afterwards in code. This class enforces the contract:
 *  - an action without valid transcript evidence is removed (counted, never kept);
 *  - unknown kinds become UNRESOLVED — never promoted to a commitment;
 *  - a priority is kept only if the model cited the lines that justify it, otherwise it is dropped (the app default is used and labelled);
 *  - a project name must be exactly one from the supplied list; anything else is ignored;
 *  - a proposed new project needs a name and evidence, and an action may only reference a proposal that really exists.
 */
public final class ActionSanitizer {

    private ActionSanitizer() {}

    public record Item(String title, String description, String type, String kind, String owner, boolean ownerIsSpeaker, String deadline,
                       String priority, List<Integer> priorityEvidence, String projectName, String proposedProject,
                       List<String> dependencies, List<String> acceptanceCriteria, List<Integer> evidence) {}
    public record Proposal(String name, String description, String rationale, List<Integer> evidence) {}
    public record Withdrawal(String title, List<Integer> evidence) {}
    public record Parsed(List<Item> actions, List<Proposal> proposals, List<Withdrawal> withdrawn, List<String> warnings, int dropped) {}

    static final Set<String> TYPES = Set.of("TASK", "BUG", "FOLLOW_UP", "RESEARCH", "OTHER");
    static final Set<String> KINDS = Set.of("COMMITMENT", "SUGGESTION", "UNRESOLVED");
    static final Set<String> PRIORITIES = Set.of("LOW", "MEDIUM", "HIGH");
    private static final Set<String> NULLISH = Set.of("null", "none", "n/a", "na", "unknown", "unassigned", "nobody", "");

    public static Parsed sanitize(Map<String, Object> raw, int minSeq, int maxSeq, Collection<String> knownProjects) {
        int[] dropped = {0};
        int[] ignoredProjects = {0};
        int[] priorityDropped = {0};
        List<Proposal> proposals = new ArrayList<>();
        Set<String> seenProposal = new HashSet<>();
        for (Object o : list(raw == null ? null : raw.get("proposedProjects"))) {
            if (!(o instanceof Map<?, ?> m)) { dropped[0]++; continue; }
            String name = str(m.get("name"), 100);
            List<Integer> ev = evidence(m.get("evidence"), minSeq, maxSeq);
            if (name == null || ev.isEmpty()) { dropped[0]++; continue; }
            if (!seenProposal.add(NameMatcher.norm(name))) continue;
            proposals.add(new Proposal(name, str(m.get("description"), 1000), str(m.get("rationale"), 500), ev));
        }
        Map<String, String> knownByNorm = new HashMap<>();
        if (knownProjects != null) for (String k : knownProjects) knownByNorm.putIfAbsent(NameMatcher.norm(k), k);
        Map<String, String> proposalByNorm = new HashMap<>();
        for (Proposal p : proposals) proposalByNorm.put(NameMatcher.norm(p.name()), p.name());

        List<Item> actions = new ArrayList<>();
        for (Object o : list(raw == null ? null : raw.get("actions"))) {
            if (!(o instanceof Map<?, ?> m)) { dropped[0]++; continue; }
            String title = str(m.get("title"), 200);
            List<Integer> ev = evidence(m.get("evidence"), minSeq, maxSeq);
            if (title == null || ev.isEmpty()) { dropped[0]++; continue; }
            String type = upper(m.get("type"));
            String kind = upper(m.get("kind"));
            String priority = upper(m.get("priority"));
            List<Integer> pev = evidence(m.get("priorityEvidence"), minSeq, maxSeq);
            if (priority != null && (!PRIORITIES.contains(priority) || pev.isEmpty())) { if (PRIORITIES.contains(priority)) priorityDropped[0]++; priority = null; pev = List.of(); }
            String project = null;
            String named = str(m.get("projectName"), 120);
            if (named != null) {
                project = knownByNorm.get(NameMatcher.norm(named));
                if (project == null) ignoredProjects[0]++;
            }
            String proposed = null;
            String pn = str(m.get("proposedProject"), 100);
            if (pn != null && project == null) proposed = proposalByNorm.get(NameMatcher.norm(pn));
            actions.add(new Item(title, str(m.get("description"), 1500), type != null && TYPES.contains(type) ? type : "TASK", kind != null && KINDS.contains(kind) ? kind : "UNRESOLVED",
                    shortText(m.get("owner")), Boolean.TRUE.equals(m.get("ownerIsSpeaker")) || "true".equalsIgnoreCase(String.valueOf(m.get("ownerIsSpeaker"))),
                    shortText(m.get("deadline")), priority, pev, project, proposed, strings(m.get("dependencies")), strings(m.get("acceptanceCriteria")), ev));
        }

        List<Withdrawal> withdrawn = new ArrayList<>();
        for (Object o : list(raw == null ? null : raw.get("withdrawnActions"))) {
            if (!(o instanceof Map<?, ?> m)) { dropped[0]++; continue; }
            String title = str(m.get("title"), 200);
            List<Integer> ev = evidence(m.get("evidence"), minSeq, maxSeq);
            if (title == null || ev.isEmpty()) { dropped[0]++; continue; }
            withdrawn.add(new Withdrawal(title, ev));
        }

        List<String> warnings = new ArrayList<>();
        if (dropped[0] > 0) warnings.add(dropped[0] + " item(s) were removed because they didn't point to lines of the transcript.");
        if (ignoredProjects[0] > 0) warnings.add(ignoredProjects[0] + " project name(s) that aren't in your project list were ignored.");
        if (priorityDropped[0] > 0) warnings.add(priorityDropped[0] + " priority value(s) were ignored because the discussion didn't support them.");
        return new Parsed(actions, proposals, withdrawn, warnings, dropped[0]);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static List<?> list(Object o) { return o instanceof List<?> l ? l : List.of(); }

    private static String clean(Object o) {
        return o instanceof String s ? s.replaceAll("[\\p{Cntrl}&&[^\n\t]]", "").strip() : null;
    }

    private static String str(Object o, int max) {
        String t = clean(o);
        if (t == null || NULLISH.contains(t.toLowerCase(Locale.ROOT))) return null;
        return t.length() > max ? t.substring(0, max).strip() + "…" : t;
    }

    private static String shortText(Object o) {
        String t = clean(o);
        if (t == null) return null;
        t = t.replaceAll("\\s+", " ");
        if (NULLISH.contains(t.toLowerCase(Locale.ROOT))) return null;
        return t.length() > 120 ? t.substring(0, 120).strip() : t;
    }

    private static String upper(Object o) { return o == null ? null : String.valueOf(o).trim().toUpperCase(Locale.ROOT).replace(' ', '_').replace('-', '_'); }

    private static List<String> strings(Object o) {
        List<String> out = new ArrayList<>();
        for (Object x : list(o)) {
            String t = str(x, 300);
            if (t != null && out.size() < 10 && !out.contains(t)) out.add(t);
        }
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
}

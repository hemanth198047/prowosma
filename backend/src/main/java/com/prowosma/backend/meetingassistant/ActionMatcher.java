package com.prowosma.backend.meetingassistant;

import com.prowosma.backend.meetingassistant.ActionSanitizer.Item;
import com.prowosma.backend.meetingassistant.ActionSanitizer.Withdrawal;

import java.util.*;

/** Title similarity for de-duplicating actions inside a meeting, spotting withdrawn ones, and diffing a re-run against what exists. */
public final class ActionMatcher {

    private ActionMatcher() {}

    private static final Set<String> STOP = Set.of("a", "an", "the", "to", "of", "for", "and", "in", "on", "will", "shall", "should", "we", "i", "by", "with",
            "from", "up", "is", "be", "it", "this", "that", "our", "my", "your", "need", "needs", "please", "also");

    static Set<String> tokens(String s) {
        Set<String> out = new LinkedHashSet<>();
        for (String t : NameMatcher.norm(s).split(" ")) if (!t.isEmpty() && !STOP.contains(t)) out.add(t.length() > 3 && t.endsWith("s") ? t.substring(0, t.length() - 1) : t);
        return out;
    }

    public static double similarity(String a, String b) {
        Set<String> x = tokens(a), y = tokens(b);
        if (x.isEmpty() || y.isEmpty()) return 0;
        Set<String> inter = new HashSet<>(x);
        inter.retainAll(y);
        Set<String> union = new HashSet<>(x);
        union.addAll(y);
        return (double) inter.size() / union.size();
    }

    private static int kindRank(String k) { return "COMMITMENT".equals(k) ? 3 : "UNRESOLVED".equals(k) ? 2 : 1; }

    /** Merges near-identical actions (e.g. the same action noticed in two parts of a long meeting). Evidence is united; the stronger kind wins. */
    public static List<Item> dedupe(List<Item> items, double threshold) {
        List<Item> out = new ArrayList<>();
        for (Item it : items) {
            int hit = -1;
            for (int i = 0; i < out.size() && hit < 0; i++) if (similarity(out.get(i).title(), it.title()) >= threshold) hit = i;
            if (hit < 0) { out.add(it); continue; }
            Item a = out.get(hit);
            TreeSet<Integer> ev = new TreeSet<>(a.evidence());
            ev.addAll(it.evidence());
            TreeSet<Integer> pev = new TreeSet<>(a.priorityEvidence());
            pev.addAll(it.priorityEvidence());
            List<String> deps = new ArrayList<>(a.dependencies());
            for (String d : it.dependencies()) if (!deps.contains(d)) deps.add(d);
            List<String> acc = new ArrayList<>(a.acceptanceCriteria());
            for (String d : it.acceptanceCriteria()) if (!acc.contains(d)) acc.add(d);
            out.set(hit, new Item(a.title(), longer(a.description(), it.description()), a.type(),
                    kindRank(it.kind()) > kindRank(a.kind()) ? it.kind() : a.kind(),
                    a.owner() != null ? a.owner() : it.owner(), a.ownerIsSpeaker() || it.ownerIsSpeaker(),
                    a.deadline() != null ? a.deadline() : it.deadline(),
                    a.priority() != null ? a.priority() : it.priority(), new ArrayList<>(pev),
                    a.projectName() != null ? a.projectName() : it.projectName(),
                    a.proposedProject() != null ? a.proposedProject() : it.proposedProject(), deps, acc, new ArrayList<>(ev)));
        }
        return out;
    }

    private static String longer(String a, String b) { return a == null ? b : b == null ? a : (b.length() > a.length() ? b : a); }

    /** For each item, true if a later statement in the meeting withdrew it. {@code unmatched} receives withdrawals that matched nothing. */
    public static boolean[] withdrawnFlags(List<Item> items, List<Withdrawal> withdrawals, double threshold, List<Withdrawal> unmatched) {
        boolean[] flags = new boolean[items.size()];
        for (Withdrawal w : withdrawals) {
            int best = -1;
            double bestSim = threshold;
            for (int i = 0; i < items.size(); i++) {
                double s = similarity(items.get(i).title(), w.title());
                if (s >= bestSim) { bestSim = s; best = i; }
            }
            if (best >= 0) flags[best] = true; else if (unmatched != null) unmatched.add(w);
        }
        return flags;
    }

    public record Diff(int[] matchedExisting, Set<Integer> gone) {}

    /** One-to-one matching of fresh items to existing action titles. {@code matchedExisting[i]} is the existing index for fresh item i, or -1 if new. */
    public static Diff diff(List<String> existingTitles, List<Item> fresh, double threshold) {
        int[] match = new int[fresh.size()];
        Arrays.fill(match, -1);
        boolean[] taken = new boolean[existingTitles.size()];
        record Pair(int f, int e, double s) {}
        List<Pair> pairs = new ArrayList<>();
        for (int f = 0; f < fresh.size(); f++)
            for (int e = 0; e < existingTitles.size(); e++) {
                double s = similarity(fresh.get(f).title(), existingTitles.get(e));
                if (s >= threshold) pairs.add(new Pair(f, e, s));
            }
        pairs.sort((p, q) -> Double.compare(q.s(), p.s()));
        for (Pair p : pairs) if (match[p.f()] < 0 && !taken[p.e()]) { match[p.f()] = p.e(); taken[p.e()] = true; }
        Set<Integer> gone = new TreeSet<>();
        for (int e = 0; e < taken.length; e++) if (!taken[e]) gone.add(e);
        return new Diff(match, gone);
    }
}

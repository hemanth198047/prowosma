package com.prowosma.backend.uma.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.prowosma.backend.meetingassistant.DeadlineResolver;
import com.prowosma.backend.meetingassistant.NameMatcher;
import com.prowosma.backend.uma.model.UmaInsights;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.LocalDate;
import java.util.*;
import java.util.regex.Pattern;

/**
 * Deterministic checks on what the model returned. Nothing the model says is trusted as is:
 * <ul>
 *   <li>every item must cite transcript lines that exist — items without valid evidence are dropped (and counted);</li>
 *   <li>an owner is kept only if that name appears in (or is the speaker of) a cited line — otherwise the action is "unassigned";</li>
 *   <li>a deadline is kept only if its words appear in a cited line, and becomes a date only when it resolves unambiguously
 *       against the meeting date ("by Friday" after a Tuesday meeting = that Friday);</li>
 *   <li>a spoken name becomes a task assignee only on an exact match with one workspace member; first names are only suggestions;</li>
 *   <li>enums are normalised, text is trimmed and length-limited, duplicates are merged, ids are stable so re-running keeps decisions
 *       people already made (approved, rejected, edited, created) and never creates a second task.</li>
 * </ul>
 */
public final class InsightValidator {
    private InsightValidator() {}

    public record Line(int seq, String speaker, String text) {}

    private static final Pattern WS = Pattern.compile("\\s+");
    private static final Pattern CTRL = Pattern.compile("[\\p{Cntrl}&&[^\\n]]");
    private static final Set<String> DUE_STOP = Set.of("by", "before", "on", "the", "of", "until", "till", "due", "no", "later", "than", "end", "at", "in");

    public static UmaInsights validate(JsonNode root, Map<Integer, Line> lines, LocalDate meetingDate,
                                       List<NameMatcher.Person> directory, UmaInsights previous, String defaultProjectId) {
        UmaInsights out = new UmaInsights();
        int[] dropped = {0};

        out.setSummary(clean(root.path("summary").asText(""), 1500));

        for (JsonNode t : iter(root.path("notes"))) {
            UmaInsights.Topic topic = new UmaInsights.Topic();
            topic.setTitle(clean(t.path("title").asText(""), 160));
            for (JsonNode p : iter(t.path("points"))) {
                String text = clean(p.path("text").asText(""), 600);
                List<Integer> ev = ground(text, evidence(p.path("evidence"), lines), lines);
                if (text.isEmpty()) continue;
                if (ev.isEmpty()) { dropped[0]++; continue; }
                UmaInsights.Point pt = new UmaInsights.Point();
                pt.setText(text); pt.setEvidence(ev);
                topic.getPoints().add(pt);
            }
            if (!topic.getPoints().isEmpty()) {
                if (topic.getTitle().isEmpty()) topic.setTitle("Discussion");
                out.getNotes().add(topic);
            }
        }

        Set<String> seen = new HashSet<>();
        for (JsonNode d : iter(root.path("decisions"))) {
            String text = clean(d.path("text").asText(""), 500);
            List<Integer> ev = ground(text, evidence(d.path("evidence"), lines), lines);
            if (text.isEmpty()) continue;
            if (ev.isEmpty()) { dropped[0]++; continue; }
            String id = "d" + hash(norm(text));
            if (!seen.add(id)) continue;
            UmaInsights.Decision dec = new UmaInsights.Decision();
            dec.setId(id); dec.setText(text); dec.setEvidence(ev);
            String by = nullIfBlank(clean(d.path("decidedBy").asText(""), 120));
            dec.setDecidedBy(by != null && mentioned(by, ev, lines) ? by : null);
            out.getDecisions().add(dec);
        }

        out.setRisks(findings(root.path("risks"), lines, "r", dropped, true));
        out.setQuestions(findings(root.path("questions"), lines, "q", dropped, false));
        out.setFollowUps(findings(root.path("followUps"), lines, "f", dropped, false));
        for (UmaInsights.Finding f : out.getQuestions()) f.setKind("QUESTION");
        for (UmaInsights.Finding f : out.getFollowUps()) f.setKind("FOLLOW_UP");

        Map<String, UmaInsights.ActionItem> prior = new LinkedHashMap<>();
        if (previous != null) for (UmaInsights.ActionItem a : previous.getActions()) prior.put(a.getId(), a);

        Map<String, UmaInsights.ActionItem> actions = new LinkedHashMap<>();
        int ownersRemoved = 0, deadlinesRemoved = 0, metaDropped = 0;
        // Lines already cited by a real (non "create a task") action: a recovered task never duplicates one of them.
        Set<Integer> citedByWork = new HashSet<>();
        for (JsonNode a : iter(root.path("actions"))) {
            String t = clean(a.path("title").asText(""), 200);
            if (!t.isEmpty() && !META_ACTION.matcher(t.strip()).matches())
                citedByWork.addAll(ground(t + " " + a.path("description").asText(""), evidence(a.path("evidence"), lines), lines));
        }
        for (JsonNode a : iter(root.path("actions"))) {
            String title = clean(a.path("title").asText(""), 200);
            List<Integer> ev = ground(title + " " + a.path("description").asText(""), evidence(a.path("evidence"), lines), lines);
            if (title.isEmpty()) continue;
            if (ev.isEmpty()) { dropped[0]++; continue; }
            if (META_ACTION.matcher(title.strip()).matches()) {           // "Create project" isn't work: the project is listed under projects
                // "...a task that explains the feature": the task is the work the line describes.
                String work = null;
                if (title.toLowerCase(Locale.ROOT).contains("task") && Collections.disjoint(ev, citedByWork))
                    for (int seq : ev) { work = taskFromLine(lines.get(seq)); if (work != null) break; }
                if (work == null) { metaDropped++; continue; }
                title = work;
            }
            String id = "a" + hash(norm(title));
            UmaInsights.ActionItem existing = actions.get(id);
            if (existing != null) {                                        // the same action twice (e.g. from two parts): merge evidence
                TreeSet<Integer> merged = new TreeSet<>(existing.getEvidence()); merged.addAll(ev);
                existing.setEvidence(new ArrayList<>(merged));
                continue;
            }
            UmaInsights.ActionItem item = new UmaInsights.ActionItem();
            item.setId(id);
            item.setTitle(title);
            item.setDescription(clean(a.path("description").asText(""), 1000));
            item.setEvidence(ev);
            item.setPriority(oneOf(a.path("priority").asText(""), "MEDIUM", "LOW", "MEDIUM", "HIGH"));
            item.setConfidence(oneOf(a.path("confidence").asText(""), "MEDIUM", "LOW", "MEDIUM", "HIGH"));
            item.setProjectId(defaultProjectId);
            String dep = nullIfBlank(clean(a.path("dependsOn").asText(""), 300));
            item.setDependsOn(dep);

            String owner = nullIfBlank(clean(a.path("owner").asText(""), 120));
            Integer nearby = null;
            if (owner != null && !mentioned(owner, ev, lines)) {
                nearby = nearbyMention(owner, ev, lines);
                if (nearby == null) { owner = null; ownersRemoved++; }
                else { ev = sortedWith(ev, nearby); item.setEvidence(ev); }
            }
            String committer = selfCommitted(ev, lines);
            if (owner == null) owner = committer;                  // "I'll prepare the test cases" - said by a named speaker: they own it
            // A plain "I'll ..." from that speaker is an agreed commitment, however cautiously the model rated it ("I'll try", "if I can": not).
            if (committer != null && committer.equals(owner) && !hedged(ev, lines)) item.setConfidence("HIGH");
            item.setOwnerSpoken(owner);
            resolveOwner(item, owner, directory);
            if (nearby != null) {
                // Named in the line just before/after ("Thank you Jordan") — likely, not certain: a person must confirm it.
                if ("MATCHED".equals(item.getOwnerState())) { item.setOwnerState("SUGGESTED"); item.setOwnerMemberId(null); }
                item.setOwnerNote("Named in line " + nearby + ", next to the cited line. Please confirm.");
            }

            String due = nullIfBlank(clean(a.path("due").asText(""), 120));
            if (due != null && !dueMentioned(due, ev, lines)) { due = null; deadlinesRemoved++; }
            if (due == null) {
                // Small models often write "by Friday" in the description instead of "due"; use it only if the cited line says it too.
                String said = deadlinePhrase(item.getTitle() + " " + item.getDescription());
                if (said != null && dueMentioned(said, ev, lines)) due = said;
            }
            item.setDueSpoken(due);
            if (due == null) item.setDueState("UNSPECIFIED");
            else {
                DeadlineResolver.Result r = DeadlineResolver.resolve(due, meetingDate);
                if (r.reliable()) { item.setDueDate(r.date()); item.setDueState(r.status()); }
                else { item.setDueState("UNCLEAR"); item.setDueSuggested(r.date()); item.setDueNote(r.note()); }
            }
            actions.put(id, item);
        }

        // Keep what people already did: their decisions, edits and created tasks survive a re-run.
        for (UmaInsights.ActionItem fresh : new ArrayList<>(actions.values())) {
            UmaInsights.ActionItem before = prior.get(fresh.getId());
            if (before != null && (before.isEdited() || !"PENDING".equals(before.getStatus()))) actions.put(fresh.getId(), before);
        }
        for (UmaInsights.ActionItem before : prior.values()) {
            if (!actions.containsKey(before.getId()) && ("CREATED".equals(before.getStatus()) || "LINKED".equals(before.getStatus()) || before.isEdited()))
                actions.put(before.getId(), before);                       // never lose the link to a task that exists
        }
        out.setActions(new ArrayList<>(actions.values()));

        // Projects the meeting asked for or referred to. Same rules: cited lines must exist and support the name; a person's decision survives a re-run.
        Map<String, UmaInsights.ProjectItem> priorProjects = new LinkedHashMap<>();
        if (previous != null && previous.getProjects() != null) for (UmaInsights.ProjectItem p : previous.getProjects()) priorProjects.put(p.getId(), p);
        Map<String, UmaInsights.ProjectItem> projects = new LinkedHashMap<>();
        for (JsonNode p : iter(root.path("projects"))) {
            String name = clean(p.path("name").asText(""), 120);
            if (name.length() < 2) continue;
            List<Integer> ev = ground(name + " " + p.path("description").asText(""), evidence(p.path("evidence"), lines), lines);
            if (ev.isEmpty()) { dropped[0]++; continue; }
            String intent = oneOf(p.path("intent").asText(""), "PROPOSAL", "CREATE", "PROPOSAL", "EXISTING");
            boolean asked = askedToCreate(ev, lines);                 // "let's create a project", "I'm going to create a project" (not "maybe")
            if (!asked && !"EXISTING".equals(intent) && root.path("projects").size() == 1) {
                // Only one project came up and the model cited a neighbouring line: the clear "create a project" line is the evidence.
                List<Integer> said = new ArrayList<>();
                for (Map.Entry<Integer, Line> e : lines.entrySet()) if (askedToCreate(List.of(e.getKey()), lines)) said.add(e.getKey());
                if (!said.isEmpty()) {
                    asked = true;
                    TreeSet<Integer> all = new TreeSet<>(ev); all.addAll(said); ev = new ArrayList<>(all);
                }
            }
            if ("PROPOSAL".equals(intent) && asked) intent = "CREATE";
            // A created project's name must come from the meeting: said in the cited lines, or - when someone clearly asked for a project
            // without naming it - made only of words used in the meeting. Otherwise a person decides.
            if ("CREATE".equals(intent) && !nameSaid(name, ev, lines) && !(asked && wordsUsed(name, lines))) intent = "PROPOSAL";
            String id = "p" + hash(norm(name));
            if (projects.containsKey(id)) continue;
            UmaInsights.ProjectItem item = new UmaInsights.ProjectItem();
            item.setId(id); item.setName(name); item.setIntent(intent); item.setEvidence(ev);
            item.setDescription(clean(p.path("description").asText(""), 1000));
            String by = nullIfBlank(clean(p.path("requestedBy").asText(""), 120));
            item.setRequestedBy(by != null && mentioned(by, ev, lines) ? by : null);
            UmaInsights.ProjectItem before = priorProjects.get(id);
            projects.put(id, before != null && !"PROPOSED".equals(before.getStatus()) ? before : item);
        }
        for (UmaInsights.ProjectItem before : priorProjects.values())
            if (!projects.containsKey(before.getId()) && ("CREATED".equals(before.getStatus()) || "LINKED".equals(before.getStatus())))
                projects.put(before.getId(), before);
        out.setProjects(new ArrayList<>(projects.values()));

        out.setDroppedForMissingEvidence(dropped[0]);
        if (dropped[0] > 0) out.getWarnings().add(dropped[0] + " statement(s) were left out because they didn't point to the transcript.");
        if (metaDropped > 0) out.getWarnings().add(metaDropped + " \"create a project/task\" item(s) weren't kept as tasks - the project is listed under projects.");
        if (ownersRemoved > 0) out.getWarnings().add(ownersRemoved + " owner name(s) weren't in the cited lines, so those actions are unassigned.");
        if (deadlinesRemoved > 0) out.getWarnings().add(deadlinesRemoved + " deadline(s) weren't in the cited lines, so they are unspecified.");
        return out;
    }

    // ── helpers ──────────────────────────────────────────────────────────

    static void resolveOwner(UmaInsights.ActionItem item, String spoken, List<NameMatcher.Person> directory) {
        item.getOwnerCandidates().clear();
        item.setOwnerMemberId(null);
        if (spoken == null) { item.setOwnerState("UNASSIGNED"); return; }
        NameMatcher.Match m = NameMatcher.resolve(spoken, directory == null ? List.of() : directory);
        switch (m.state()) {
            case "RESOLVED" -> { item.setOwnerState("MATCHED"); item.setOwnerMemberId(m.person().id()); addCandidate(item, m.person()); }
            case "SUGGESTED" -> { item.setOwnerState("SUGGESTED"); m.candidates().forEach(p -> addCandidate(item, p)); }
            case "AMBIGUOUS" -> { item.setOwnerState("AMBIGUOUS"); m.candidates().forEach(p -> addCandidate(item, p)); }
            case "TEAM", "UNSPECIFIED" -> item.setOwnerState("UNASSIGNED");
            default -> item.setOwnerState("NOT_A_MEMBER");
        }
    }

    private static void addCandidate(UmaInsights.ActionItem item, NameMatcher.Person p) {
        UmaInsights.Candidate c = new UmaInsights.Candidate();
        c.setMemberId(p.id()); c.setName(p.name());
        item.getOwnerCandidates().add(c);
    }

    private static List<UmaInsights.Finding> findings(JsonNode arr, Map<Integer, Line> lines, String prefix, int[] dropped, boolean withKind) {
        List<UmaInsights.Finding> out = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (JsonNode n : iter(arr)) {
            String text = clean(n.path("text").asText(""), 500);
            List<Integer> ev = ground(text, evidence(n.path("evidence"), lines), lines);
            if (text.isEmpty()) continue;
            if (ev.isEmpty()) { dropped[0]++; continue; }
            String id = prefix + hash(norm(text));
            if (!seen.add(id)) continue;
            UmaInsights.Finding f = new UmaInsights.Finding();
            f.setId(id); f.setText(text); f.setEvidence(ev);
            if (withKind) f.setKind(oneOf(n.path("kind").asText(""), "RISK", "RISK", "BLOCKER", "DEPENDENCY"));
            out.add(f);
        }
        return out;
    }

    /** Line numbers that exist, sorted, at most 20. Accepts 12, "12", "#12", "9-11". */
    static List<Integer> evidence(JsonNode node, Map<Integer, Line> lines) {
        TreeSet<Integer> out = new TreeSet<>();
        for (JsonNode n : iter(node)) {
            if (n.isInt() || n.isLong()) add(out, n.asInt(), lines);
            else if (n.isTextual()) {
                String s = n.asText().replace("#", "").trim();
                if (s.matches("\\d+")) add(out, Integer.parseInt(s), lines);
                else if (s.matches("\\d+\\s*-\\s*\\d+")) {
                    String[] p = s.split("-");
                    int a = Integer.parseInt(p[0].trim()), b = Integer.parseInt(p[1].trim());
                    for (int i = Math.min(a, b); i <= Math.max(a, b) && i - Math.min(a, b) < 50; i++) add(out, i, lines);
                }
            }
        }
        List<Integer> list = new ArrayList<>(out);
        return list.size() > 20 ? list.subList(0, 20) : list;
    }

    private static void add(Set<Integer> out, int seq, Map<Integer, Line> lines) { if (lines.containsKey(seq)) out.add(seq); }

    /** The line right before or after the evidence that names the owner, if any (never further away). */
    static Integer nearbyMention(String name, List<Integer> evidence, Map<Integer, Line> lines) {
        for (int seq : evidence) {
            for (int n : new int[]{seq + 1, seq - 1}) {
                if (evidence.contains(n) || !lines.containsKey(n)) continue;
                if (mentioned(name, List.of(n), lines)) return n;
            }
        }
        return null;
    }

    private static List<Integer> sortedWith(List<Integer> ev, int extra) {
        TreeSet<Integer> t = new TreeSet<>(ev);
        t.add(extra);
        return new ArrayList<>(t);
    }

    private static final Pattern DEADLINE = Pattern.compile(
            "\\b(?:by|before|until|due|on)\\s+(?:the\\s+)?(?:end of (?:the )?(?:day|week|month)|tomorrow|today|tonight|next week|"
            + "(?:next |this )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|"
            + "\\d{1,2}(?:st|nd|rd|th)?(?:\\s+of)?\\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)|"
            + "(?:january|february|march|april|may|june|july|august|september|october|november|december)\\s+\\d{1,2}(?:st|nd|rd|th)?)\\b",
            Pattern.CASE_INSENSITIVE);

    /** A deadline phrase such as "by Wednesday" or "by the 20th of November" in free text, or null. */
    static String deadlinePhrase(String text) {
        if (text == null) return null;
        java.util.regex.Matcher m = DEADLINE.matcher(text);
        return m.find() ? m.group().trim() : null;
    }

    private static final Set<String> STOP = Set.of(
            "will", "that", "this", "with", "from", "have", "been", "they", "them", "their", "there", "what", "when", "which",
            "would", "could", "should", "about", "into", "than", "then", "also", "just", "need", "needs", "make", "made", "team",
            "meeting", "discussed", "discuss", "agreed", "agree", "decided", "decide", "decision", "going", "does", "done", "were",
            "your", "ours", "some", "more", "most", "very", "before", "after", "until", "item", "items", "being", "still", "only",
            "each", "other", "said", "says", "like", "want", "wants", "follow", "regarding", "around", "over", "yet");

    /** Meaningful words of a text, crudely stemmed (first five letters) so "screenshots" meets "screenshot". */
    static Set<String> keywords(String text) {
        Set<String> out = new HashSet<>();
        for (String w : norm(text).split(" ")) {
            if (w.length() < 4 || STOP.contains(w) || w.chars().allMatch(Character::isDigit)) continue;
            out.add(w.length() > 5 ? w.substring(0, 5) : w);
        }
        return out;
    }

    private static int overlap(Set<String> words, Line l) {
        if (l == null) return 0;
        Set<String> lw = keywords(l.text());
        int n = 0;
        for (String w : words) if (lw.contains(w)) n++;
        return n;
    }

    /**
     * Checks that the cited lines actually talk about the claim (they share a meaningful word). Small models often cite the
     * wrong line number; then the one transcript line that clearly matches (two or more shared words, no tie) is used instead,
     * and the reader can click through to check it. A claim no line supports gets no evidence, so it is dropped.
     */
    static List<Integer> ground(String claim, List<Integer> cited, Map<Integer, Line> lines) {
        if (cited.isEmpty()) return cited;
        Set<String> words = keywords(claim);
        if (words.isEmpty()) return cited;                       // nothing to compare on: keep what was cited
        for (int seq : cited) if (overlap(words, lines.get(seq)) > 0) return cited;
        int best = -1, bestScore = 0; boolean tie = false;
        for (Line l : lines.values()) {
            int sc = overlap(words, l);
            if (sc > bestScore) { best = l.seq(); bestScore = sc; tie = false; }
            else if (sc == bestScore && sc > 0) tie = true;
        }
        return bestScore >= 2 && !tie ? List.of(best) : List.of();
    }

    /** The name (or its first word) appears in a cited line, or is that line's speaker. */
    static boolean mentioned(String name, List<Integer> evidence, Map<Integer, Line> lines) {
        String n = norm(name);
        if (n.isEmpty()) return false;
        String first = n.split(" ")[0];
        Pattern word = Pattern.compile("\\b" + Pattern.quote(first) + "\\b");
        for (int seq : evidence) {
            Line l = lines.get(seq);
            if (l == null) continue;
            if (l.speaker() != null && norm(l.speaker()).contains(first)) return true;
            if (word.matcher(norm(l.text())).find()) return true;
        }
        return false;
    }

    private static final Pattern SELF_COMMIT = Pattern.compile("^\\W*(i'll|i will|i'm going to|i am going to|i shall|i'll take|i can take|leave it with me|i'll handle)\\b",
            Pattern.CASE_INSENSITIVE);

    /**
     * When the model named no owner but the first cited line is its speaker committing themselves ("I'll ..."), the owner is that speaker -
     * only if the transcript names them (a neutral "Speaker 2" or an unknown speaker is no owner).
     */
    static String selfCommitted(List<Integer> evidence, Map<Integer, Line> lines) {
        if (evidence.isEmpty()) return null;
        Line l = lines.get(evidence.get(0));
        if (l == null || l.speaker() == null || l.speaker().isBlank()) return null;
        String who = l.speaker().strip();
        if (who.matches("(?i)(unknown( speaker)?|speaker( [0-9]+)?( \\(part [0-9]+\\))?|you|me)")) return null;
        return SELF_COMMIT.matcher(l.text().replace('’', '\'')).find() ? who : null;
    }

    static final Pattern META_ACTION = Pattern.compile("(?i)(create|set up|setup|open|start|make|add)( a| the| new| a new)? (project|task)s?( in prowosma)?\\.?");
    private static final Pattern CREATE_PROJECT = Pattern.compile("(?i)\\b(create|set up|setup|start|open|make|kick off)\\b[^.?!]{0,40}\\bproject\\b");
    private static final Pattern TENTATIVE = Pattern.compile("(?i)\\b(maybe|might|should we|could we|do we need|not sure|perhaps|if we)\\b");

    private static final Pattern TASK_THAT = Pattern.compile("(?i)\\ba task (?:that|which|to) ([a-z]+)((?: [a-z0-9'-]+){1,8})");

    /** "a task that explains the feature" -> "Explain the feature"; "a task to update the docs" -> "Update the docs". Null if the line has none. */
    static String taskFromLine(Line l) {
        if (l == null) return null;
        java.util.regex.Matcher mt = TASK_THAT.matcher(l.text());
        if (!mt.find()) return null;
        String verb = mt.group(1).toLowerCase(Locale.ROOT);
        if (Set.of("is", "was", "will", "would", "should", "can", "could", "we", "i", "you", "they", "has", "have").contains(verb)) return null;
        if (verb.matches(".*(sh|ch|x|ss|z)es")) verb = verb.substring(0, verb.length() - 2);
        else if (verb.endsWith("ies")) verb = verb.substring(0, verb.length() - 3) + "y";
        else if (verb.endsWith("s") && !verb.endsWith("ss")) verb = verb.substring(0, verb.length() - 1);
        String rest = mt.group(2).replaceAll("(?i) (and|but|so|once|when|then)( .*)?$", "");
        String t = verb + rest;
        return Character.toUpperCase(t.charAt(0)) + t.substring(1);
    }

    /** The cited lines clearly say a project will be created (not a question or a maybe). */
    static boolean askedToCreate(List<Integer> evidence, Map<Integer, Line> lines) {
        for (int seq : evidence) {
            Line l = lines.get(seq);
            if (l != null && CREATE_PROJECT.matcher(l.text()).find() && !TENTATIVE.matcher(l.text()).find()) return true;
        }
        return false;
    }

    private static String stem(String w) { return w.length() > 5 ? w.substring(0, 5) : w; }

    /** Every meaningful word of the name was used somewhere in the meeting (compared on the first 5 letters: "explanation" counts for "explaining"). */
    static boolean wordsUsed(String name, Map<Integer, Line> lines) {
        Set<String> stems = new HashSet<>();
        for (Line l : lines.values()) for (String w : norm(l.text()).split(" ")) if (w.length() >= 3) stems.add(stem(w));
        for (String w : norm(name).split(" ")) {
            if (w.length() < 3 || Set.of("the", "and", "for", "project", "new").contains(w)) continue;
            if (!stems.contains(stem(w))) return false;
        }
        return true;
    }

    private static final Pattern HEDGE = Pattern.compile("\\b(if i can|if possible|if i get time|maybe|might|try to|i'll try|hopefully|probably|not sure|i think|perhaps)\\b",
            Pattern.CASE_INSENSITIVE);

    static boolean hedged(List<Integer> evidence, Map<Integer, Line> lines) {
        Line l = evidence.isEmpty() ? null : lines.get(evidence.get(0));
        return l == null || HEDGE.matcher(l.text().replace('’', '\'')).find();
    }

    /** The project's name was actually said in the cited lines (all its meaningful words, in any case). */
    static boolean nameSaid(String name, List<Integer> evidence, Map<Integer, Line> lines) {
        StringBuilder said = new StringBuilder();
        for (int seq : evidence) { Line l = lines.get(seq); if (l != null) said.append(' ').append(norm(l.text())); }
        String text = said.toString();
        for (String w : norm(name).split(" ")) {
            if (w.length() < 3) continue;
            if (!Pattern.compile("\\b" + Pattern.quote(w) + "\\b").matcher(text).find()) return false;
        }
        return true;
    }

    /** Every meaningful word of the spoken deadline appears in the cited lines. */
    static boolean dueMentioned(String due, List<Integer> evidence, Map<Integer, Line> lines) {
        StringBuilder text = new StringBuilder();
        for (int seq : evidence) { Line l = lines.get(seq); if (l != null) text.append(' ').append(norm(l.text())); }
        String hay = " " + text + " ";
        List<String> words = new ArrayList<>();
        for (String w : norm(due).split(" ")) if (!w.isBlank() && !DUE_STOP.contains(w)) words.add(w.replaceAll("(st|nd|rd|th)$", ""));
        if (words.isEmpty()) return false;
        for (String w : words) if (!hay.contains(w)) return false;
        return true;
    }

    static String norm(String s) {
        if (s == null) return "";
        return WS.matcher(s.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}@.\\s]", " ").replace(".", " ")).replaceAll(" ").trim();
    }

    static String clean(String s, int max) {
        if (s == null) return "";
        String t = WS.matcher(CTRL.matcher(s).replaceAll(" ")).replaceAll(" ").trim();
        if ("null".equalsIgnoreCase(t)) return "";
        return t.length() > max ? t.substring(0, max - 1).trim() + "…" : t;
    }

    private static String nullIfBlank(String s) { return s == null || s.isBlank() ? null : s; }

    private static String oneOf(String v, String dflt, String... allowed) {
        String u = v == null ? "" : v.trim().toUpperCase(Locale.ROOT);
        for (String a : allowed) if (a.equals(u)) return a;
        return dflt;
    }

    static String hash(String s) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));
            StringBuilder b = new StringBuilder();
            for (int i = 0; i < 5; i++) b.append(String.format("%02x", d[i]));
            return b.toString();
        } catch (Exception e) {
            return Integer.toHexString(s.hashCode());
        }
    }

    private static Iterable<JsonNode> iter(JsonNode n) {
        if (n == null || !n.isArray()) return List.of();
        List<JsonNode> out = new ArrayList<>();
        n.forEach(out::add);
        return out;
    }
}

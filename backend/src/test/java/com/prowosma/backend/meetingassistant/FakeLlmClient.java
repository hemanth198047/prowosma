package com.prowosma.backend.meetingassistant;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.integration.LlmClient;

import java.util.*;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.BiFunction;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * SCRIPTED STAND-IN for a language model, used only by tests. It proves our prompting/validation/versioning logic;
 * it does NOT prove how a real model behaves. By default it answers well-formed analyses that cite the line numbers
 * it was shown, so a test can then break one aspect at a time.
 */
public class FakeLlmClient implements LlmClient {

    public record Call(String org, String system, String user, int maxTokens) {}

    private static final ObjectMapper OM = new ObjectMapper();
    private final List<Call> calls = new CopyOnWriteArrayList<>();
    public volatile String notReady = null;
    /** (call, 1-based call number) → result; may throw LlmException. */
    public volatile BiFunction<Call, Integer, Result> responder = null;

    public void reset() { calls.clear(); notReady = null; responder = null; }
    public List<Call> calls() { return calls; }

    @Override public String notReadyReason(String organizationId) { return notReady; }

    @Override
    public Result complete(String org, String system, String user, int maxOutputTokens) {
        if (notReady != null) throw new com.prowosma.backend.integration.LlmException(com.prowosma.backend.integration.LlmException.Kind.NOT_CONFIGURED, notReady);
        Call c = new Call(org, system, user, maxOutputTokens);
        calls.add(c);
        BiFunction<Call, Integer, Result> r = responder;
        return r != null ? r.apply(c, calls.size()) : ok(defaultJson(user));
    }

    public static Result ok(String json) { return new Result(json, 1000, 500, "FAKE", "fake-model", false); }
    public static Result truncated() { return new Result("{\"purpose\":", 1000, 500, "FAKE", "fake-model", true); }

    private static final Pattern LINE = Pattern.compile("(?m)^\\[(\\d+)\\] ");
    private static final Pattern EVIDENCE = Pattern.compile("\"evidence\":\\[([0-9,]*)\\]");

    public static List<Integer> seqsIn(String prompt) {
        List<Integer> out = new ArrayList<>();
        Matcher m = LINE.matcher(prompt);
        while (m.find()) out.add(Integer.parseInt(m.group(1)));
        return out;
    }

    static Map<String, Object> item(String text, Integer... ev) { return new LinkedHashMap<>(Map.of("text", text, "evidence", List.of(ev))); }

    /** Action-extraction prompts carry a <projects> block; everything else is the Phase 3 analysis. */
    public static boolean isActionsPrompt(String user) { return user.contains("<projects>"); }

    static Map<String, Object> action(String title, String kind, String owner, boolean self, String deadline, int... evidence) {
        Map<String, Object> a = new LinkedHashMap<>();
        a.put("title", title); a.put("kind", kind); a.put("type", "TASK"); a.put("owner", owner); a.put("ownerIsSpeaker", self);
        a.put("deadline", deadline); a.put("evidence", java.util.Arrays.stream(evidence).boxed().toList());
        return a;
    }

    public static String actionsJson(Object... actions) {
        try {
            return OM.writeValueAsString(Map.of("actions", List.of(actions), "proposedProjects", List.of(), "withdrawnActions", List.of()));
        } catch (Exception e) { throw new IllegalStateException(e); }
    }

    static String defaultActionsJson(String user) throws Exception {
        List<Integer> s = seqsIn(user);
        if (s.isEmpty()) return actionsJson();
        int first = s.get(0), mid = s.get(s.size() / 2), last = s.get(s.size() - 1);
        return actionsJson(action("Send the budget to finance", "COMMITMENT", "Priya Nair", false, "by Friday", first),
                action("Maybe hire a contractor", "SUGGESTION", null, false, null, mid),
                action("Handle the QA plan", "COMMITMENT", "I", true, null, last));
    }

    public static String defaultJson(String user) {
        try {
            if (isActionsPrompt(user)) return defaultActionsJson(user);
            Map<String, Object> d = new LinkedHashMap<>();
            if (user.contains("--- ANALYSIS")) {                                    // a merge request
                TreeSet<Integer> ev = new TreeSet<>();
                Matcher m = EVIDENCE.matcher(user);
                while (m.find()) for (String n : m.group(1).split(",")) if (!n.isBlank()) ev.add(Integer.parseInt(n));
                if (ev.isEmpty()) return "{}";
                d.put("topics", List.of(Map.of("title", "Merged topic", "points", List.of(item("Merged point", ev.first(), ev.last())))));
                d.put("decisions", List.of(item("Merged decision", ev.first())));
                return OM.writeValueAsString(d);
            }
            List<Integer> s = seqsIn(user);
            if (s.isEmpty()) return "{}";
            int first = s.get(0), mid = s.get(s.size() / 2), last = s.get(s.size() - 1);
            d.put("purpose", item("Plan the product launch", first));
            d.put("topics", List.of(Map.of("title", "Budget", "points", List.of(item("The budget is two million", first, mid), item("The timeline may slip a week", last)))));
            d.put("outcomes", List.of(item("Budget approved", mid)));
            d.put("decisions", List.of(Map.of("text", "Go with vendor A", "madeBy", "Priya", "evidence", List.of(mid))));
            d.put("actionItems", List.of(
                    Map.of("text", "Send the budget", "owner", "Priya", "deadline", "by Friday", "kind", "COMMITMENT", "evidence", List.of(first)),
                    Map.of("text", "Maybe hire a contractor", "kind", "SUGGESTION", "evidence", List.of(last))));
            d.put("risks", List.of(item("Vendor delay", last)));
            d.put("openQuestions", List.of(item("Who owns QA?", mid)));
            d.put("nextSteps", List.of(item("Review the plan next week", last)));
            return OM.writeValueAsString(d);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}

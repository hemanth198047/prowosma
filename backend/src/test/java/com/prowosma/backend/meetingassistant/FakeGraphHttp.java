package com.prowosma.backend.meetingassistant;

import com.prowosma.backend.integration.GraphHttp;

import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

/** SCRIPTED STAND-IN for Microsoft (sign-in + Graph), used only by tests. Proves our logic, not Microsoft's real behavior. */
public class FakeGraphHttp implements GraphHttp {

    public record Call(String method, String url, Map<String, String> headers, String body) {}
    private record Rule(String urlContains, Result response) {}

    private final List<Call> calls = new CopyOnWriteArrayList<>();
    private final List<Rule> rules = new CopyOnWriteArrayList<>();

    public void reset() { calls.clear(); rules.clear(); }

    /** Later rules win. */
    public FakeGraphHttp on(String urlContains, int status, String body) {
        rules.add(0, new Rule(urlContains, new Result(status, body)));
        return this;
    }

    public List<Call> calls() { return calls; }
    public long callsTo(String urlContains) { return calls.stream().filter(c -> c.url().contains(urlContains)).count(); }

    @Override
    public Result send(String method, String url, Map<String, String> headers, String body) {
        calls.add(new Call(method, url, headers, body));
        for (Rule r : rules) if (url.contains(r.urlContains())) return r.response();
        return new Result(404, "{}");
    }
}

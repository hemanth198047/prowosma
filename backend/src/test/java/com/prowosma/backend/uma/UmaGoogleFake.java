package com.prowosma.backend.uma;

import com.prowosma.backend.integration.GoogleHttp;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

/** SCRIPTED stand-in for Google's Meet REST API (tests only). Proves our wiring, not Google's behaviour. */
class UmaGoogleFake implements GoogleHttp {
    final List<String> urls = new CopyOnWriteArrayList<>();
    volatile Instant start = Instant.now();
    volatile Instant end = null;                 // null = meeting still running
    volatile String transcriptState = "FILE_GENERATED";

    void reset() { urls.clear(); start = Instant.now(); end = null; transcriptState = "FILE_GENERATED"; }

    @Override
    public Result send(String method, String url, Map<String, String> headers, String body) {
        urls.add(url);
        if (!"Bearer tok-123".equals(headers.get("Authorization"))) return new Result(401, "{}");
        if (url.contains("/entries")) return new Result(200, """
                {"transcriptEntries":[
                 {"participant":"conferenceRecords/c1/participants/p1","text":"Let's review the launch.","startTime":"%s"},
                 {"participant":"conferenceRecords/c1/participants/p2","text":"I will complete the authentication API by Friday.","startTime":"%s"},
                 {"participant":"conferenceRecords/c1/participants/p1","text":"Thanks Ravi.","startTime":"%s"}]}"""
                .formatted(start.plusSeconds(5), start.plusSeconds(10), start.plusSeconds(20)));
        if (url.contains("/participants")) return new Result(200, """
                {"participants":[{"name":"conferenceRecords/c1/participants/p1","signedinUser":{"displayName":"Priya Sharma"}},
                                 {"name":"conferenceRecords/c1/participants/p2","signedinUser":{"displayName":"Ravi Kumar"}}]}""");
        if (url.contains("/transcripts") && transcriptState == null) return new Result(200, "{\"transcripts\":[]}");     // transcription was off
        if (url.contains("/transcripts")) return new Result(200, """
                {"transcripts":[{"name":"conferenceRecords/c1/transcripts/t1","state":"%s","startTime":"%s"%s}]}"""
                .formatted(transcriptState, start, end == null ? "" : ",\"endTime\":\"" + end + "\""));
        if (url.contains("conferenceRecords?")) return new Result(200, """
                {"conferenceRecords":[{"name":"conferenceRecords/c1","startTime":"%s"%s}]}"""
                .formatted(start, end == null ? "" : ",\"endTime\":\"" + end + "\""));
        return new Result(404, "{}");
    }
}

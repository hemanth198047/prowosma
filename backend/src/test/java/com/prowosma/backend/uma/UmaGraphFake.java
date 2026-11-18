package com.prowosma.backend.uma;

import com.prowosma.backend.integration.GraphHttp;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

/** SCRIPTED stand-in for Microsoft's sign-in and Graph (tests only). Proves our wiring and rules, not Microsoft's behaviour. */
class UmaGraphFake implements GraphHttp {
    record Req(String method, String url, Map<String, String> headers, String body) {}
    final List<Req> requests = new CopyOnWriteArrayList<>();
    volatile String tokenError = null;                 // e.g. an AADSTS65001 error description
    volatile String transcripts = "[]";                // the meeting's transcripts list (JSON array)
    volatile String vtt = "";
    volatile boolean meetingFound = true;
    volatile boolean grantTranscripts = true;

    void reset() { requests.clear(); tokenError = null; transcripts = "[]"; vtt = ""; meetingFound = true; grantTranscripts = true; }

    @Override
    public Result send(String method, String url, Map<String, String> headers, String body) {
        requests.add(new Req(method, url, headers, body));
        if (url.startsWith("https://login.microsoftonline.com/")) {
            if (tokenError != null) return new Result(400, "{\"error\":\"invalid_grant\",\"error_description\":\"" + tokenError + "\"}");
            String claims = Base64.getUrlEncoder().withoutPadding().encodeToString(
                    "{\"preferred_username\":\"owner@contoso.test\",\"tid\":\"11111111-2222-3333-4444-555555555555\"}".getBytes(StandardCharsets.UTF_8));
            String scope = "openid email offline_access User.Read Calendars.ReadWrite OnlineMeetings.ReadWrite" + (grantTranscripts ? " OnlineMeetingTranscript.Read.All" : "");
            return new Result(200, "{\"access_token\":\"ms-tok\",\"refresh_token\":\"ms-ref\",\"expires_in\":3600,\"scope\":\"" + scope
                    + "\",\"id_token\":\"x." + claims + ".y\"}");
        }
        if (!"Bearer ms-tok".equals(headers.get("Authorization"))) return new Result(401, "{}");
        if (method.equals("POST") && url.equals("https://graph.microsoft.com/v1.0/me/events"))
            return new Result(201, "{\"id\":\"evt-1\",\"webLink\":\"https://outlook.office.com/calendar/item/evt-1\","
                    + "\"onlineMeeting\":{\"joinUrl\":\"https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0\"}}");
        if (url.startsWith("https://graph.microsoft.com/v1.0/me/onlineMeetings?$filter="))
            return new Result(200, meetingFound ? "{\"value\":[{\"id\":\"MSo1N2Y5ZGFjYy03MWJmLTQ3NDMtYjQxMy01M2EdFGkdRWHJlQ\"}]}" : "{\"value\":[]}");
        if (url.endsWith("/transcripts")) return new Result(200, "{\"value\":" + transcripts + "}");
        if (url.contains("/transcripts/") && url.contains("/content")) return new Result(200, vtt);
        return new Result(404, "{}");
    }
}

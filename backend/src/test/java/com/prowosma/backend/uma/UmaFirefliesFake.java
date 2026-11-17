package com.prowosma.backend.uma;

import com.prowosma.backend.integration.FirefliesHttp;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/** SCRIPTED stand-in for Fireflies' GraphQL API (tests only). Proves our wiring, not Fireflies' behaviour. */
class UmaFirefliesFake implements FirefliesHttp {
    final List<String> requests = new CopyOnWriteArrayList<>();
    volatile boolean live = false;          // the meeting is still running in Fireflies
    volatile String meetingLink = "https://meet.google.com/abc-defg-hij";
    volatile String date = "2026-11-16T09:00:00.000Z";

    void reset() { requests.clear(); live = false; meetingLink = "https://meet.google.com/abc-defg-hij"; date = "2026-11-16T09:00:00.000Z"; }

    @Override
    public Result post(String body, String apiKey) {
        requests.add(body);
        if (!"ff-good-key".equals(apiKey)) return new Result(200, "{\"errors\":[{\"code\":\"auth_failed\",\"message\":\"bad key\"}]}");
        if (body.contains("user {")) return new Result(200, "{\"data\":{\"user\":{\"name\":\"Ops Team\",\"email\":\"ops@acme.test\"}}}");
        if (body.contains("addToLiveMeeting")) return new Result(200, "{\"data\":{\"addToLiveMeeting\":{\"success\":true}}}");
        String head = "{\"id\":\"FFabc123\",\"title\":\"Weekly sync\",\"dateString\":\"" + date + "\",\"date\":" + java.time.Instant.parse(date).toEpochMilli()
                + ",\"duration\":1.5,\"meeting_link\":\"" + meetingLink + "\",\"is_live\":" + live;
        if (body.contains("transcripts(limit")) return new Result(200, "{\"data\":{\"transcripts\":[" + head + "}]}}");
        if (body.contains("transcript(id")) {
            String sentences = live ? "[]" : "[{\"speaker_name\":\"Priya Sharma\",\"text\":\"Let's review the launch.\",\"start_time\":1.0,\"end_time\":3.0},"
                    + "{\"speaker_name\":\"Ravi Kumar\",\"text\":\"I will complete the authentication API by Friday.\",\"start_time\":4.0,\"end_time\":8.0},"
                    + "{\"speaker_name\":\"Priya Sharma\",\"text\":\"Thanks Ravi.\",\"start_time\":9.0,\"end_time\":10.0}]";
            return new Result(200, "{\"data\":{\"transcript\":" + head + ",\"sentences\":" + sentences + "}}}");
        }
        return new Result(400, "{}");
    }
}

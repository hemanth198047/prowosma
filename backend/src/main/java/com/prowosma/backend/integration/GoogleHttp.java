package com.prowosma.backend.integration;

import java.io.IOException;
import java.util.Map;

/** The only door to Google. A seam so tests can script responses and so outbound hosts are policed in one place. */
public interface GoogleHttp {

    record Result(int status, String body) {}

    Result send(String method, String url, Map<String, String> headers, String body) throws IOException;
}

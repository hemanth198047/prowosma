package com.prowosma.backend.integration;

import java.io.IOException;
import java.util.Map;

/** Transport seam for model providers, so tests can script responses and outbound hosts are policed in one place. */
public interface LlmHttp {

    record Result(int status, String body) {}

    Result send(String method, String url, Map<String, String> headers, String body, boolean allowPrivateHosts) throws IOException;
}

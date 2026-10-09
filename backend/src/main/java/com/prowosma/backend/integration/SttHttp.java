package com.prowosma.backend.integration;

import java.io.IOException;
import java.util.Map;

/** The only door to a speech-to-text server — a seam so tests can script replies and the address policy is applied in one place. */
public interface SttHttp {

    record Result(int status, String body) {}

    Result post(String url, Map<String, String> headers, byte[] body, boolean allowPrivateHosts) throws IOException;
}

package com.prowosma.backend.integration;

import java.io.IOException;

/** The only door to Fireflies — a seam so tests can script answers. The address is fixed in the implementation; callers can't choose where a key is sent. */
public interface FirefliesHttp {

    record Result(int status, String body) {}

    Result post(String jsonBody, String apiKey) throws IOException;
}

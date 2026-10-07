package com.prowosma.backend.service;

import org.springframework.http.HttpStatus;

import java.util.Map;

/** A user-facing failure: {@code code} is machine-readable, {@code message} is plain language safe to show. */
public class MeetingAssistantException extends RuntimeException {
    private final HttpStatus status;
    private final String code;
    private final Map<String, Object> extras;

    public MeetingAssistantException(HttpStatus status, String code, String message) {
        this(status, code, message, Map.of());
    }

    public MeetingAssistantException(HttpStatus status, String code, String message, Map<String, Object> extras) {
        super(message);
        this.status = status;
        this.code = code;
        this.extras = extras;
    }

    public HttpStatus getStatus() { return status; }
    public String getCode() { return code; }
    public Map<String, Object> getExtras() { return extras; }
}

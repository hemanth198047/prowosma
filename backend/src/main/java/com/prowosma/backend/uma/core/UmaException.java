package com.prowosma.backend.uma.core;

import org.springframework.http.HttpStatus;

/** An error a person can act on: a stable code, a plain message, and (when there is one) what to do next. */
public class UmaException extends RuntimeException {
    private final HttpStatus status;
    private final String code;
    private final String recovery;

    public UmaException(HttpStatus status, String code, String message) { this(status, code, message, null); }

    public UmaException(HttpStatus status, String code, String message, String recovery) {
        super(message);
        this.status = status;
        this.code = code;
        this.recovery = recovery;
    }

    public HttpStatus getStatus() { return status; }
    public String getCode() { return code; }
    public String getRecovery() { return recovery; }

    public static UmaException notFound() {
        return new UmaException(HttpStatus.NOT_FOUND, "NOT_FOUND", "That meeting doesn't exist, or you don't have access to it.");
    }
}

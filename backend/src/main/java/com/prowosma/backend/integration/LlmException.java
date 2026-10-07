package com.prowosma.backend.integration;

/** A failed AI call. Messages are plain language and never include provider response bodies or keys. */
public class LlmException extends RuntimeException {

    public enum Kind { NOT_CONFIGURED, AUTH, RATE_LIMITED, SERVER, NETWORK, BAD_RESPONSE, INPUT_TOO_LARGE }

    private final Kind kind;

    public LlmException(Kind kind, String message) {
        super(message);
        this.kind = kind;
    }

    public Kind getKind() { return kind; }

    public boolean isTransient() { return kind == Kind.RATE_LIMITED || kind == Kind.SERVER || kind == Kind.NETWORK; }
}

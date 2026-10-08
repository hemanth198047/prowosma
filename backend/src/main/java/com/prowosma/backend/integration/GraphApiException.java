package com.prowosma.backend.integration;

/** A failed call to Microsoft. {@code code} is a short, safe identifier; messages never carry response bodies, tokens or secrets. */
public class GraphApiException extends RuntimeException {

    public enum Kind { UNAUTHORIZED, FORBIDDEN, TRANSCRIPTS_DISABLED, NOT_FOUND, RATE_LIMITED, SERVER, BAD_RESPONSE, NETWORK, TOO_LARGE }

    private final Kind kind;
    private final String code;

    public GraphApiException(Kind kind, String code, String message) {
        super(message);
        this.kind = kind;
        this.code = code;
    }

    public Kind getKind() { return kind; }
    public String getCode() { return code; }

    public boolean isTransient() { return kind == Kind.RATE_LIMITED || kind == Kind.SERVER || kind == Kind.NETWORK; }
}

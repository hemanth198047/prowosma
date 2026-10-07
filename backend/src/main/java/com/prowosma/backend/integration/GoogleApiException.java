package com.prowosma.backend.integration;

/** A failed call to Google. {@code kind} drives retry-or-give-up decisions; the message never carries response bodies. */
public class GoogleApiException extends RuntimeException {

    public enum Kind { UNAUTHORIZED, FORBIDDEN, NOT_FOUND, RATE_LIMITED, SERVER, BAD_RESPONSE, NETWORK, TOO_LARGE }

    private final Kind kind;

    public GoogleApiException(Kind kind, String message) {
        super(message);
        this.kind = kind;
    }

    public Kind getKind() { return kind; }

    /** Worth trying again later. */
    public boolean isTransient() {
        return kind == Kind.RATE_LIMITED || kind == Kind.SERVER || kind == Kind.NETWORK;
    }
}

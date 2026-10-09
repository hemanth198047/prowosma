package com.prowosma.backend.integration;

/** A failed speech-to-text call. Messages are plain language and never contain keys, audio or the server's raw reply. */
public class SttException extends RuntimeException {

    public enum Kind {
        AUTH,          // the key was rejected — fix the setting
        NOT_FOUND,     // wrong address or model name — fix the setting
        BAD_INPUT,     // the server refused this audio or the address isn't allowed — won't succeed by retrying
        TRANSIENT,     // busy, overloaded, down or slow — worth retrying
        BAD_RESPONSE   // the server answered with something we can't read
    }

    private final Kind kind;

    public SttException(Kind kind, String message) {
        super(message);
        this.kind = kind;
    }

    public Kind getKind() { return kind; }

    public boolean isTransient() { return kind == Kind.TRANSIENT; }
}

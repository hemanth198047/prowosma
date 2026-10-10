package com.prowosma.backend.integration;

import java.time.Instant;

/** A failed Fireflies call. Messages are plain language and never include the API key or the service's own wording. */
public class FirefliesException extends RuntimeException {

    public enum Kind {
        AUTH,                  // the key was rejected
        PLAN,                  // the plan or account doesn't allow it (free plan, cancelled account, no permission)
        RATE_LIMITED,          // wait, then retry — never a failure of the meeting
        UNSUPPORTED_PLATFORM,  // Fireflies can't join that kind of meeting
        NOT_FOUND,             // no such transcript, or no access
        BAD_REQUEST,           // refused the request (for example the meeting isn't running)
        TRANSIENT,             // down, slow, or a network problem
        BAD_RESPONSE           // an answer we can't read
    }

    private final Kind kind;
    private final Instant retryAfter;

    public FirefliesException(Kind kind, String message) { this(kind, message, null); }

    public FirefliesException(Kind kind, String message, Instant retryAfter) {
        super(message);
        this.kind = kind;
        this.retryAfter = retryAfter;
    }

    public Kind getKind() { return kind; }

    /** When Fireflies said requests may resume, if it said. */
    public Instant getRetryAfter() { return retryAfter; }

    public boolean isTransient() { return kind == Kind.TRANSIENT || kind == Kind.RATE_LIMITED; }
}

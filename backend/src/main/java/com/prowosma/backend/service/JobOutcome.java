package com.prowosma.backend.service;

import java.time.Instant;

/** What a job handler decided: finished, run again later, or give up with a message a person can act on. */
public record JobOutcome(Kind kind, Instant retryAt, boolean isError, String code, String message, String recovery) {

    public enum Kind { DONE, RETRY, FAIL }

    public static JobOutcome done() { return new JobOutcome(Kind.DONE, null, false, null, null, null); }

    /** Keep waiting (e.g. the meeting hasn't ended). Does not count as an error. */
    public static JobOutcome poll(Instant at, String code) { return new JobOutcome(Kind.RETRY, at, false, code, null, null); }

    /** A transient problem; consecutive ones are bounded. */
    public static JobOutcome retryError(Instant at, String code) { return new JobOutcome(Kind.RETRY, at, true, code, null, null); }

    public static JobOutcome fail(String code, String message, String recovery) {
        return new JobOutcome(Kind.FAIL, null, true, code, message, recovery);
    }
}

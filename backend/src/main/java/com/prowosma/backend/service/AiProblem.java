package com.prowosma.backend.service;

/**
 * Something stopped an AI feature, described for the person using it: what happened, in plain words ({@link #getMessage()}),
 * and what they can do about it ({@link #getHint()}). {@code kind} lets the page choose how to show it.
 */
public class AiProblem extends RuntimeException {
    private final String kind;
    private final String hint;

    public AiProblem(String kind, String message, String hint) {
        super(message);
        this.kind = kind;
        this.hint = hint;
    }

    public String getKind() { return kind; }
    public String getHint() { return hint; }
}

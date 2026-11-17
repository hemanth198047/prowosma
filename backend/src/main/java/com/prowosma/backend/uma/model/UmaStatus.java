package com.prowosma.backend.uma.model;

import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

/**
 * Where a meeting is in the Universal Meeting Assistant pipeline.
 *
 * <pre>
 * CREATED ──(capture starts)──► CAPTURING ──► QUEUED
 * CREATED ──(recording uploaded)──────────────► QUEUED ──► TRANSCRIBING ──► ANALYZING ──► REVIEW_READY ──► COMPLETED
 * CREATED ──(transcript imported)───────────────────────────────────────► ANALYZING
 * any working state ──► FAILED ──(retry: resumes at the failed stage)──► QUEUED / ANALYZING
 * any state except COMPLETED ──► CANCELLED
 * REVIEW_READY / COMPLETED ──(regenerate, transcript edited)──► ANALYZING
 * </pre>
 *
 * The prompt's simplified chain CREATED → CAPTURING → PROCESSING → REVIEW_READY → COMPLETED maps to this with
 * PROCESSING = QUEUED | TRANSCRIBING | ANALYZING (shown to people as one "Processing" step with a progress line).
 */
public enum UmaStatus {
    CREATED, CAPTURING, QUEUED, TRANSCRIBING, ANALYZING, REVIEW_READY, COMPLETED, FAILED, CANCELLED;

    private static final Map<UmaStatus, Set<UmaStatus>> NEXT = Map.of(
            CREATED, EnumSet.of(CAPTURING, QUEUED, ANALYZING, FAILED, CANCELLED),
            CAPTURING, EnumSet.of(QUEUED, FAILED, CANCELLED),
            QUEUED, EnumSet.of(TRANSCRIBING, FAILED, CANCELLED),
            TRANSCRIBING, EnumSet.of(QUEUED, ANALYZING, FAILED, CANCELLED),       // QUEUED: lease lost / restart, picked up again
            ANALYZING, EnumSet.of(REVIEW_READY, FAILED, CANCELLED, ANALYZING),
            REVIEW_READY, EnumSet.of(COMPLETED, ANALYZING, CANCELLED),
            COMPLETED, EnumSet.of(ANALYZING, REVIEW_READY),
            FAILED, EnumSet.of(QUEUED, ANALYZING, CANCELLED, CREATED),       // CREATED: wait for a notetaker's transcript again
            CANCELLED, EnumSet.noneOf(UmaStatus.class));

    public boolean canMoveTo(UmaStatus to) { return NEXT.get(this).contains(to); }

    /** Work is in progress (the page keeps refreshing). */
    public boolean isWorking() { return this == QUEUED || this == TRANSCRIBING || this == ANALYZING || this == CAPTURING; }

    /** One word for people. */
    public String label() {
        return switch (this) {
            case CREATED -> "Waiting for content";
            case CAPTURING -> "Capturing";
            case QUEUED, TRANSCRIBING, ANALYZING -> "Processing";
            case REVIEW_READY -> "Ready for review";
            case COMPLETED -> "Completed";
            case FAILED -> "Needs attention";
            case CANCELLED -> "Cancelled";
        };
    }
}

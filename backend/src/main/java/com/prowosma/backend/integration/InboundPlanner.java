package com.prowosma.backend.integration;

/** Decides what an event means for the task it may already have opened. */
public final class InboundPlanner {

    public enum Plan { CREATE, REOPEN, RESOLVE, NOTHING }

    private InboundPlanner() {}

    /** @param existingStatus status of the task already tracking this problem, or null if none. */
    public static Plan plan(InboundEvent.Action action, String existingStatus) {
        boolean exists = existingStatus != null;
        boolean done = exists && "DONE".equalsIgnoreCase(existingStatus);
        switch (action) {
            case OPEN:
                if (!exists) return Plan.CREATE;
                return done ? Plan.REOPEN : Plan.NOTHING;      // already open: a repeat, not a new problem
            case RESOLVE:
                return exists && !done ? Plan.RESOLVE : Plan.NOTHING;
            default:
                return Plan.NOTHING;
        }
    }
}

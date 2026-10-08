package com.prowosma.backend.meetingassistant;

/**
 * What AUTOMATIC creation may do on its own. It is deliberately stricter than "approved by a person": an automatic task needs an
 * agreed commitment with cited evidence, a reliably identified owner, a project, and a reliable-or-absent deadline — otherwise it
 * stays in review. Anything a person rejected, edited into doubt, flagged, or that a re-run is questioning is left alone.
 */
public final class AutoCreateRules {

    private AutoCreateRules() {}

    /** The reserved, non-login identity that automatic creation acts as (it has no password and no user record). */
    public static final String SYSTEM_ACTOR = "meeting-assistant@system.prowosma";

    public record TaskFacts(String status, String kind, boolean valid, boolean ownerAssigned, boolean duplicate, boolean missingFromLatestRun,
                            boolean withdrawn, int evidenceCount, String projectState, boolean newProjectReady) {}

    public static boolean taskEligible(TaskFacts f) {
        if (!"PROPOSED".equals(f.status()) && !"APPROVED".equals(f.status())) return false;      // rejected, merged, withdrawn, created: never
        if (!"COMMITMENT".equals(f.kind()) || f.withdrawn() || f.duplicate() || f.missingFromLatestRun()) return false;
        if (!f.valid() || f.evidenceCount() < 1 || !f.ownerAssigned()) return false;              // reliable identity required
        return switch (f.projectState() == null ? "" : f.projectState()) {
            case "EXISTING", "MANUAL" -> true;
            case "PROPOSED_NEW" -> f.newProjectReady();
            default -> false;
        };
    }

    public record ProjectFacts(String status, String name, String description, int evidenceCount) {}

    public static boolean projectEligible(ProjectFacts f) {
        return "PROPOSED".equals(f.status()) && f.name() != null && f.name().trim().length() >= 2
                && f.description() != null && !f.description().isBlank() && f.evidenceCount() >= 1;
    }
}

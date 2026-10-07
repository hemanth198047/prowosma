package com.prowosma.backend.meetingassistant;

import java.util.ArrayList;
import java.util.List;

/**
 * Decides — from facts, never from the model's say-so — why an action needs a person's attention, how confident the proposal is,
 * and whether it is "valid" for bulk approval. Valid means: agreed in the meeting, not withdrawn, not a suspected duplicate, attached to
 * a project, with a reliable (or absent) deadline. An unassigned owner is allowed — an explicit "unassigned" is better than a wrong owner.
 */
public final class ReviewRules {

    private ReviewRules() {}

    public record Reason(String code, String message, boolean blocking) {}
    public record Input(String kind, boolean withdrawn, String ownerState, String ownerCandidates, String deadlineStatus, boolean hasDeadlineText,
                        String projectState, boolean projectDiffers, boolean projectProposedNew, boolean proposedProjectApproved, boolean duplicate,
                        boolean missingFromLatestRun) {}
    public record Outcome(List<Reason> reasons, String confidence, boolean valid) {}

    public static Outcome evaluate(Input in) {
        List<Reason> r = new ArrayList<>();
        if (in.withdrawn()) r.add(new Reason("WITHDRAWN", "This was withdrawn or corrected later in the meeting.", true));
        if ("SUGGESTION".equals(in.kind())) r.add(new Reason("NOT_AGREED", "This was suggested, not agreed.", true));
        if ("UNRESOLVED".equals(in.kind())) r.add(new Reason("NOT_SETTLED", "This wasn't settled in the meeting.", true));
        if (in.duplicate()) r.add(new Reason("DUPLICATE_SUSPECTED", "This looks like another action in this meeting. Merge them or keep both.", true));
        if (in.missingFromLatestRun()) r.add(new Reason("MISSING_FROM_RERUN", "The latest analysis no longer found this. Check it still applies.", true));

        switch (in.ownerState() == null ? "UNSPECIFIED" : in.ownerState()) {
            case "UNSPECIFIED" -> r.add(new Reason("OWNER_UNSPECIFIED", "No owner was named.", false));
            case "TEAM" -> r.add(new Reason("OWNER_TEAM", "It was given to a group, not a person. Pick who will do it.", false));
            case "AMBIGUOUS" -> r.add(new Reason("OWNER_AMBIGUOUS", "More than one person matches the name: " + in.ownerCandidates() + ". Pick one.", false));
            case "SUGGESTED" -> r.add(new Reason("OWNER_SUGGESTED", "The name partly matches " + in.ownerCandidates() + ". Confirm who it is.", false));
            case "NOT_IN_DIRECTORY" -> r.add(new Reason("OWNER_NOT_IN_DIRECTORY", "The named person isn't in your directory (maybe an outside attendee).", false));
            case "NOT_ELIGIBLE" -> r.add(new Reason("OWNER_NOT_ELIGIBLE", "The named person is a read-only member and can't be assigned work.", false));
            default -> { /* RESOLVED, MANUAL */ }
        }

        boolean deadlineBlocks = false;
        String ds = in.deadlineStatus() == null ? "UNRESOLVED" : in.deadlineStatus();
        if (!in.hasDeadlineText()) r.add(new Reason("DEADLINE_MISSING", "No deadline was mentioned.", false));
        else if (ds.equals("AMBIGUOUS")) { r.add(new Reason("DEADLINE_AMBIGUOUS", "The deadline can be read more than one way. Choose the date.", true)); deadlineBlocks = true; }
        else if (ds.equals("APPROXIMATE")) { r.add(new Reason("DEADLINE_APPROXIMATE", "The deadline was interpreted (not stated as a date). Confirm it.", true)); deadlineBlocks = true; }
        else if (ds.equals("UNRESOLVED")) { r.add(new Reason("DEADLINE_UNCLEAR", "The deadline wording couldn't be turned into a date.", true)); deadlineBlocks = true; }

        boolean projectOk = "EXISTING".equals(in.projectState()) || "MANUAL".equals(in.projectState())
                || ("PROPOSED_NEW".equals(in.projectState()) && in.proposedProjectApproved());
        if ("PROPOSED_NEW".equals(in.projectState()) && !in.proposedProjectApproved())
            r.add(new Reason("PROJECT_NEEDS_APPROVAL", "It belongs to a new project that hasn't been approved yet.", true));
        else if ("AMBIGUOUS".equals(in.projectState())) r.add(new Reason("PROJECT_AMBIGUOUS", "More than one project has that name. Pick one.", true));
        else if (!projectOk) r.add(new Reason("PROJECT_UNRESOLVED", "No project was identified. Pick one.", true));
        if (in.projectDiffers()) r.add(new Reason("PROJECT_DIFFERS_FROM_SELECTED", "The discussion named a different project from the one you selected. Confirm.", true));

        boolean blocking = r.stream().anyMatch(Reason::blocking);
        boolean valid = !blocking && "COMMITMENT".equals(in.kind()) && !in.withdrawn() && projectOk && !deadlineBlocks;

        boolean ownerOk = "RESOLVED".equals(in.ownerState()) || "MANUAL".equals(in.ownerState());
        boolean deadlineOk = in.hasDeadlineText() && (ds.equals("EXACT") || ds.equals("RESOLVED") || ds.equals("MANUAL"));
        String confidence;
        if (!"COMMITMENT".equals(in.kind()) || in.withdrawn() || in.duplicate()) confidence = "LOW";
        else if (ownerOk && deadlineOk && projectOk) confidence = "HIGH";
        else if (!ownerOk && !deadlineOk) confidence = "LOW";
        else confidence = "MEDIUM";
        return new Outcome(r, confidence, valid);
    }
}

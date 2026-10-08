package com.prowosma.backend.meetingassistant;

import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Text and field mapping for records created from a meeting, so every task and project points back to the meeting and its evidence. */
public final class CreationText {

    private CreationText() {}

    public static final int MAX_DESCRIPTION = 4000;
    private static final Set<String> TASK_TYPES = Set.of("TASK", "BUG");

    /** "— Created from meeting “Weekly sync”. Evidence: transcript lines [#1] [#3-4]. Open: /meeting-assistant?session=abc" */
    public static String footer(String meetingTitle, List<Integer> evidence, String sessionId) {
        String title = meetingTitle == null ? "Meeting" : meetingTitle.replace("[SIMULATED] ", "").replaceAll("[\\p{Cntrl}]", " ").strip();
        String ev = evidence == null || evidence.isEmpty() ? "" : " Evidence: transcript lines " + Evidence.format(evidence) + ".";
        return "— Created from meeting “" + title + "”." + ev + " Open: /meeting-assistant?session=" + sessionId;
    }

    /** Description + dependencies (free text — they can't be linked to tasks) + the footer, never longer than the limit; the footer always survives. */
    public static String description(String description, List<String> dependencies, String footer) {
        StringBuilder b = new StringBuilder();
        if (description != null && !description.isBlank()) b.append(description.strip());
        if (dependencies != null && !dependencies.isEmpty()) {
            if (b.length() > 0) b.append("\n\n");
            b.append("Depends on: ").append(String.join("; ", dependencies)).append('.');
        }
        String tail = (b.length() > 0 ? "\n\n" : "") + footer;
        int room = MAX_DESCRIPTION - tail.length();
        if (b.length() > room) { b.setLength(Math.max(0, room - 1)); b.append('…'); }
        return b + tail;
    }

    /** Meeting action types map onto the app's task types; anything unusual is a plain TASK. */
    public static String taskType(String actionType) {
        String t = actionType == null ? "" : actionType.toUpperCase(Locale.ROOT);
        return TASK_TYPES.contains(t) ? t : "TASK";
    }
}

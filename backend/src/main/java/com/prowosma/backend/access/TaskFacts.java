package com.prowosma.backend.access;

import java.util.Collection;
import java.util.HashSet;
import java.util.Set;

/** The facts about a task that visibility depends on. Assignees are TeamMember ids; watchers and creator are emails. */
public record TaskFacts(String projectId, Set<String> assigneeIds, Set<String> watcherEmails, String creatorEmail) {

    public static TaskFacts of(String projectId, Collection<String> assigneeIds,
                               Collection<String> watchers, String creatorEmail) {
        Set<String> a = new HashSet<>();
        if (assigneeIds != null) for (String s : assigneeIds) if (s != null && !s.isBlank()) a.add(s);
        Set<String> w = new HashSet<>();
        if (watchers != null) for (String s : watchers) { String n = AccessConstants.norm(s); if (!n.isEmpty()) w.add(n); }
        return new TaskFacts(projectId, Set.copyOf(a), Set.copyOf(w), AccessConstants.norm(creatorEmail));
    }
}

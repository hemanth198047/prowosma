package com.prowosma.backend.access;

import java.util.Collection;
import java.util.HashSet;
import java.util.Set;

/** The facts about a project that visibility depends on, detached from the Mongo entity. */
public record ProjectFacts(String id, String visibility, Set<String> departmentIds,
                           Set<String> involvedEmails, String creatorEmail) {

    /**
     * @param involved everyone named on the project: members, role-slot holders, approvers. The
     *                 creator is added automatically.
     */
    public static ProjectFacts of(String id, String visibility, Collection<String> departmentIds,
                                  Collection<String> involved, String creatorEmail) {
        String vis = AccessConstants.normalizeVisibility(visibility);
        if (vis == null) vis = AccessConstants.VIS_MEMBERS; // unknown value: fail closed
        Set<String> depts = new HashSet<>();
        if (departmentIds != null) for (String d : departmentIds) if (d != null && !d.isBlank()) depts.add(d);
        Set<String> inv = new HashSet<>();
        if (involved != null) for (String e : involved) { String n = AccessConstants.norm(e); if (!n.isEmpty()) inv.add(n); }
        String creator = AccessConstants.norm(creatorEmail);
        if (!creator.isEmpty()) inv.add(creator);
        return new ProjectFacts(id, vis, Set.copyOf(depts), Set.copyOf(inv), creator);
    }
}

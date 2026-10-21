package com.prowosma.backend.access;

import java.util.Collection;
import java.util.HashSet;
import java.util.Set;

/** The facts about a document that visibility depends on. */
public record DocFacts(String creatorEmail, String audience, Set<String> departmentIds, Set<String> sharedWith) {

    /** @param audience null for a legacy doc; an unrecognised value is kept as "?" and matches nothing (fail closed) */
    public static DocFacts of(String creatorEmail, String audience, Collection<String> departmentIds, Collection<String> sharedWith) {
        Set<String> d = new HashSet<>();
        if (departmentIds != null) for (String x : departmentIds) if (x != null && !x.isBlank()) d.add(x);
        Set<String> s = new HashSet<>();
        if (sharedWith != null) for (String x : sharedWith) { String n = AccessConstants.norm(x); if (!n.isEmpty()) s.add(n); }
        return new DocFacts(AccessConstants.norm(creatorEmail), AccessConstants.normalizeAudience(audience), Set.copyOf(d), Set.copyOf(s));
    }
}

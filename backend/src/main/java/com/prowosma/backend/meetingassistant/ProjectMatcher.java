package com.prowosma.backend.meetingassistant;

import java.util.List;

/**
 * Chooses the existing project an action belongs to. Order of preference: a project the discussion explicitly named, then the
 * project the person selected when registering the meeting. Otherwise it stays UNRESOLVED — a new project is never invented here.
 */
public final class ProjectMatcher {

    private ProjectMatcher() {}

    public record Proj(String id, String name, String status) {}

    /** state: EXISTING | AMBIGUOUS | UNRESOLVED; basis: NAMED | SELECTED */
    public record Match(String state, String basis, Proj project, List<Proj> candidates, boolean differsFromSelected) {}

    public static Match resolve(String namedProject, Proj selected, List<Proj> all) {
        if (namedProject != null && !namedProject.isBlank()) {
            String n = NameMatcher.norm(namedProject);
            List<Proj> hits = all.stream().filter(p -> NameMatcher.norm(p.name()).equals(n)).toList();
            if (hits.size() == 1) {
                boolean differs = selected != null && !selected.id().equals(hits.get(0).id());
                return new Match("EXISTING", "NAMED", hits.get(0), hits, differs);
            }
            if (hits.size() > 1) return new Match("AMBIGUOUS", null, null, hits, false);
        }
        if (selected != null) return new Match("EXISTING", "SELECTED", selected, List.of(selected), false);
        return new Match("UNRESOLVED", null, null, List.of(), false);
    }

    /** True if a proposed new project's name is already an existing project (so it must not be proposed again). */
    public static Proj existingNamed(String name, List<Proj> all) {
        String n = NameMatcher.norm(name);
        List<Proj> hits = all.stream().filter(p -> NameMatcher.norm(p.name()).equals(n)).toList();
        return hits.size() == 1 ? hits.get(0) : null;
    }
}

package com.prowosma.backend.meetingassistant;

import java.text.Normalizer;
import java.util.*;

/**
 * Matches a name as SPOKEN (or as a platform label) to people in the organization's directory.
 * Policy: only an EXACT, UNIQUE match to a full name (or an exact email) is treated as resolved. A first name or partial name is
 * only ever a SUGGESTION a person must confirm; duplicates are AMBIGUOUS; unknown names stay unknown. Nothing is guessed from
 * voice, and nobody is ever created from a name.
 */
public final class NameMatcher {

    private NameMatcher() {}

    public record Person(String id, String name, String email, String role) {}

    /**
     * state: RESOLVED | AMBIGUOUS | SUGGESTED | NOT_IN_DIRECTORY | NOT_ELIGIBLE | TEAM | UNSPECIFIED
     * basis: EXACT_NAME | EMAIL (for RESOLVED)
     */
    public record Match(String state, String basis, Person person, List<Person> candidates) {}

    private static final Set<String> GENERIC = Set.of("we", "us", "all", "everyone", "everybody", "someone", "somebody", "anyone", "anybody",
            "nobody", "tbd", "tba", "unassigned", "team", "the team", "n a", "na", "none", "unknown", "to be decided", "to be determined", "group", "whole team");

    /** lower-case, accents removed, punctuation → space, single spaces. */
    public static String norm(String s) {
        if (s == null) return "";
        String d = Normalizer.normalize(s, Normalizer.Form.NFD).replaceAll("\\p{M}+", "");
        return d.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}@.]+", " ").replaceAll("(?<![\\p{L}\\p{N}])\\.|\\.(?![\\p{L}\\p{N}])", " ")
                .replaceAll("\\s+", " ").trim();
    }

    public static boolean isGeneric(String spoken) {
        String n = norm(spoken);
        if (n.isEmpty()) return false;
        if (GENERIC.contains(n)) return true;
        for (String tok : n.split(" ")) if (tok.equals("team") || tok.equals("everyone") || tok.equals("everybody") || tok.equals("someone") || tok.equals("somebody")) return true;
        return false;
    }

    /** Roles that may not be assigned work (read-only members). */
    public static boolean eligible(Person p) { return !"VIEWER".equalsIgnoreCase(p.role()); }

    public static Match resolve(String spoken, List<Person> directory) {
        String n = norm(spoken);
        if (n.isEmpty()) return new Match("UNSPECIFIED", null, null, List.of());
        if (isGeneric(spoken)) return new Match("TEAM", null, null, List.of());

        if (n.contains("@")) {                                                                 // exact email
            List<Person> byEmail = directory.stream().filter(p -> p.email() != null && norm(p.email()).equals(n)).toList();
            if (byEmail.size() == 1) return fromExact(byEmail.get(0), "EMAIL");
            if (byEmail.size() > 1) return new Match("AMBIGUOUS", null, null, byEmail);
        }
        List<Person> exact = directory.stream().filter(p -> !norm(p.name()).isEmpty() && norm(p.name()).equals(n)).toList();
        if (exact.size() == 1) return fromExact(exact.get(0), "EXACT_NAME");
        if (exact.size() > 1) return new Match("AMBIGUOUS", null, null, exact);                // two people share this full name

        // partial / first-name-only: never auto-assigned, only suggested
        Set<String> spokenTokens = new LinkedHashSet<>(Arrays.asList(n.split(" ")));
        List<Person> partial = directory.stream().filter(p -> {
            Set<String> tokens = new HashSet<>(Arrays.asList(norm(p.name()).split(" ")));
            return !tokens.isEmpty() && tokens.containsAll(spokenTokens);
        }).toList();
        if (!partial.isEmpty()) return new Match("SUGGESTED", null, null, partial);
        return new Match("NOT_IN_DIRECTORY", null, null, List.of());
    }

    private static Match fromExact(Person p, String basis) {
        return eligible(p) ? new Match("RESOLVED", basis, p, List.of(p)) : new Match("NOT_ELIGIBLE", basis, null, List.of(p));
    }
}

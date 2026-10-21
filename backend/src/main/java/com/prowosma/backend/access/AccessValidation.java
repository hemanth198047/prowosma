package com.prowosma.backend.access;

import java.util.*;
import java.util.regex.Pattern;

import static com.prowosma.backend.access.AccessConstants.*;

/** Input validation for admin-defined access data. Pure Java; throws {@link IllegalArgumentException} with a message fit to show an admin. */
public final class AccessValidation {
    private AccessValidation() {}

    private static final Pattern SLOT_KEY = Pattern.compile("^[A-Z][A-Z0-9_]{0,39}$");
    public static final int MAX_NAME = 60;
    public static final int MAX_SLOTS = 20;

    public static String name(String raw, String what) {
        String n = raw == null ? "" : raw.trim();
        if (n.isEmpty()) throw new IllegalArgumentException(what + " name is required.");
        if (n.length() > MAX_NAME) throw new IllegalArgumentException(what + " name is too long (max " + MAX_NAME + " characters).");
        return n;
    }

    public static String scope(String raw) {
        String m = normalizeMode(raw);
        if (m == null) throw new IllegalArgumentException("Scope must be one of " + ALL_MODES + ".");
        return m;
    }

    public static List<String> capabilities(Collection<?> raw) {
        LinkedHashSet<String> out = new LinkedHashSet<>();
        if (raw != null) for (Object o : raw) {
            String c = o == null ? "" : String.valueOf(o).trim().toUpperCase(Locale.ROOT);
            if (c.isEmpty()) continue;
            if (!ALL_CAPABILITIES.contains(c)) throw new IllegalArgumentException("Unknown capability: " + c + ". Known: " + ALL_CAPABILITIES + ".");
            out.add(c);
        }
        return new ArrayList<>(out);
    }

    /** A department admin only makes sense with department scope. */
    public static boolean departmentAdmin(boolean requested, String scope) {
        return requested && MODE_DEPARTMENTS.equals(scope);
    }

    /** @return key/label pairs, keys upper-cased, unique, in the order given. */
    public static List<Map<String, String>> roleSlots(Collection<? extends Map<?, ?>> raw) {
        List<Map<String, String>> out = new ArrayList<>();
        if (raw == null) return out;
        if (raw.size() > MAX_SLOTS) throw new IllegalArgumentException("At most " + MAX_SLOTS + " project roles.");
        Set<String> seen = new HashSet<>();
        for (Map<?, ?> m : raw) {
            String label = m.get("label") == null ? "" : String.valueOf(m.get("label")).trim();
            String key = m.get("key") == null ? "" : String.valueOf(m.get("key")).trim();
            if (key.isEmpty()) key = label.toUpperCase(Locale.ROOT).replaceAll("[^A-Z0-9]+", "_").replaceAll("^_+|_+$", "");
            key = key.toUpperCase(Locale.ROOT);
            if (label.isEmpty()) throw new IllegalArgumentException("Every project role needs a label.");
            if (label.length() > MAX_NAME) throw new IllegalArgumentException("Project role label is too long: " + label);
            if (!SLOT_KEY.matcher(key).matches()) throw new IllegalArgumentException("Invalid project role key: '" + key + "' (use letters, digits and underscores, starting with a letter).");
            if (!seen.add(key)) throw new IllegalArgumentException("Duplicate project role: " + key);
            Map<String, String> e = new LinkedHashMap<>();
            e.put("key", key);
            e.put("label", label);
            out.add(e);
        }
        return out;
    }

    public static String docMode(String raw) {
        String m = raw == null ? "" : raw.trim().toUpperCase(Locale.ROOT);
        if (!ALL_DOC_MODES.contains(m)) throw new IllegalArgumentException("Document sharing must be one of " + ALL_DOC_MODES + ".");
        return m;
    }

    public static String audience(String raw) {
        if (!isValidAudience(raw)) throw new IllegalArgumentException("Audience must be one of " + ALL_AUDIENCES + ".");
        return raw.trim().toUpperCase(Locale.ROOT);
    }

    public static String visibility(String raw) {
        String v = normalizeVisibility(raw);
        if (v == null) throw new IllegalArgumentException("Visibility must be one of " + ALL_VISIBILITIES + ".");
        return v;
    }
}

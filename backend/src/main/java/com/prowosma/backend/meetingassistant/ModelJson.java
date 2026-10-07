package com.prowosma.backend.meetingassistant;

/** Pulls the JSON object out of a model reply that may be wrapped in fences or chatter. Pure string handling. */
public final class ModelJson {

    private ModelJson() {}

    /** Returns the text from the first '{' to the last '}', or null when there is none. */
    public static String extract(String raw) {
        if (raw == null) return null;
        int a = raw.indexOf('{');
        int b = raw.lastIndexOf('}');
        return (a >= 0 && b > a) ? raw.substring(a, b + 1) : null;
    }
}

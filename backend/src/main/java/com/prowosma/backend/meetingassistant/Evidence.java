package com.prowosma.backend.meetingassistant;

import java.util.ArrayList;
import java.util.List;
import java.util.TreeSet;

/** Evidence markers: "[#3] [#9-11]" — compact links from a generated statement to transcript line numbers. */
public final class Evidence {

    private Evidence() {}

    /** [3, 9, 10, 11] → "[#3] [#9-11]". Duplicates and order are normalised. */
    public static String format(List<Integer> seqs) {
        if (seqs == null || seqs.isEmpty()) return "";
        List<Integer> sorted = new ArrayList<>(new TreeSet<>(seqs));
        List<String> parts = new ArrayList<>();
        int start = sorted.get(0), prev = start;
        for (int i = 1; i <= sorted.size(); i++) {
            Integer cur = i < sorted.size() ? sorted.get(i) : null;
            if (cur != null && cur == prev + 1) { prev = cur; continue; }
            parts.add(start == prev ? "[#" + start + "]" : "[#" + start + "-" + prev + "]");
            if (cur != null) { start = cur; prev = cur; }
        }
        return String.join(" ", parts);
    }
}

package com.prowosma.backend.meetingassistant;

import java.util.ArrayList;
import java.util.List;

/** Line-by-line difference (longest common subsequence) so a regenerated version can be reviewed before it replaces anything. */
public final class LineDiff {

    private LineDiff() {}

    /** type: ' ' unchanged, '+' added, '-' removed */
    public record Op(char type, String line) {}

    static final int MAX_LINES = 3000;

    public static List<Op> diff(String before, String after) {
        String[] a = before == null || before.isEmpty() ? new String[0] : before.split("\n", -1);
        String[] b = after == null || after.isEmpty() ? new String[0] : after.split("\n", -1);
        List<Op> ops = new ArrayList<>();
        if (a.length > MAX_LINES || b.length > MAX_LINES) {         // too large to align: show it as a full replacement
            for (String s : a) ops.add(new Op('-', s));
            for (String s : b) ops.add(new Op('+', s));
            return ops;
        }
        int[][] lcs = new int[a.length + 1][b.length + 1];
        for (int i = a.length - 1; i >= 0; i--)
            for (int j = b.length - 1; j >= 0; j--)
                lcs[i][j] = a[i].equals(b[j]) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
        int i = 0, j = 0;
        while (i < a.length && j < b.length) {
            if (a[i].equals(b[j])) { ops.add(new Op(' ', a[i])); i++; j++; }
            else if (lcs[i + 1][j] >= lcs[i][j + 1]) ops.add(new Op('-', a[i++]));
            else ops.add(new Op('+', b[j++]));
        }
        while (i < a.length) ops.add(new Op('-', a[i++]));
        while (j < b.length) ops.add(new Op('+', b[j++]));
        return ops;
    }
}

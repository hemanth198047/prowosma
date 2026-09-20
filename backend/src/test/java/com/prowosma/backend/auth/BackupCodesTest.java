package com.prowosma.backend.auth;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

@DisplayName("BackupCodes — one-time recovery codes")
class BackupCodesTest {

    @Test
    @DisplayName("codes look like abcde-fghjk, use no easily-confused characters, and are all different")
    void generation() {
        List<String> codes = BackupCodes.generate(10);
        assertEquals(10, codes.size());
        Set<String> unique = new HashSet<>(codes);
        assertEquals(10, unique.size());
        for (String code : codes) assertTrue(code.matches("[a-hj-km-np-z2-9]{5}-[a-hj-km-np-z2-9]{5}"), code);
    }

    @Test
    @DisplayName("a code is stored only as a hash, and case / hyphen / spacing variants are the same code")
    void hashing() {
        String hash = BackupCodes.hash("abcde-fghjk");
        assertEquals(64, hash.length());
        assertFalse(hash.contains("abcde"));
        assertEquals(hash, BackupCodes.hash("ABCDE-FGHJK"));
        assertEquals(hash, BackupCodes.hash("abcde fghjk"));
        assertEquals(hash, BackupCodes.hash("  abcdefghjk "));
        assertFalse(hash.equals(BackupCodes.hash("abcde-fghjm")));
    }

    @Test
    @DisplayName("a valid code is accepted once: it is removed from what is stored, and the others stay")
    void singleUse() {
        List<String> stored = BackupCodes.hashAll(List.of("aaaaa-bbbbb", "ccccc-ddddd", "eeeee-fffff"));

        List<String> after = BackupCodes.consume(stored, "CCCCC-DDDDD");
        assertNotNull(after);
        assertEquals(2, after.size());
        assertTrue(after.contains(BackupCodes.hash("aaaaa-bbbbb")));
        assertTrue(after.contains(BackupCodes.hash("eeeee-fffff")));
        assertFalse(after.contains(BackupCodes.hash("ccccc-ddddd")));

        assertNull(BackupCodes.consume(after, "ccccc-ddddd"));            // already used
        assertEquals(3, stored.size());                                    // the input list is never modified
    }

    @Test
    @DisplayName("wrong, malformed, empty and missing input never matches")
    void rejections() {
        List<String> stored = BackupCodes.hashAll(List.of("aaaaa-bbbbb"));
        for (String bad : new String[]{"aaaaa-bbbbc", "aaaaa", "aaaaa-bbbbb-x", "", "   ", null, "123456"}) {
            assertNull(BackupCodes.consume(stored, bad), String.valueOf(bad));
        }
        assertNull(BackupCodes.consume(null, "aaaaa-bbbbb"));
        assertNull(BackupCodes.consume(List.of(), "aaaaa-bbbbb"));
    }

    @Test
    @DisplayName("the code the user sees is the code that verifies")
    void roundTrip() {
        List<String> codes = BackupCodes.generate(10);
        List<String> stored = BackupCodes.hashAll(codes);
        for (String code : codes) {
            assertNotNull(BackupCodes.consume(stored, code), code);
        }
    }
}

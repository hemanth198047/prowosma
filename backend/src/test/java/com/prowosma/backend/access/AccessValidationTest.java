package com.prowosma.backend.access;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class AccessValidationTest {

    private static void rejects(Runnable r) {
        try { r.run(); } catch (IllegalArgumentException expected) { return; }
        throw new AssertionError("expected IllegalArgumentException");
    }

    @Test void roleSlotKeysAreDerivedFromLabelsAndNormalised() {
        var out = AccessValidation.roleSlots(List.of(Map.of("label", "Creative Lead"), Map.of("key", "production_lead", "label", "Production Lead")));
        assertEquals("CREATIVE_LEAD", out.get(0).get("key"));
        assertEquals("PRODUCTION_LEAD", out.get(1).get("key"));
    }

    @Test void roleSlotsRejectDuplicatesBlankLabelsAndBadKeys() {
        rejects(() -> AccessValidation.roleSlots(List.of(Map.of("label", "A B"), Map.of("key", "A_B", "label", "Other"))));
        rejects(() -> AccessValidation.roleSlots(List.of(Map.of("key", "X", "label", " "))));
        rejects(() -> AccessValidation.roleSlots(List.of(Map.of("key", "1BAD", "label", "Bad"))));
    }

    @Test void capabilitiesMustBeKnown() {
        assertEquals(List.of("CREATE_TASK", "APPROVE"), AccessValidation.capabilities(List.of("create_task", "APPROVE", "approve")));
        rejects(() -> AccessValidation.capabilities(List.of("DELETE_EVERYTHING")));
    }

    @Test void namesScopesAndVisibilityAreChecked() {
        assertEquals("Post-production", AccessValidation.name("  Post-production ", "Department"));
        rejects(() -> AccessValidation.name("  ", "Department"));
        rejects(() -> AccessValidation.name("x".repeat(61), "Department"));
        assertEquals("ASSIGNED_ONLY", AccessValidation.scope("assigned_only"));
        rejects(() -> AccessValidation.scope("EVERYTHING"));
        assertEquals("MEMBERS_ONLY", AccessValidation.visibility("members_only"));
        rejects(() -> AccessValidation.visibility("public"));
    }

    @Test void departmentAdminNeedsDepartmentScope() {
        assertTrue(AccessValidation.departmentAdmin(true, "MY_DEPARTMENTS"));
        assertFalse(AccessValidation.departmentAdmin(true, "ASSIGNED_ONLY"));
        assertFalse(AccessValidation.departmentAdmin(true, "ALL"));
    }

    @Test void docModeAndAudienceAreChecked() {
        assertEquals("BOTH", AccessValidation.docMode("both"));
        assertEquals("PRIVATE_SHARED", AccessValidation.docMode(" private_shared "));
        rejects(() -> AccessValidation.docMode("everyone"));
        rejects(() -> AccessValidation.docMode(null));
        assertEquals("DEPARTMENTS", AccessValidation.audience("departments"));
        rejects(() -> AccessValidation.audience("PUBLIC"));
        rejects(() -> AccessValidation.audience(null));
    }
}

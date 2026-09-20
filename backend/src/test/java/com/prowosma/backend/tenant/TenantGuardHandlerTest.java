package com.prowosma.backend.tenant;

import com.prowosma.backend.config.tenant.TenantGuardHandler;
import com.prowosma.backend.config.tenant.TenantGuardMode;
import com.prowosma.backend.config.tenant.TenantScope;
import com.prowosma.backend.config.tenant.TenantViolationException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The tenant guard is the single place that stops one workspace reading,
 * editing or deleting another workspace's records by id. These tests drive the
 * real handler (through a real JDK proxy, exactly as the Spring wiring does)
 * against an in-memory repository.
 */
@DisplayName("TenantGuardHandler — by-id access is tenant-safe")
class TenantGuardHandlerTest {

    // ── minimal stand-ins for an entity and a Spring Data repository ─────────

    public static class Thing {
        private String id;
        private String organizationId;
        public Thing(String id, String organizationId) { this.id = id; this.organizationId = organizationId; }
        public String getId() { return id; }
        public String getOrganizationId() { return organizationId; }
        public void setOrganizationId(String organizationId) { this.organizationId = organizationId; }
    }

    /** Entity that names its tenant field workspaceId (like Doc, Meeting, Sop). */
    public static class Note {
        private final String id;
        private final String workspaceId;
        public Note(String id, String workspaceId) { this.id = id; this.workspaceId = workspaceId; }
        public String getId() { return id; }
        public String getWorkspaceId() { return workspaceId; }
    }

    /** Same simple name as the real, exempt model.User. */
    public static class User {
        public String getId() { return "u"; }
        public String getOrganizationId() { return "anything"; }
    }

    /** Neither field: not tenant-scoped at all. */
    public static class Global {
        public String getId() { return "g"; }
    }

    public interface ThingRepo {
        Optional<Thing> findById(Object id);
        boolean existsById(Object id);
        void deleteById(Object id);
        void deleteAllById(Iterable<?> ids);
        void delete(Thing thing);
        List<Thing> findAllById(Iterable<?> ids);
        Thing save(Thing thing);
        List<Thing> saveAll(Iterable<Thing> things);
        List<Thing> findByOrganizationId(String organizationId);   // a derived query
    }

    public interface NoteRepo {
        Optional<Note> findById(Object id);
    }

    public interface NoFindByIdRepo {
        List<Thing> findByOrganizationId(String organizationId);
    }

    /** In-memory repository that also counts how it was used. */
    static class FakeRepo implements ThingRepo {
        final Map<String, Thing> store = new LinkedHashMap<>();
        int findByIdCalls;
        RuntimeException failSaveWith;

        public Optional<Thing> findById(Object id) { findByIdCalls++; return Optional.ofNullable(store.get(id)); }
        public boolean existsById(Object id) { return store.containsKey(id); }
        public void deleteById(Object id) { store.remove(id); }
        public void deleteAllById(Iterable<?> ids) { for (Object id : ids) store.remove(id); }
        public void delete(Thing thing) { store.remove(thing.getId()); }
        public List<Thing> findAllById(Iterable<?> ids) {
            List<Thing> out = new ArrayList<>();
            for (Object id : ids) if (store.containsKey(id)) out.add(store.get(id));
            return out;
        }
        public Thing save(Thing thing) {
            if (failSaveWith != null) throw failSaveWith;
            store.put(thing.getId() == null ? "generated-" + store.size() : thing.getId(), thing);
            return thing;
        }
        public List<Thing> saveAll(Iterable<Thing> things) {
            List<Thing> out = new ArrayList<>();
            for (Thing t : things) out.add(save(t));
            return out;
        }
        public List<Thing> findByOrganizationId(String organizationId) {
            List<Thing> out = new ArrayList<>();
            for (Thing t : store.values()) if (organizationId.equals(t.getOrganizationId())) out.add(t);
            return out;
        }
    }

    private FakeRepo raw;
    private TenantScope scope;
    private List<String> reports;
    private ThingRepo guarded;

    @BeforeEach
    void setUp() {
        raw = new FakeRepo();
        raw.store.put("mine", new Thing("mine", "A"));
        raw.store.put("mine-2", new Thing("mine-2", "A"));
        raw.store.put("theirs", new Thing("theirs", "B"));
        raw.store.put("legacy", new Thing("legacy", null));
        scope = TenantScope.enforced("A");
        reports = new ArrayList<>();
        guarded = guard(TenantGuardMode.ENFORCE);
    }

    private ThingRepo guard(TenantGuardMode mode) {
        TenantGuardHandler handler = TenantGuardHandler.create(raw, Thing.class, () -> scope, mode, reports::add);
        assertNotNull(handler);
        return (ThingRepo) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[]{ThingRepo.class}, handler);
    }

    // ── reads ────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("findById returns the caller's own record")
    void findById_ownRecord() {
        assertTrue(guarded.findById("mine").isPresent());
        assertTrue(reports.isEmpty());
    }

    @Test
    @DisplayName("findById reports another workspace's record as not found (and says so in the log)")
    void findById_otherTenant_looksAbsent() {
        assertTrue(guarded.findById("theirs").isEmpty());
        assertEquals(1, reports.size());
        assertTrue(reports.get(0).contains("tenant 'B'"));
    }

    @Test
    @DisplayName("findById of an unknown id stays empty without a violation report")
    void findById_missing() {
        assertTrue(guarded.findById("nope").isEmpty());
        assertTrue(reports.isEmpty());
    }

    @Test
    @DisplayName("un-owned legacy records stay reachable")
    void findById_legacyRecordStillVisible() {
        assertTrue(guarded.findById("legacy").isPresent());
    }

    @Test
    @DisplayName("a caller with no workspace selected sees only un-owned records — not everyone's (the old 'omit the header' bypass)")
    void findById_noWorkspaceSelected() {
        scope = TenantScope.enforced(null);
        assertTrue(guarded.findById("mine").isEmpty());
        assertTrue(guarded.findById("theirs").isEmpty());
        assertTrue(guarded.findById("legacy").isPresent());
    }

    @Test
    @DisplayName("outside an enforced request (scheduler, async, system) everything passes straight through, with no extra lookups")
    void notEnforced_passesThrough() {
        scope = TenantScope.skip();
        assertTrue(guarded.findById("theirs").isPresent());
        assertEquals(1, raw.findByIdCalls);
        assertTrue(guarded.existsById("theirs"));
        guarded.deleteById("theirs");
        assertFalse(raw.store.containsKey("theirs"));
        assertEquals(1, raw.findByIdCalls);      // deleteById did not add a pre-check lookup
        assertTrue(reports.isEmpty());
    }

    @Test
    @DisplayName("existsById is false for another workspace's record")
    void existsById() {
        assertTrue(guarded.existsById("mine"));
        assertFalse(guarded.existsById("theirs"));
        assertFalse(guarded.existsById("nope"));
    }

    @Test
    @DisplayName("findAllById drops other workspaces' records")
    void findAllById() {
        List<Thing> found = guarded.findAllById(List.of("mine", "theirs", "mine-2", "nope"));
        assertEquals(2, found.size());
        assertEquals("mine", found.get(0).getId());
        assertEquals("mine-2", found.get(1).getId());
    }

    @Test
    @DisplayName("derived queries are left exactly as they are (callers already scope them)")
    void derivedQuery_untouched() {
        assertEquals(2, guarded.findByOrganizationId("A").size());
        assertEquals(1, guarded.findByOrganizationId("B").size());   // explicit query for B is the caller's own business
    }

    // ── deletes ──────────────────────────────────────────────────────────────

    @Test
    @DisplayName("deleteById removes the caller's own record")
    void deleteById_own() {
        guarded.deleteById("mine");
        assertFalse(raw.store.containsKey("mine"));
    }

    @Test
    @DisplayName("deleteById leaves another workspace's record untouched, like deleting an id that does not exist")
    void deleteById_otherTenant_ignored() {
        guarded.deleteById("theirs");
        assertTrue(raw.store.containsKey("theirs"));
        assertEquals(1, reports.size());
    }

    @Test
    @DisplayName("deleteAllById only deletes the caller's records")
    void deleteAllById() {
        guarded.deleteAllById(List.of("mine", "theirs", "mine-2"));
        assertFalse(raw.store.containsKey("mine"));
        assertFalse(raw.store.containsKey("mine-2"));
        assertTrue(raw.store.containsKey("theirs"));
    }

    @Test
    @DisplayName("delete(entity) ignores a foreign entity")
    void delete_foreignEntity() {
        guarded.delete(raw.store.get("theirs"));
        assertTrue(raw.store.containsKey("theirs"));
    }

    @Test
    @DisplayName("delete(entity) is not fooled by a body edited to look like ours: the stored copy is checked")
    void delete_tamperedEntity() {
        Thing tampered = new Thing("theirs", "A");        // foreign id, but claims workspace A
        guarded.delete(tampered);
        assertTrue(raw.store.containsKey("theirs"));
    }

    // ── writes ───────────────────────────────────────────────────────────────

    @Test
    @DisplayName("save of a brand-new record (no id) is allowed")
    void save_newRecord() {
        guarded.save(new Thing(null, "A"));
        assertEquals(5, raw.store.size());
    }

    @Test
    @DisplayName("save of an id that isn't stored yet is allowed")
    void save_unknownId() {
        guarded.save(new Thing("fresh", "A"));
        assertTrue(raw.store.containsKey("fresh"));
    }

    @Test
    @DisplayName("save updating the caller's own record is allowed")
    void save_updateOwn() {
        guarded.save(new Thing("mine", "A"));
        assertTrue(reports.isEmpty());
    }

    @Test
    @DisplayName("save cannot overwrite another workspace's record, even when the body claims to be ours")
    void save_overwriteForeign_blocked() {
        Thing before = raw.store.get("theirs");
        assertThrows(TenantViolationException.class, () -> guarded.save(new Thing("theirs", "A")));
        assertEquals(before, raw.store.get("theirs"));
        assertEquals(1, reports.size());
    }

    @Test
    @DisplayName("saveAll is refused as a whole if any element would overwrite a foreign record")
    void saveAll_blockedIfAnyForeign() {
        Thing before = raw.store.get("theirs");
        assertThrows(TenantViolationException.class,
                () -> guarded.saveAll(List.of(new Thing("mine", "A"), new Thing("theirs", "A"))));
        assertEquals(before, raw.store.get("theirs"));
    }

    @Test
    @DisplayName("saveAll of the caller's own and new records goes through")
    void saveAll_clean() {
        List<Thing> saved = guarded.saveAll(List.of(new Thing("mine", "A"), new Thing("new-1", "A")));
        assertEquals(2, saved.size());
        assertTrue(raw.store.containsKey("new-1"));
    }

    @Test
    @DisplayName("exceptions thrown by the real repository reach the caller unwrapped")
    void targetExceptions_areUnwrapped() {
        raw.failSaveWith = new IllegalStateException("db down");
        IllegalStateException thrown = assertThrows(IllegalStateException.class, () -> guarded.save(new Thing("mine", "A")));
        assertEquals("db down", thrown.getMessage());
    }

    // ── rollout modes ────────────────────────────────────────────────────────

    @Test
    @DisplayName("LOG mode reports a cross-tenant access but lets it through (for rolling the guard out)")
    void logMode_reportsButAllows() {
        raw.store.put("theirs-2", new Thing("theirs-2", "B"));   // a separate foreign record for the delete step
        guarded = guard(TenantGuardMode.LOG);
        assertTrue(guarded.findById("theirs").isPresent());      // reported, allowed
        guarded.save(new Thing("theirs", "A"));                  // reported, allowed: no exception, and it really is written
        assertEquals("A", raw.store.get("theirs").getOrganizationId());
        guarded.deleteById("theirs-2");                          // reported, allowed
        assertFalse(raw.store.containsKey("theirs-2"));
        assertEquals(3, reports.size());
        assertTrue(reports.get(0).startsWith("[TenantGuard:LOG]"));
    }

    @Test
    @DisplayName("mode parsing: unknown or missing values ENFORCE — a typo must never disable protection")
    void modeParsing() {
        assertEquals(TenantGuardMode.ENFORCE, TenantGuardMode.parse(null));
        assertEquals(TenantGuardMode.ENFORCE, TenantGuardMode.parse(""));
        assertEquals(TenantGuardMode.ENFORCE, TenantGuardMode.parse("enforce"));
        assertEquals(TenantGuardMode.ENFORCE, TenantGuardMode.parse("enfroce"));
        assertEquals(TenantGuardMode.LOG, TenantGuardMode.parse(" Log "));
        assertEquals(TenantGuardMode.LOG, TenantGuardMode.parse("shadow"));
        assertEquals(TenantGuardMode.OFF, TenantGuardMode.parse("off"));
        assertEquals(TenantGuardMode.OFF, TenantGuardMode.parse("FALSE"));
    }

    // ── what gets a guard at all ─────────────────────────────────────────────

    @Test
    @DisplayName("no guard is created for exempt entities (User, Workspace), entities without a tenant field, OFF mode, or repositories without findById")
    void create_returnsNullWhenNotApplicable() {
        assertNull(TenantGuardHandler.create(raw, User.class, () -> scope, TenantGuardMode.ENFORCE, reports::add));
        assertNull(TenantGuardHandler.create(raw, Global.class, () -> scope, TenantGuardMode.ENFORCE, reports::add));
        assertNull(TenantGuardHandler.create(raw, Thing.class, () -> scope, TenantGuardMode.OFF, reports::add));
        assertNull(TenantGuardHandler.create(raw, null, () -> scope, TenantGuardMode.ENFORCE, reports::add));
        NoFindByIdRepo noFind = organizationId -> List.of();
        assertNull(TenantGuardHandler.create(noFind, Thing.class, () -> scope, TenantGuardMode.ENFORCE, reports::add));
    }

    @Test
    @DisplayName("entities that name the field workspaceId (Doc, Meeting, Sop...) are guarded too")
    void workspaceIdEntities() {
        Map<Object, Note> notes = new HashMap<>();
        notes.put("n-mine", new Note("n-mine", "A"));
        notes.put("n-theirs", new Note("n-theirs", "B"));
        NoteRepo repo = id -> Optional.ofNullable(notes.get(id));
        TenantGuardHandler handler = TenantGuardHandler.create(repo, Note.class, () -> scope, TenantGuardMode.ENFORCE, reports::add);
        assertNotNull(handler);
        NoteRepo guardedNotes = (NoteRepo) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[]{NoteRepo.class}, handler);
        assertTrue(guardedNotes.findById("n-mine").isPresent());
        assertTrue(guardedNotes.findById("n-theirs").isEmpty());
    }

    @Test
    @DisplayName("equals / hashCode / toString on the proxy behave sensibly")
    void objectMethods() {
        assertTrue(guarded.equals(guarded));
        assertFalse(guarded.equals(new Object()));
        assertEquals(guarded.hashCode(), guarded.hashCode());
        assertEquals("TenantGuard[Thing]", guarded.toString());
    }
}

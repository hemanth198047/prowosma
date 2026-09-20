package com.prowosma.backend.websocket;

import com.prowosma.backend.config.StompAccessPolicy;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Who may subscribe to / send to which STOMP destination. Before this policy existed
 * any connected client could subscribe to any workspace's or document's live traffic
 * and overwrite any document through /app/doc/{id}/edit.
 */
@DisplayName("StompAccessPolicy — WebSocket destination authorisation")
class StompAccessPolicyTest {

    private static final String ALICE = "alice@a.com";     // member of workspace wsA
    private static final String BOB   = "bob@b.com";       // member of workspace wsB

    private final Map<String, String> docWorkspace = new HashMap<>();
    private final Set<String> members = new HashSet<>();
    private int workspaceLookups;
    private int membershipLookups;
    private long now;
    private StompAccessPolicy policy;

    @BeforeEach
    void setUp() {
        docWorkspace.put("docA", "wsA");
        docWorkspace.put("docB", "wsB");
        members.add(ALICE + "|wsA");
        members.add(BOB + "|wsB");
        now = 1_000_000L;
        policy = new StompAccessPolicy(new StompAccessPolicy.Directory() {
            @Override public Optional<String> workspaceOfDoc(String docId) {
                workspaceLookups++;
                return Optional.ofNullable(docWorkspace.get(docId));
            }
            @Override public boolean isMember(String email, String workspaceId) {
                if (email == null) throw new AssertionError("directory must never be asked about an anonymous user");
                membershipLookups++;
                return members.contains(email + "|" + workspaceId);
            }
        }, () -> now);
    }

    // ── workspace topic ──────────────────────────────────────────────────────

    @Test
    @DisplayName("a member may subscribe to their own workspace's topic; a non-member may not")
    void workspaceTopic() {
        assertTrue(policy.canSubscribe(ALICE, "/topic/workspace/wsA"));
        assertFalse(policy.canSubscribe(ALICE, "/topic/workspace/wsB"));
        assertFalse(policy.canSubscribe(BOB, "/topic/workspace/wsA"));
    }

    // ── document topic ───────────────────────────────────────────────────────

    @Test
    @DisplayName("a document's live topic is only for members of the document's workspace")
    void docTopic() {
        assertTrue(policy.canSubscribe(ALICE, "/topic/doc/docA"));
        assertFalse(policy.canSubscribe(ALICE, "/topic/doc/docB"));
        assertFalse(policy.canSubscribe(BOB, "/topic/doc/docA"));
    }

    @Test
    @DisplayName("a document that does not exist can't be subscribed to")
    void unknownDoc() {
        assertFalse(policy.canSubscribe(ALICE, "/topic/doc/ghost"));
        assertFalse(policy.canSend(ALICE, "/app/doc/ghost/edit"));
    }

    // ── sending ──────────────────────────────────────────────────────────────

    @Test
    @DisplayName("editing/joining/leaving/moving a cursor in a document requires membership of its workspace")
    void sendToDoc() {
        for (String verb : new String[]{"join", "leave", "edit", "cursor"}) {
            assertTrue(policy.canSend(ALICE, "/app/doc/docA/" + verb), verb);
            assertFalse(policy.canSend(BOB, "/app/doc/docA/" + verb), verb);
        }
    }

    @Test
    @DisplayName("only the four known document verbs may be sent")
    void unknownVerbDenied() {
        assertFalse(policy.canSend(ALICE, "/app/doc/docA/delete"));
        assertFalse(policy.canSend(ALICE, "/app/doc/docA"));
        assertFalse(policy.canSend(ALICE, "/app/doc/docA/edit/extra"));
    }

    // ── the wildcard problem ─────────────────────────────────────────────────

    @Test
    @DisplayName("wildcard subscriptions are refused (the simple broker would otherwise deliver every document's traffic)")
    void wildcardsDenied() {
        for (String destination : new String[]{
                "/topic/**", "/topic/*", "/topic/doc/*", "/topic/doc/**", "/topic/workspace/*",
                "/topic/workspace/**", "/topic/doc/{id}", "/topic/doc/doc?", "/topic/doc/d*"}) {
            assertFalse(policy.canSubscribe(ALICE, destination), destination);
        }
        assertFalse(policy.canSend(ALICE, "/app/doc/*/edit"));
        assertFalse(policy.canSend(ALICE, "/app/doc/**/edit"));
    }

    @Test
    @DisplayName("malformed destinations never even reach the database")
    void malformedDoNotQueryDirectory() {
        policy.canSubscribe(ALICE, "/topic/doc/*");
        policy.canSubscribe(ALICE, "/topic/doc/a/b");
        policy.canSubscribe(ALICE, "/topic/doc/");
        policy.canSubscribe(ALICE, "/topic/doc/../workspace/wsB");
        policy.canSubscribe(ALICE, "/topic/doc/%2A");
        policy.canSubscribe(ALICE, "/topic/doc/" + "x".repeat(65));
        assertEquals(0, workspaceLookups);
        assertEquals(0, membershipLookups);
    }

    @Test
    @DisplayName("any destination that isn't explicitly allowed is denied")
    void denyByDefault() {
        assertFalse(policy.canSubscribe(ALICE, "/topic/anything"));
        assertFalse(policy.canSubscribe(ALICE, "/topic/workspace"));
        assertFalse(policy.canSubscribe(ALICE, "/queue/x"));
        assertFalse(policy.canSubscribe(ALICE, "/user/queue/x"));
        assertFalse(policy.canSubscribe(ALICE, ""));
        assertFalse(policy.canSend(ALICE, "/app/other"));
        assertFalse(policy.canSend(ALICE, "/topic/doc/docA"));
    }

    @Test
    @DisplayName("no user (anonymous) or no destination is denied")
    void nullsDenied() {
        assertFalse(policy.canSubscribe(null, "/topic/workspace/wsA"));
        assertFalse(policy.canSubscribe(null, "/topic/doc/docA"));
        assertFalse(policy.canSend(null, "/app/doc/docA/edit"));
        assertEquals(0, workspaceLookups);       // rejected before any lookup
        assertFalse(policy.canSubscribe(ALICE, null));
        assertFalse(policy.canSend(ALICE, null));
    }

    // ── caching ──────────────────────────────────────────────────────────────

    @Test
    @DisplayName("a positive membership answer is reused for a short time, so a burst of edit frames costs one lookup")
    void allowIsCached() {
        for (int i = 0; i < 20; i++) assertTrue(policy.canSend(ALICE, "/app/doc/docA/edit"));
        assertEquals(1, membershipLookups);
    }

    @Test
    @DisplayName("losing access takes effect once the short cache lapses")
    void revocationTakesEffectAfterTtl() {
        assertTrue(policy.canSend(ALICE, "/app/doc/docA/edit"));
        members.remove(ALICE + "|wsA");
        assertTrue(policy.canSend(ALICE, "/app/doc/docA/edit"));        // still cached
        now += StompAccessPolicy.ALLOW_CACHE_MILLIS + 1;
        assertFalse(policy.canSend(ALICE, "/app/doc/docA/edit"));
    }

    @Test
    @DisplayName("a denial is never cached: gaining access works immediately")
    void denialIsNotCached() {
        assertFalse(policy.canSend(BOB, "/app/doc/docA/edit"));
        members.add(BOB + "|wsA");
        assertTrue(policy.canSend(BOB, "/app/doc/docA/edit"));
    }

    @Test
    @DisplayName("the cache is per user and per workspace, not global")
    void cacheIsPerUserAndWorkspace() {
        assertTrue(policy.canSubscribe(ALICE, "/topic/workspace/wsA"));
        assertFalse(policy.canSubscribe(BOB, "/topic/workspace/wsA"));        // Alice's cached allow doesn't cover Bob
        assertFalse(policy.canSubscribe(ALICE, "/topic/workspace/wsB"));      // ...or another workspace
    }
}

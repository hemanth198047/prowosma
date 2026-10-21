package com.prowosma.backend.websocket;

import com.prowosma.backend.config.StompAccessPolicy;
import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/** Per-document access on the collaboration socket, on top of workspace membership. Pure Java, no Spring. */
class StompDocAccessTest {

    private final Set<String> canSee = new HashSet<>();
    private final Set<String> canEdit = new HashSet<>();
    private int docChecks;
    private long now = 1_000L;

    private StompAccessPolicy policy() {
        return new StompAccessPolicy(new StompAccessPolicy.Directory() {
            @Override public Optional<String> workspaceOfDoc(String docId) { return Optional.of("ws1"); }
            @Override public boolean isMember(String email, String workspaceId) { return true; }
            @Override public boolean canAccessDoc(String email, String docId, boolean write) {
                docChecks++;
                return (write ? canEdit : canSee).contains(email + "|" + docId);
            }
        }, () -> now);
    }

    @Test void aMemberWhoCannotSeeTheDocCannotListenToOrWriteToIt() {
        StompAccessPolicy p = policy();
        assertFalse(p.canSubscribe("a@x.com", "/topic/doc/d1"));
        assertFalse(p.canSend("a@x.com", "/app/doc/d1/join"));
        assertFalse(p.canSend("a@x.com", "/app/doc/d1/edit"));
    }

    @Test void seeingIsNotEditing() {
        canSee.add("a@x.com|d1");
        StompAccessPolicy p = policy();
        assertTrue(p.canSubscribe("a@x.com", "/topic/doc/d1"));
        assertTrue(p.canSend("a@x.com", "/app/doc/d1/cursor"));
        assertFalse(p.canSend("a@x.com", "/app/doc/d1/edit"));
        canEdit.add("a@x.com|d1");
        assertTrue(p.canSend("a@x.com", "/app/doc/d1/edit"));
    }

    @Test void positiveAnswersAreCachedBrieflyAndDenialsNever() {
        canSee.add("a@x.com|d1");
        StompAccessPolicy p = policy();
        assertTrue(p.canSubscribe("a@x.com", "/topic/doc/d1"));
        assertTrue(p.canSubscribe("a@x.com", "/topic/doc/d1"));
        assertEquals(1, docChecks);
        assertFalse(p.canSubscribe("b@x.com", "/topic/doc/d1"));
        assertFalse(p.canSubscribe("b@x.com", "/topic/doc/d1"));
        assertEquals(3, docChecks);                       // both denials asked again
        now += StompAccessPolicy.ALLOW_CACHE_MILLIS + 1;  // the allowance expires, so a revoked share takes effect
        canSee.clear();
        assertFalse(p.canSubscribe("a@x.com", "/topic/doc/d1"));
    }

    @Test void theDefaultDirectoryKeepsTheOldBehaviour() {
        StompAccessPolicy p = new StompAccessPolicy(new StompAccessPolicy.Directory() {
            @Override public Optional<String> workspaceOfDoc(String docId) { return Optional.of("ws1"); }
            @Override public boolean isMember(String email, String workspaceId) { return true; }
        });
        assertTrue(p.canSubscribe("a@x.com", "/topic/doc/d1"));
        assertTrue(p.canSend("a@x.com", "/app/doc/d1/edit"));
    }
}

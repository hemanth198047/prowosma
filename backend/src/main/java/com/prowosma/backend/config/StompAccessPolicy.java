package com.prowosma.backend.config;

import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.LongSupplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Who may subscribe to / send to which STOMP destination.
 *
 * Until now the WebSocket layer only ever looked at the JWT on CONNECT (and let
 * anonymous connections through). It never asked whether the user had any right to
 * the destination, so anyone who knew a workspace or document id could subscribe to
 * its live traffic and — through {@code /app/doc/{id}/edit}, which persists the
 * content it is sent — overwrite another workspace's documents.
 *
 * <h3>Rules</h3>
 * <ul>
 *   <li>SUBSCRIBE {@code /topic/workspace/{id}} — the user must belong to that workspace.</li>
 *   <li>SUBSCRIBE {@code /topic/doc/{id}} — the user must belong to the document's workspace.</li>
 *   <li>SEND {@code /app/doc/{id}/(join|leave|edit|cursor)} — same as the document topic.</li>
 *   <li>Everything else is denied. To add a new destination, add it here on purpose.</li>
 * </ul>
 *
 * Destination ids are matched strictly ({@code [A-Za-z0-9_-]{1,64}}). This matters beyond
 * tidiness: Spring's simple broker matches subscriptions with an Ant-style matcher, so a
 * client subscribing to {@code /topic/doc/*} or {@code /topic/**} would receive every
 * document's traffic. Wildcards can never satisfy the id pattern, so they are refused.
 *
 * Positive membership answers are cached briefly (an edit frame arrives per change, and
 * each would otherwise cost two lookups). Denials are never cached, so gaining access
 * takes effect immediately; losing it takes effect within {@link #ALLOW_CACHE_MILLIS}.
 */
public final class StompAccessPolicy {

    /** What the policy needs to know about the world. */
    public interface Directory {
        /** The workspace a document belongs to; empty if there is no such document. */
        Optional<String> workspaceOfDoc(String docId);

        /** Is the user the owner or a member of the workspace? */
        boolean isMember(String email, String workspaceId);

        /**
         * Beyond workspace membership: may this person see (or, with {@code write}, change) this particular document?
         * Defaults to yes, which is the behaviour before department access control existed.
         */
        default boolean canAccessDoc(String email, String docId, boolean write) { return true; }
    }

    public static final long ALLOW_CACHE_MILLIS = 30_000L;
    private static final int MAX_CACHED = 10_000;

    private static final String ID = "([A-Za-z0-9_-]{1,64})";
    private static final Pattern WORKSPACE_TOPIC = Pattern.compile("^/topic/workspace/" + ID + "$");
    private static final Pattern DOC_TOPIC       = Pattern.compile("^/topic/doc/" + ID + "$");
    private static final Pattern DOC_APP         = Pattern.compile("^/app/doc/" + ID + "/(?:join|leave|edit|cursor)$");

    private final Directory directory;
    private final LongSupplier clockMillis;
    private final Map<String, Long> allowedUntil = new ConcurrentHashMap<>();
    private final Map<String, Long> docAllowedUntil = new ConcurrentHashMap<>();

    public StompAccessPolicy(Directory directory) {
        this(directory, System::currentTimeMillis);
    }

    public StompAccessPolicy(Directory directory, LongSupplier clockMillis) {
        this.directory = directory;
        this.clockMillis = clockMillis;
    }

    public boolean canSubscribe(String email, String destination) {
        if (email == null || destination == null) return false;

        Matcher workspace = WORKSPACE_TOPIC.matcher(destination);
        if (workspace.matches()) return isMember(email, workspace.group(1));

        Matcher doc = DOC_TOPIC.matcher(destination);
        if (doc.matches()) return canUseDoc(email, doc.group(1), false);

        return false;
    }

    public boolean canSend(String email, String destination) {
        if (email == null || destination == null) return false;

        Matcher doc = DOC_APP.matcher(destination);
        if (doc.matches()) return canUseDoc(email, doc.group(1), destination.endsWith("/edit"));

        return false;
    }

    private boolean canUseDoc(String email, String docId, boolean write) {
        Optional<String> workspaceId = directory.workspaceOfDoc(docId);
        if (workspaceId.isEmpty() || !isMember(email, workspaceId.get())) return false;
        // Per-document access (department / sharing). Positive answers are remembered briefly, like membership,
        // because an edit frame arrives per change; denials are never cached.
        String key = email + "|" + docId + "|" + (write ? "w" : "r");
        long now = clockMillis.getAsLong();
        Long until = docAllowedUntil.get(key);
        if (until != null && until > now) return true;
        if (!directory.canAccessDoc(email, docId, write)) { docAllowedUntil.remove(key); return false; }
        if (docAllowedUntil.size() >= MAX_CACHED) docAllowedUntil.clear();
        docAllowedUntil.put(key, now + ALLOW_CACHE_MILLIS);
        return true;
    }

    private boolean isMember(String email, String workspaceId) {
        if (workspaceId == null || workspaceId.isBlank()) return false;
        String key = email + "|" + workspaceId;
        long now = clockMillis.getAsLong();

        Long until = allowedUntil.get(key);
        if (until != null && until > now) return true;

        if (!directory.isMember(email, workspaceId)) {
            allowedUntil.remove(key);
            return false;
        }
        if (allowedUntil.size() >= MAX_CACHED) allowedUntil.clear();
        allowedUntil.put(key, now + ALLOW_CACHE_MILLIS);
        return true;
    }
}

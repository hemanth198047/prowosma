package com.prowosma.backend.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.service.DocService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.Cursor;
import org.springframework.data.redis.core.ScanOptions;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * A-9: Collaborative editing via STOMP WebSocket.
 *
 * Clients subscribe to: /topic/doc/{docId}
 * Clients send to:
 *   /app/doc/{docId}/join    — announce join (payload: {tabId, user, color})
 *   /app/doc/{docId}/leave   — announce leave (payload: {tabId, user})
 *   /app/doc/{docId}/edit    — block change   (payload: {tabId, user, content})
 *   /app/doc/{docId}/cursor  — cursor move    (payload: {tabId, user, color, blockId})
 *
 * ── Horizontal scaling: presence now lives in Redis, not memory ──
 * Previously tracked presence in a local ConcurrentHashMap<docId,
 * ConcurrentHashMap<tabId, presence>>. That's correct for a single
 * instance, but once more than one backend instance exists behind a load
 * balancer, a user connected to instance A and a user connected to
 * instance B — both editing the same doc — would each only appear in
 * their own instance's local map. Calling broadcastPresence() from
 * instance A would show an incomplete collaborator list (missing
 * instance B's users) to everyone, and vice versa.
 *
 * Redis keys (doc-presence:{docId}:{tabId} → JSON) fix that by making
 * presence a genuinely shared store every instance reads and writes the
 * same data from. This is also a real correctness improvement beyond
 * just horizontal scaling: each key carries a short TTL, refreshed on
 * every join/cursor event, so a client that disconnects uncleanly
 * (browser crash, network drop, closed laptop) with no explicit "leave"
 * message now naturally times out of the presence list within seconds —
 * the original in-memory version had no such mechanism at all and would
 * show a "present" collaborator indefinitely until either an explicit
 * leave or the whole app instance restarted.
 */
@Slf4j
@Controller
@RequiredArgsConstructor
public class DocCollabController {

    private final SimpMessagingTemplate messaging;
    private final DocService            docService;
    private final StringRedisTemplate   redis;
    private final ObjectMapper          objectMapper;

    private static final String KEY_PREFIX = "doc-presence:";
    /** Refreshed on every join/cursor event — a client that stops sending anything for this long is treated as gone. */
    private static final Duration PRESENCE_TTL = Duration.ofSeconds(30);

    // ── Join ─────────────────────────────────────────────────────
    @MessageMapping("/doc/{docId}/join")
    public void join(@DestinationVariable String docId,
                     @Payload Map<String, Object> payload) {
        String tabId = str(payload, "tabId");
        String user  = str(payload, "user");
        String color = str(payload, "color");

        Map<String, Object> presence = new HashMap<>();
        presence.put("tabId",    tabId);
        presence.put("user",     user);
        presence.put("color",    color);
        presence.put("blockId",  null);
        presence.put("joinedAt", Instant.now().toEpochMilli());

        putPresence(docId, tabId, presence);

        // Broadcast JOIN event
        Map<String, Object> joinMsg = new HashMap<>();
        joinMsg.put("type",  "JOIN");
        joinMsg.put("tabId", tabId);
        joinMsg.put("user",  user);
        joinMsg.put("color", color);
        joinMsg.put("ts",    Instant.now().toEpochMilli());
        messaging.convertAndSend("/topic/doc/" + docId, (Object) joinMsg);

        broadcastPresence(docId);
    }

    // ── Leave ────────────────────────────────────────────────────
    @MessageMapping("/doc/{docId}/leave")
    public void leave(@DestinationVariable String docId,
                      @Payload Map<String, Object> payload) {
        String tabId = str(payload, "tabId");
        String user  = str(payload, "user");

        redis.delete(redisKey(docId, tabId));

        Map<String, Object> leaveMsg = new HashMap<>();
        leaveMsg.put("type",  "LEAVE");
        leaveMsg.put("tabId", tabId);
        leaveMsg.put("user",  user);
        leaveMsg.put("ts",    Instant.now().toEpochMilli());
        messaging.convertAndSend("/topic/doc/" + docId, (Object) leaveMsg);

        broadcastPresence(docId);
    }

    // ── Edit ─────────────────────────────────────────────────────
    @MessageMapping("/doc/{docId}/edit")
    public void edit(@DestinationVariable String docId,
                     @Payload Map<String, Object> payload) {
        String tabId   = str(payload, "tabId");
        String user    = str(payload, "user");
        // content is the raw blocks JSON string from the client
        String content = str(payload, "content");

        // Persist to DB asynchronously (best-effort)
        if (content != null && !content.isBlank()) {
            try {
                docService.getById(docId).ifPresent(doc -> {
                    doc.setContent(content);
                    docService.save(doc);
                });
            } catch (Exception e) {
                log.warn("Collab save failed for doc {}: {}", docId, e.getMessage());
            }
        }

        // Broadcast to all subscribers — they filter by tabId on the client
        Map<String, Object> editMsg = new HashMap<>();
        editMsg.put("type",    "EDIT");
        editMsg.put("tabId",   tabId);
        editMsg.put("user",    user);
        editMsg.put("content", content);  // raw blocks JSON string, passed through unchanged
        editMsg.put("ts",      Instant.now().toEpochMilli());
        messaging.convertAndSend("/topic/doc/" + docId, (Object) editMsg);
    }

    // ── Cursor ───────────────────────────────────────────────────
    @MessageMapping("/doc/{docId}/cursor")
    public void cursor(@DestinationVariable String docId,
                       @Payload Map<String, Object> payload) {
        String tabId   = str(payload, "tabId");
        String blockId = str(payload, "blockId");

        // Update presence (refreshes the TTL too — see updatePresenceField)
        updatePresenceField(docId, tabId, "blockId", blockId);

        Map<String, Object> cursorMsg = new HashMap<>(payload);
        cursorMsg.put("type", "CURSOR");
        cursorMsg.put("ts",   Instant.now().toEpochMilli());
        messaging.convertAndSend("/topic/doc/" + docId, (Object) cursorMsg);
    }

    // ── Redis-backed presence helpers ───────────────────────────

    private void putPresence(String docId, String tabId, Map<String, Object> presence) {
        try {
            String json = objectMapper.writeValueAsString(presence);
            redis.opsForValue().set(redisKey(docId, tabId), json, PRESENCE_TTL);
        } catch (Exception e) {
            log.warn("Failed to write presence for doc {} tab {}: {}", docId, tabId, e.getMessage());
        }
    }

    /** Updates one field on an existing presence entry and refreshes its TTL — a no-op if the entry already expired (e.g. a stale cursor event arriving after timeout), rather than resurrecting a gone client. */
    private void updatePresenceField(String docId, String tabId, String field, Object value) {
        String key = redisKey(docId, tabId);
        String existingJson = redis.opsForValue().get(key);
        if (existingJson == null) return;

        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> presence = objectMapper.readValue(existingJson, Map.class);
            presence.put(field, value);
            putPresence(docId, tabId, presence);
        } catch (Exception e) {
            log.warn("Failed to update presence field for doc {} tab {}: {}", docId, tabId, e.getMessage());
        }
    }

    /**
     * Lists every still-live presence entry for a doc. Uses SCAN (a
     * non-blocking, cursor-based iteration, via RedisOperations.scan —
     * the standard, directly-supported way to do this on a
     * StringRedisTemplate) rather than the KEYS command — KEYS is a full,
     * blocking scan that gets genuinely dangerous at production scale as
     * the Redis keyspace grows; SCAN was worth using from the start
     * rather than reaching for the simpler-looking KEYS call and having
     * it become a real problem only once there's enough traffic for it to
     * matter, which is exactly the kind of gap the "verify under real
     * load" item elsewhere in this backlog was about.
     */
    private List<Map<String, Object>> getAllPresence(String docId) {
        List<Map<String, Object>> result = new ArrayList<>();
        String pattern = KEY_PREFIX + docId + ":*";
        ScanOptions options = ScanOptions.scanOptions().match(pattern).count(100).build();

        List<String> keys = new ArrayList<>();
        try (Cursor<String> cursor = redis.scan(options)) {
            while (cursor.hasNext()) {
                keys.add(cursor.next());
            }
        } catch (Exception e) {
            log.warn("Failed to scan presence for doc {}: {}", docId, e.getMessage());
            return result;
        }
        if (keys.isEmpty()) return result;

        List<String> values = redis.opsForValue().multiGet(keys);
        if (values == null) return result;

        for (String json : values) {
            if (json == null) continue; // expired between SCAN and MGET — fine, just skip it
            try {
                @SuppressWarnings("unchecked")
                Map<String, Object> presence = objectMapper.readValue(json, Map.class);
                result.add(presence);
            } catch (Exception ignored) {
                // A malformed entry shouldn't break presence for everyone else in the doc
            }
        }
        return result;
    }

    private String redisKey(String docId, String tabId) {
        return KEY_PREFIX + docId + ":" + tabId;
    }

    private void broadcastPresence(String docId) {
        List<Map<String, Object>> presence = getAllPresence(docId);
        Map<String, Object> msg = new HashMap<>();
        msg.put("type",          "PRESENCE");
        msg.put("collaborators", presence);
        msg.put("ts",            Instant.now().toEpochMilli());
        messaging.convertAndSend("/topic/doc/" + docId, (Object) msg);
    }

    private String str(Map<String, Object> m, String key) {
        Object v = m.get(key);
        return v != null ? v.toString() : "";
    }
}

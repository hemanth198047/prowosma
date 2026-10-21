package com.prowosma.backend.service;

import com.prowosma.backend.repository.WorkspaceConfigRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * RealtimeService — broadcasts workspace events over WebSocket/STOMP
 * AND fires outbound webhooks registered for the event type.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class RealtimeService {

    private final SimpMessagingTemplate messaging;
    private final WebhookService        webhookService;
    private final WorkspaceConfigRepository configRepository;

    /** workspaceId -> (expiry millis, access control on). A short cache: broadcast() runs on every change. */
    private final Map<String, long[]> accessControlCache = new ConcurrentHashMap<>();
    private static final long CACHE_MILLIS = 10_000L;

    /** Call after an admin switches access control on or off so the change applies to live events immediately. */
    public void accessControlChanged(String workspaceId) { if (workspaceId != null) accessControlCache.remove(workspaceId); }

    private boolean accessControlOn(String workspaceId) {
        long now = System.currentTimeMillis();
        long[] c = accessControlCache.get(workspaceId);
        if (c != null && c[0] > now) return c[1] == 1L;
        boolean on;
        try {
            on = configRepository.findByWorkspaceId(workspaceId).map(cfg -> cfg.isAccessControlEnabled()).orElse(false);
        } catch (Exception e) {
            on = true;   // can't tell: fail closed, send the content-free version
        }
        accessControlCache.put(workspaceId, new long[]{now + CACHE_MILLIS, on ? 1L : 0L});
        return on;
    }

    public void broadcast(String workspaceId, String type,
                          String entityType, String entityId, String entityName,
                          String performedBy, String message) {
        if (workspaceId == null || workspaceId.isBlank()) return;

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("type",        type);
        payload.put("entityType",  entityType);
        payload.put("entityId",    entityId);
        payload.put("entityName",  entityName);
        payload.put("workspaceId", workspaceId);
        payload.put("performedBy", performedBy);
        payload.put("message",     message);
        payload.put("timestamp",   LocalDateTime.now().toString());

        try {
            // The workspace topic reaches every member. With department access control on, the live feed
            // must not carry titles or names of work some members aren't allowed to see, so it becomes a
            // content-free "something changed" ping; clients re-fetch through the (scoped) REST API.
            Object toSend = payload;
            if (accessControlOn(workspaceId)) {
                Map<String, Object> ping = new LinkedHashMap<>();
                ping.put("type",        type);
                ping.put("workspaceId", workspaceId);
                ping.put("message",     "Something changed in this workspace");
                ping.put("timestamp",   payload.get("timestamp"));
                toSend = ping;
            }
            messaging.convertAndSend("/topic/workspace/" + workspaceId, toSend);
            log.debug("WS broadcast → workspace/{} : {} {}", workspaceId, type, entityName);
        } catch (Exception e) {
            log.warn("WS broadcast failed: {}", e.getMessage());
        }

        // Also fire outbound webhooks asynchronously
        try {
            webhookService.fire(workspaceId, type, payload);
        } catch (Exception e) {
            log.warn("Webhook fire failed: {}", e.getMessage());
        }
    }
}

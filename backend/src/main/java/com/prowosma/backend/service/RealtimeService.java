package com.prowosma.backend.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

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
            messaging.convertAndSend("/topic/workspace/" + workspaceId, (Object) payload);
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

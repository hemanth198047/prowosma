package com.prowosma.backend.controller;

import com.prowosma.backend.model.Automation;
import com.prowosma.backend.repository.AutomationRepository;
import com.prowosma.backend.service.AutomationService;
import com.prowosma.backend.service.NotificationService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * P3: Cross-system inbound webhooks
 * External systems (GitHub, Jira, Salesforce) POST to /api/inbound-webhooks/{key}
 * which triggers matching INBOUND_WEBHOOK automations.
 */
@RestController
@RequestMapping("/api/inbound-webhooks")
@RequiredArgsConstructor
public class InboundWebhookController {

    private final AutomationRepository automationRepository;
    private final AutomationService    automationService;
    private final NotificationService  notificationService;

    @PostMapping("/{key}")
    public ResponseEntity<Map<String, Object>> receive(
            @PathVariable String key,
            @RequestBody(required = false) Map<String, Object> payload) {

        if (payload == null) payload = Map.of();
        final Map<String, Object> body = payload;

        // Find automations triggered by this webhook key
        long triggered = automationRepository.findAll(org.springframework.data.domain.PageRequest.of(0, 500)).stream()
            .filter(a -> a.isEnabled() && "INBOUND_WEBHOOK".equals(a.getTriggerType()))
            .filter(a -> a.getTriggerConfig() != null
                && key.equals(a.getTriggerConfig().get("webhookKey")))
            .peek(a -> {
                try {
                    automationService.trigger("INBOUND_WEBHOOK", "WEBHOOK", key, body);
                } catch (Exception e) {
                    System.err.println("Inbound webhook automation failed: " + e.getMessage());
                }
            }).count();

        notificationService.create(
            "📥 Inbound Webhook",
            "Webhook '" + key + "' received" + (triggered > 0 ? " — " + triggered + " automation(s) triggered" : ""),
            "INFO", "WEBHOOK", key
        );

        return ResponseEntity.ok(Map.of(
            "received", true,
            "key", key,
            "automationsTriggered", triggered
        ));
    }

    @GetMapping("/keys")
    public ResponseEntity<?> listKeys() {
        var keys = automationRepository.findAll(org.springframework.data.domain.PageRequest.of(0, 500)).stream()
            .filter(a -> "INBOUND_WEBHOOK".equals(a.getTriggerType()))
            .filter(a -> a.getTriggerConfig() != null && a.getTriggerConfig().containsKey("webhookKey"))
            .map(a -> Map.of(
                "key", a.getTriggerConfig().get("webhookKey"),
                "automation", a.getName(),
                "enabled", a.isEnabled()
            )).toList();
        return ResponseEntity.ok(Map.of("webhookKeys", keys,
            "endpointFormat", "POST /api/inbound-webhooks/{key}"));
    }
}

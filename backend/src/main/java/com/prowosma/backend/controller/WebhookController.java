package com.prowosma.backend.controller;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.Webhook;
import com.prowosma.backend.repository.WebhookRepository;
import com.prowosma.backend.service.WebhookService;
import io.swagger.v3.oas.annotations.tags.Tag;
import com.prowosma.backend.util.PagedResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;
import org.springframework.web.client.RestTemplate;

import java.time.LocalDateTime;
import java.util.*;

@RestController
@RequestMapping("/api/webhooks")
@Tag(name = "Outbound Webhooks", description = "Register and manage outbound webhook subscriptions")
@RequiredArgsConstructor
public class WebhookController {

    private final WebhookRepository webhookRepository;
    private final WorkspaceContext  workspaceContext;
    private final RestTemplate      restTemplate;  // kept for /test endpoint
    private final WebhookService    webhookService;

    @GetMapping
    public PagedResponse<Webhook> getAll(
            @RequestParam(defaultValue = "false") boolean activeOnly,
            @RequestParam(defaultValue = "0")  int page,
            @RequestParam(defaultValue = "50") int size) {
        String orgId = workspaceContext.getWorkspaceId();
        var items = activeOnly ? webhookRepository.findByOrganizationIdAndActiveTrue(orgId)
                               : webhookRepository.findByOrganizationId(orgId);
        return PagedResponse.ofList(items, page, Math.min(size, 200));
    }

    @GetMapping("/{id}")
    public Webhook getById(@PathVariable String id) {
        return webhookRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Webhook not found: " + id));
    }

    @PostMapping
    public Webhook create(@RequestBody Map<String, Object> body, Authentication auth) {
        Webhook webhook = new Webhook();
        webhook.setOrganizationId(workspaceContext.getWorkspaceId());
        webhook.setUrl((String) body.get("url"));
        webhook.setDescription((String) body.get("description"));
        webhook.setCreatedBy(auth.getName());
        webhook.setActive(true);
        webhook.setSecret(generateSecret());
        webhook.setFailureCount(0);
        webhook.setCreatedAt(LocalDateTime.now());
        webhook.setUpdatedAt(LocalDateTime.now());
        @SuppressWarnings("unchecked")
        List<String> events = (List<String>) body.getOrDefault("events", List.of("task.created","task.updated"));
        webhook.setEvents(events);
        return webhookRepository.save(webhook);
    }

    @PutMapping("/{id}")
    public Webhook update(@PathVariable String id, @RequestBody Map<String, Object> patch) {
        return webhookRepository.findById(id).map(w -> {
            if (patch.containsKey("url"))         w.setUrl((String) patch.get("url"));
            if (patch.containsKey("description")) w.setDescription((String) patch.get("description"));
            @SuppressWarnings("unchecked")
            List<String> events = (List<String>) patch.get("events");
            if (events != null) w.setEvents(events);
            w.setUpdatedAt(LocalDateTime.now());
            return webhookRepository.save(w);
        }).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Webhook not found: " + id));
    }

    @PatchMapping("/{id}/toggle")
    public Webhook toggle(@PathVariable String id) {
        return webhookRepository.findById(id).map(w -> {
            w.setActive(!w.isActive());
            w.setUpdatedAt(LocalDateTime.now());
            return webhookRepository.save(w);
        }).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Webhook not found: " + id));
    }

    @PostMapping("/{id}/rotate-secret")
    public Map<String, String> rotateSecret(@PathVariable String id) {
        return webhookRepository.findById(id).map(w -> {
            String newSecret = generateSecret();
            w.setSecret(newSecret);
            w.setUpdatedAt(LocalDateTime.now());
            webhookRepository.save(w);
            return Map.of("secret", newSecret, "message", "Secret rotated successfully");
        }).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Webhook not found: " + id));
    }

    @PostMapping("/{id}/test")
    public Map<String, Object> test(@PathVariable String id) {
        Webhook webhook = webhookRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Webhook not found: " + id));
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("event",     "webhook.test");
        payload.put("timestamp", LocalDateTime.now().toString());
        payload.put("data",      Map.of("message", "Test ping from Prowosma"));
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.set("X-Prowosma-Event", "webhook.test");
            ResponseEntity<String> resp = restTemplate.postForEntity(
                webhook.getUrl(), new HttpEntity<>(payload, headers), String.class);
            return Map.of("success", true, "statusCode", resp.getStatusCode().value(), "message", "Test ping delivered");
        } catch (Exception e) {
            return Map.of("success", false, "error", e.getMessage());
        }
    }

    /**
     * Dispatch an outbound webhook event.
     * Delegates to WebhookService.fire() which:
     *   - filters subscribers by event type
     *   - signs the payload with HMAC-SHA256 (X-Prowosma-Signature header)
     *   - delivers asynchronously
     *   - tracks failures and auto-disables after 5 consecutive failures
     *
     * Previously this endpoint used a raw RestTemplate without HMAC signing.
     * Fix-3: unified to always go through WebhookService.fire().
     */
    @PostMapping("/dispatch")
    public ResponseEntity<Map<String, Object>> dispatch(@RequestBody Map<String, Object> event) {
        String eventType = (String) event.get("event");
        String orgId     = workspaceContext.getWorkspaceId();
        try {
            webhookService.fire(orgId, eventType, event);
            return ResponseEntity.ok(Map.of(
                "queued", true,
                "event",  eventType,
                "message", "Event dispatched via WebhookService (HMAC-signed, async delivery)"
            ));
        } catch (Exception ex) {
            return ResponseEntity.status(500).body(Map.of(
                "queued", false,
                "error",  ex.getMessage()
            ));
        }
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, String>> delete(@PathVariable String id) {
        webhookRepository.deleteById(id);
        return ResponseEntity.ok(Map.of("message", "Webhook deleted"));
    }

    @GetMapping("/event-types")
    public List<String> eventTypes() {
        return List.of("task.created","task.updated","task.deleted","task.completed",
            "project.created","project.updated","project.completed",
            "goal.created","goal.updated","goal.achieved",
            "sprint.started","sprint.completed","doc.created","doc.updated",
            "member.invited","member.joined","comment.created","automation.triggered","webhook.test");
    }

    private String generateSecret() {
        return "whsec_" + UUID.randomUUID().toString().replace("-", "");
    }
}

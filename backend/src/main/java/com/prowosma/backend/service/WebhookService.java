package com.prowosma.backend.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.model.Webhook;
import com.prowosma.backend.repository.WebhookRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.*;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.*;

@Slf4j
@Service
@RequiredArgsConstructor
public class WebhookService {

    private final WebhookRepository webhookRepository;
    private final ObjectMapper       objectMapper;

    // ── CRUD ───────────────────────────────────────────────────
    public Webhook create(Webhook webhook, String orgId, String createdBy) {
        webhook.setOrganizationId(orgId);
        webhook.setCreatedBy(createdBy);
        webhook.setCreatedAt(LocalDateTime.now());
        if (webhook.getSecret() == null || webhook.getSecret().isBlank())
            webhook.setSecret(generateSecret());
        return webhookRepository.save(webhook);
    }

    public List<Webhook> getAll(String orgId) {
        return webhookRepository.findByOrganizationId(orgId);
    }

    public Webhook getById(String id) {
        return webhookRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Webhook not found: " + id));
    }

    public Webhook update(String id, Webhook updated) {
        Webhook existing = getById(id);
        if (updated.getName()   != null) existing.setName(updated.getName());
        if (updated.getUrl()    != null) existing.setUrl(updated.getUrl());
        if (updated.getEvents() != null) existing.setEvents(updated.getEvents());
        existing.setActive(updated.isActive());
        return webhookRepository.save(existing);
    }

    public void delete(String id) {
        webhookRepository.deleteById(id);
    }

    public Webhook regenerateSecret(String id) {
        Webhook wh = getById(id);
        wh.setSecret(generateSecret());
        return webhookRepository.save(wh);
    }

    // ── Fire webhooks matching an event ───────────────────────
    @Async
    public void fire(String orgId, String eventType, Map<String, Object> payload) {
        List<Webhook> hooks = webhookRepository.findByOrganizationIdAndActiveTrue(orgId);
        for (Webhook wh : hooks) {
            if (wh.getEvents() != null
                    && !wh.getEvents().contains("*")
                    && !wh.getEvents().contains(eventType)) continue;
            deliverAsync(wh, eventType, payload);
        }
    }

    private void deliverAsync(Webhook wh, String eventType, Map<String, Object> payload) {
        try {
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("event",     eventType);
            body.put("timestamp", LocalDateTime.now().toString());
            body.put("data",      payload);

            String json      = objectMapper.writeValueAsString(body);
            String signature = sign(json, wh.getSecret());

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.set("X-Prowosma-Signature", "sha256=" + signature);
            headers.set("X-Prowosma-Event",     eventType);
            headers.set("User-Agent",             "Prowosma-Webhooks/1.0");

            RestTemplate rt = new RestTemplate();
            rt.postForEntity(wh.getUrl(), new HttpEntity<>(json, headers), String.class);

            wh.setTotalFired(wh.getTotalFired() + 1);
            wh.setLastFiredAt(LocalDateTime.now());
            wh.setLastStatus("SUCCESS");
            webhookRepository.save(wh);
            log.debug("Webhook fired: {} → {} [{}]", eventType, wh.getUrl(), wh.getId());

        } catch (Exception e) {
            wh.setTotalFailed(wh.getTotalFailed() + 1);
            wh.setLastStatus("FAILED");
            wh.setLastFiredAt(LocalDateTime.now());
            webhookRepository.save(wh);
            log.warn("Webhook delivery failed: {} → {}: {}", eventType, wh.getUrl(), e.getMessage());
        }
    }

    // ── HMAC-SHA256 signing ───────────────────────────────────
    private String sign(String payload, String secret) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] bytes = mac.doFinal(payload.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : bytes) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }

    private String generateSecret() {
        return "whsec_" + UUID.randomUUID().toString().replace("-", "")
               + UUID.randomUUID().toString().replace("-", "");
    }
}

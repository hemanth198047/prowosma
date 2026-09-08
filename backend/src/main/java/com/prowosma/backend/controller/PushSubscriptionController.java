package com.prowosma.backend.controller;

import com.prowosma.backend.model.PushSubscription;
import com.prowosma.backend.repository.PushSubscriptionRepository;
import com.prowosma.backend.service.PushNotificationService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * Web Push subscription management — previously entirely absent (the
 * service worker in public/sw.js could RECEIVE a push, but nothing let a
 * browser actually subscribe, and nothing could send one). See
 * docs/MOBILE_OFFLINE.md for the honest scope of what's wired to trigger
 * automatically versus this being a real, tested, manually-triggerable
 * capability today.
 */
@RestController
@RequestMapping("/api/push")
@Tag(name = "Push Notifications", description = "Web Push (VAPID) subscription management")
@RequiredArgsConstructor
public class PushSubscriptionController {

    private final PushSubscriptionRepository subscriptionRepository;
    private final PushNotificationService pushNotificationService;

    @GetMapping("/vapid-public-key")
    @Operation(summary = "The VAPID public key the frontend needs for PushManager.subscribe()")
    public ResponseEntity<?> vapidPublicKey() {
        if (!pushNotificationService.isConfigured()) {
            return ResponseEntity.status(503).body(Map.of(
                "error", "PUSH_NOT_CONFIGURED",
                "message", "This deployment has not configured VAPID keys — see docs/MOBILE_OFFLINE.md."));
        }
        return ResponseEntity.ok(Map.of("publicKey", pushNotificationService.publicKey()));
    }

    @PostMapping("/subscribe")
    @Operation(summary = "Register a browser's push subscription for the current user")
    public ResponseEntity<?> subscribe(@RequestBody Map<String, Object> body, Authentication auth) {
        String endpoint = (String) body.get("endpoint");
        @SuppressWarnings("unchecked")
        Map<String, String> keys = (Map<String, String>) body.get("keys");
        if (endpoint == null || keys == null || keys.get("p256dh") == null || keys.get("auth") == null) {
            return ResponseEntity.badRequest().body(Map.of("message",
                "Expected the raw browser PushSubscription JSON: {endpoint, keys:{p256dh, auth}}"));
        }

        PushSubscription sub = subscriptionRepository.findByEndpoint(endpoint).orElseGet(PushSubscription::new);
        sub.setUserEmail(auth.getName());
        sub.setEndpoint(endpoint);
        sub.setP256dh(keys.get("p256dh"));
        sub.setAuth(keys.get("auth"));
        sub.setLastUsedAt(LocalDateTime.now());
        subscriptionRepository.save(sub);

        return ResponseEntity.ok(Map.of("subscribed", true));
    }

    @PostMapping("/unsubscribe")
    @Operation(summary = "Remove a browser's push subscription")
    public ResponseEntity<?> unsubscribe(@RequestBody Map<String, String> body) {
        String endpoint = body.get("endpoint");
        if (endpoint != null) subscriptionRepository.deleteByEndpoint(endpoint);
        return ResponseEntity.ok(Map.of("unsubscribed", true));
    }

    @PostMapping("/test")
    @Operation(summary = "Send a real test push to every subscription the current user has registered")
    public ResponseEntity<?> sendTest(Authentication auth) {
        int sent = pushNotificationService.sendToUser(
            auth.getName(), "Prowosma", "Push notifications are working! 🎉", "/");
        return ResponseEntity.ok(Map.of("sent", sent));
    }
}

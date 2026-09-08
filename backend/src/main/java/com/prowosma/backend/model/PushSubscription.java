package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.LocalDateTime;

/**
 * A single browser/device's Web Push subscription — the pieces the
 * browser's PushManager.subscribe() call returns (endpoint + the two
 * encryption keys), tied to the user who enabled it. One user can have
 * several (one per browser/device they've enabled notifications on).
 *
 * See PushNotificationService for how this gets used, and
 * docs/MOBILE_OFFLINE.md for the honest scope of what's actually wired
 * to send a push automatically versus what still needs per-call-site
 * work (Notification itself has no per-user recipient concept yet — see
 * that doc).
 */
@Data
@Document(collection = "push_subscriptions")
public class PushSubscription {
    @Id private String id;

    @Indexed
    private String userEmail;

    @Indexed(unique = true)
    private String endpoint;

    private String p256dh; // user's public key, base64url — from the browser subscription object
    private String auth;   // user's auth secret, base64url

    private LocalDateTime createdAt = LocalDateTime.now();
    private LocalDateTime lastUsedAt;
}

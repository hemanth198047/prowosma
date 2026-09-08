package com.prowosma.backend.service;

import com.prowosma.backend.model.PushSubscription;
import com.prowosma.backend.repository.PushSubscriptionRepository;
import io.micrometer.core.instrument.MeterRegistry;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import nl.martijndwars.webpush.Notification;
import nl.martijndwars.webpush.PushService;
import org.bouncycastle.jce.provider.BouncyCastleProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import jakarta.annotation.PostConstruct;
import java.security.Security;
import java.util.List;

/**
 * Sends real Web Push notifications via VAPID, to the service worker
 * already listening in public/sw.js (that file has had a working 'push'
 * event handler since before this change — only this sending side was
 * missing). Uses nl.martijndwars:webpush, the standard Java
 * implementation of the Web Push protocol.
 *
 * Opt-in via VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT — unset,
 * send() logs a warning and returns false rather than throwing, matching
 * the same "no-op until configured" pattern used for every other optional
 * integration in this codebase. See docs/MOBILE_OFFLINE.md for how to
 * generate a real VAPID key pair.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PushNotificationService {

    private final PushSubscriptionRepository subscriptionRepository;
    private final MeterRegistry meterRegistry;

    @Value("${push.vapid.public-key:}")  private String vapidPublicKey;
    @Value("${push.vapid.private-key:}") private String vapidPrivateKey;
    @Value("${push.vapid.subject:mailto:support@example.com}") private String vapidSubject;

    private PushService pushService;

    @PostConstruct
    void init() {
        Security.addProvider(new BouncyCastleProvider());
        if (isConfigured()) {
            try {
                pushService = new PushService(vapidPublicKey, vapidPrivateKey, vapidSubject);
                log.info("[PushNotificationService] Web Push is ACTIVE (VAPID configured).");
            } catch (Exception e) {
                log.error("[PushNotificationService] VAPID keys are set but invalid — Web Push disabled: {}", e.getMessage());
                pushService = null;
            }
        } else {
            log.warn("[PushNotificationService] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY are not set — Web " +
                "Push is disabled. The service worker can still RECEIVE a push if one is sent by some " +
                "other means, but this app cannot SEND one until these are configured. See docs/MOBILE_OFFLINE.md.");
        }
    }

    public boolean isConfigured() {
        return vapidPublicKey != null && !vapidPublicKey.isBlank()
            && vapidPrivateKey != null && !vapidPrivateKey.isBlank();
    }

    public String publicKey() {
        return vapidPublicKey;
    }

    /** Sends to every subscription this user has registered (all their browsers/devices). */
    public int sendToUser(String userEmail, String title, String body, String url) {
        if (!isConfigured() || pushService == null) {
            log.warn("[PushNotificationService] Push not configured — skipping send to {}", userEmail);
            return 0;
        }

        List<PushSubscription> subs = subscriptionRepository.findByUserEmail(userEmail);
        int sent = 0;
        String payload = "{\"title\":\"" + escapeJson(title) + "\",\"body\":\"" + escapeJson(body) +
            "\",\"url\":\"" + escapeJson(url != null ? url : "/") + "\"}";

        for (PushSubscription sub : subs) {
            try {
                Notification notification = new Notification(
                    sub.getEndpoint(), sub.getP256dh(), sub.getAuth(), payload.getBytes());
                var response = pushService.send(notification);
                int status = response.getStatusLine().getStatusCode();
                if (status == 404 || status == 410) {
                    // Endpoint gone (browser unsubscribed, extension removed, etc.) — clean up
                    // rather than keep retrying a dead subscription forever.
                    subscriptionRepository.deleteByEndpoint(sub.getEndpoint());
                    log.info("[PushNotificationService] Removed expired subscription for {}", userEmail);
                } else if (status >= 200 && status < 300) {
                    sent++;
                    meterRegistry.counter("push.send.success").increment();
                } else {
                    log.warn("[PushNotificationService] Push send to {} returned status {}", userEmail, status);
                    meterRegistry.counter("push.send.failure").increment();
                }
            } catch (Exception e) {
                log.warn("[PushNotificationService] Failed to send push to {}: {}", userEmail, e.getMessage());
                meterRegistry.counter("push.send.failure").increment();
            }
        }
        return sent;
    }

    private static String escapeJson(String s) {
        return s == null ? "" : s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ");
    }
}

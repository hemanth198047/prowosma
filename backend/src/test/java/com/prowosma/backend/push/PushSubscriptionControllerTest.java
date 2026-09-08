package com.prowosma.backend.push;

import com.prowosma.backend.ProwosmaTestBase;
import com.prowosma.backend.repository.PushSubscriptionRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Verifies the Web Push subscription flow — previously nothing existed
 * to let a browser subscribe, and PWAInstallBanner.jsx advertised
 * "🔔 Push Notifications" as a feature with no way to actually enable it.
 * VAPID keys are NOT configured in the test profile, so send behavior
 * itself (which requires real keys) isn't exercised here — see
 * PushNotificationService's own no-op-when-unconfigured behavior, which
 * is exactly what these tests confirm from the API surface.
 */
@DisplayName("Push subscription management")
class PushSubscriptionControllerTest extends ProwosmaTestBase {

    @Autowired private PushSubscriptionRepository subscriptionRepository;

    @Test
    @DisplayName("vapid-public-key returns 503 when push isn't configured (no VAPID keys in test profile)")
    void vapidPublicKey_returns503WhenUnconfigured() throws Exception {
        mvc.perform(get("/api/push/vapid-public-key")
                .header("Authorization", authHeader(ownerToken())))
           .andExpect(status().isServiceUnavailable())
           .andExpect(jsonPath("$.error").value("PUSH_NOT_CONFIGURED"));
    }

    @Test
    @DisplayName("Subscribing persists the subscription tied to the authenticated user")
    void subscribe_persistsSubscription() throws Exception {
        String body = "{\"endpoint\":\"https://fcm.googleapis.com/fcm/send/test-endpoint-1\"," +
            "\"keys\":{\"p256dh\":\"test-p256dh-key\",\"auth\":\"test-auth-secret\"}}";

        mvc.perform(post("/api/push/subscribe")
                .header("Authorization", authHeader(ownerToken()))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.subscribed").value(true));

        var subs = subscriptionRepository.findByUserEmail(ownerEmail);
        assertEquals(1, subs.size());
        assertEquals("https://fcm.googleapis.com/fcm/send/test-endpoint-1", subs.get(0).getEndpoint());
    }

    @Test
    @DisplayName("Re-subscribing with the same endpoint updates rather than duplicates")
    void subscribe_sameEndpointTwice_updatesNotDuplicates() throws Exception {
        String body = "{\"endpoint\":\"https://fcm.googleapis.com/fcm/send/dedup-test\"," +
            "\"keys\":{\"p256dh\":\"key-v1\",\"auth\":\"auth-v1\"}}";
        mvc.perform(post("/api/push/subscribe")
                .header("Authorization", authHeader(ownerToken()))
                .contentType(MediaType.APPLICATION_JSON).content(body))
           .andExpect(status().isOk());

        String bodyV2 = "{\"endpoint\":\"https://fcm.googleapis.com/fcm/send/dedup-test\"," +
            "\"keys\":{\"p256dh\":\"key-v2\",\"auth\":\"auth-v2\"}}";
        mvc.perform(post("/api/push/subscribe")
                .header("Authorization", authHeader(ownerToken()))
                .contentType(MediaType.APPLICATION_JSON).content(bodyV2))
           .andExpect(status().isOk());

        var subs = subscriptionRepository.findByUserEmail(ownerEmail).stream()
            .filter(s -> "https://fcm.googleapis.com/fcm/send/dedup-test".equals(s.getEndpoint()))
            .toList();
        assertEquals(1, subs.size(), "Same endpoint must update the existing record, not create a duplicate");
        assertEquals("key-v2", subs.get(0).getP256dh());
    }

    @Test
    @DisplayName("Unsubscribing removes the subscription")
    void unsubscribe_removesSubscription() throws Exception {
        String body = "{\"endpoint\":\"https://fcm.googleapis.com/fcm/send/to-remove\"," +
            "\"keys\":{\"p256dh\":\"k\",\"auth\":\"a\"}}";
        mvc.perform(post("/api/push/subscribe")
                .header("Authorization", authHeader(ownerToken()))
                .contentType(MediaType.APPLICATION_JSON).content(body))
           .andExpect(status().isOk());
        assertTrue(subscriptionRepository.findByEndpoint("https://fcm.googleapis.com/fcm/send/to-remove").isPresent());

        mvc.perform(post("/api/push/unsubscribe")
                .header("Authorization", authHeader(ownerToken()))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"endpoint\":\"https://fcm.googleapis.com/fcm/send/to-remove\"}"))
           .andExpect(status().isOk());

        assertTrue(subscriptionRepository.findByEndpoint("https://fcm.googleapis.com/fcm/send/to-remove").isEmpty());
    }

    @Test
    @DisplayName("Malformed subscription body is rejected with 400, not silently accepted")
    void subscribe_malformedBody_rejected() throws Exception {
        mvc.perform(post("/api/push/subscribe")
                .header("Authorization", authHeader(ownerToken()))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"endpoint\":\"https://example.com/x\"}")) // missing "keys"
           .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("/test returns 0 sent (not an error) when push isn't configured — no-op, not a crash")
    void testEndpoint_noOpsGracefullyWhenUnconfigured() throws Exception {
        mvc.perform(post("/api/push/test")
                .header("Authorization", authHeader(ownerToken())))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.sent").value(0));
    }
}

package com.prowosma.backend.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.Locale;
import java.util.concurrent.CompletableFuture;

/**
 * Tells one person something: a desktop/phone notification through Web Push, so it shows even when Prowosma isn't open.
 * Sent in the background - a slow or failing push service never slows down or breaks the request that caused it.
 * Does nothing (quietly) when push isn't configured (no VAPID keys) or the person hasn't turned notifications on.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PersonalAlertService {
    private final PushNotificationService push;

    public void tell(String email, String title, String body, String url) {
        if (email == null || email.isBlank() || !push.isConfigured()) return;
        String to = email.trim().toLowerCase(Locale.ROOT);
        CompletableFuture.runAsync(() -> {
            try { push.sendToUser(to, title, body, url); }
            catch (RuntimeException e) { log.warn("[PersonalAlert] push to a user failed: {}", e.getClass().getSimpleName()); }
        });
    }
}

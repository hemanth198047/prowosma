package com.prowosma.backend.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.util.HtmlUtils;
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
    private final EmailService email;

    @Value("${app.alerts.email-reminders:true}")
    private boolean emailReminders = true;
    @Value("${app.frontend.url:http://localhost:5173}")
    private String frontendUrl = "http://localhost:5173";

    public void tell(String email, String title, String body, String url) {
        if (email == null || email.isBlank() || !push.isConfigured()) return;
        String to = email.trim().toLowerCase(Locale.ROOT);
        CompletableFuture.runAsync(() -> {
            try { push.sendToUser(to, title, body, url); }
            catch (RuntimeException e) { log.warn("[PersonalAlert] push to a user failed: {}", e.getClass().getSimpleName()); }
        });
    }

    /**
     * The same nudge by e-mail, for people who are not looking at Prowosma and have not turned on browser notifications. Background, best effort,
     * and a plain message: the text is escaped and the only link goes to this app.
     */
    public void tellByEmail(String address, String subject, String body, String path) {
        if (!emailReminders || address == null || address.isBlank()) return;
        String to = address.trim().toLowerCase(Locale.ROOT);
        String safeSubject = (subject == null ? "Reminder" : subject.replaceAll("[\\r\\n]+", " ").trim());
        String link = frontendUrl.replaceAll("/+$", "") + (path == null ? "" : path);
        String html = "<div style=\"font-family:Arial,sans-serif;max-width:480px\"><h3>" + HtmlUtils.htmlEscape(safeSubject) + "</h3><p>"
                + HtmlUtils.htmlEscape(body == null ? "" : body) + "</p><p><a href=\"" + HtmlUtils.htmlEscape(link) + "\">Open Prowosma</a></p></div>";
        CompletableFuture.runAsync(() -> {
            try { email.sendHtmlEmail(to, null, safeSubject, html); }
            catch (RuntimeException e) { log.warn("[PersonalAlert] reminder e-mail failed: {}", e.getClass().getSimpleName()); }
        });
    }
}

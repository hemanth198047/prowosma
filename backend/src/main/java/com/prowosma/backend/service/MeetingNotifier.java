package com.prowosma.backend.service;

import com.prowosma.backend.model.Meeting;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.util.HtmlUtils;

import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.CompletableFuture;

/**
 * Tells people about meetings: an e-mail invitation when they are added to a meeting, and a "starting soon" reminder just before it begins
 * (the reminder is sent by {@link DesktopAlerts}, which calls {@link #remind}). Both are best-effort and run in the background, so a mail
 * server or push service that is down never makes saving a meeting fail. Meeting times are stored in UTC and shown as UTC with a
 * link back to the app, where the person's own time zone applies.
 */
@Slf4j
@Service
public class MeetingNotifier {
    private static final DateTimeFormatter WHEN = DateTimeFormatter.ofPattern("EEE d MMM yyyy, HH:mm", Locale.ENGLISH);

    private final EmailService email;
    private final PersonalAlertService alerts;

    @Value("${app.frontend.url:http://localhost:5173}")
    private String frontendUrl = "http://localhost:5173";
    @Value("${app.meetings.invite-emails:true}")
    private boolean inviteEmails = true;
    @Value("${app.meetings.reminder-emails:true}")
    private boolean reminderEmails = true;

    public MeetingNotifier(EmailService email, PersonalAlertService alerts) { this.email = email; this.alerts = alerts; }

    /** Everyone who should hear about a meeting: its attendees and its organizer, lower-cased, de-duplicated, e-mail addresses only. */
    public static Set<String> recipients(Meeting m) {
        Set<String> out = new LinkedHashSet<>();
        if (m.getAttendees() != null) for (String a : m.getAttendees()) add(out, a);
        add(out, m.getCreatedBy());
        return out;
    }

    private static void add(Set<String> to, String address) {
        if (address == null) return;
        String a = address.trim().toLowerCase(Locale.ROOT);
        if (a.length() <= 254 && a.matches("[^\\s@<>\"]+@[^\\s@<>\"]+\\.[^\\s@<>\"]+")) to.add(a);
    }

    /** The addresses on {@code after} that were not on {@code before}: the people who still need an invitation. */
    public static Set<String> newlyAdded(Collection<String> before, Collection<String> after) {
        Set<String> was = new HashSet<>();
        if (before != null) for (String b : before) add(was, b);
        Set<String> now = new LinkedHashSet<>();
        if (after != null) for (String a : after) add(now, a);
        now.removeAll(was);
        return now;
    }

    /** Sends the invitation to these people (never to the person who made the meeting). Returns how many were queued. */
    public int invite(Meeting m, Collection<String> to, String organizer) {
        if (!inviteEmails || m == null || to == null || to.isEmpty()) return 0;
        String from = organizer == null ? "" : organizer.trim().toLowerCase(Locale.ROOT);
        List<String> targets = to.stream().filter(a -> !a.equalsIgnoreCase(from)).distinct().toList();
        if (targets.isEmpty()) return 0;
        String subject = "Invitation: " + safeSubject(m.getTitle());
        String html = body(m, "You have been invited to a meeting", organizer == null ? "" : "Organizer: " + HtmlUtils.htmlEscape(organizer));
        for (String addr : targets) {
            CompletableFuture.runAsync(() -> {
                try {
                    if (!email.sendHtmlEmail(addr, null, subject, html)) log.warn("[Meeting] invitation to a guest was not delivered (see the e-mail log)");
                } catch (RuntimeException e) { log.warn("[Meeting] invitation failed: {}", e.getClass().getSimpleName()); }
            });
        }
        return targets.size();
    }

    /** Most people one "resend" will e-mail in a single request (each one is sent and checked before the answer is returned). */
    public static final int RESEND_LIMIT = 30;

    /**
     * Sends the invitation again, now, and tells the caller who it reached: unlike {@link #invite}, which sends in the background, a resend
     * waits for each message so the person pressing the button learns whether the mail server accepted it.
     * Returns address -> accepted. Addresses on the mail provider's suppression list (earlier hard bounces) come back false.
     */
    public Map<String, Boolean> resend(Meeting m, Collection<String> to, String organizer) {
        Map<String, Boolean> result = new LinkedHashMap<>();
        if (m == null || to == null) return result;
        String subject = "Invitation (sent again): " + safeSubject(m.getTitle());
        String html = body(m, "You are invited to a meeting", organizer == null ? "" : "Organizer: " + HtmlUtils.htmlEscape(organizer));
        int n = 0;
        for (String addr : to) {
            if (n++ >= RESEND_LIMIT) break;
            boolean ok;
            try { ok = email.sendHtmlEmail(addr, null, subject, html); }
            catch (RuntimeException e) { ok = false; log.warn("[Meeting] resend failed: {}", e.getClass().getSimpleName()); }
            result.put(addr, ok);
        }
        return result;
    }

    /**
     * The same "send it again" for a meeting that is not in the notes model (the AI Meeting Assistant's, whose invitations come from Google
     * Calendar or Outlook): an e-mail with the time and the join link. Returns address -> accepted, like {@link #resend}.
     */
    public Map<String, Boolean> resendInvite(String title, java.time.Instant start, java.time.Instant end, String joinLink, String openPath,
                                            Collection<String> to, String organizer) {
        return sendInvite("Invitation (sent again): ", title, start, end, null, joinLink, openPath, to, organizer);
    }

    /** True for addresses Google itself hosts (gmail.com / googlemail.com): Google Calendar's own invitation reliably reaches them. */
    public static boolean isGoogleMailbox(String address) {
        if (address == null) return false;
        String a = address.trim().toLowerCase(Locale.ROOT);
        return a.endsWith("@gmail.com") || a.endsWith("@googlemail.com");
    }

    /**
     * Prowosma's own invitation for a meeting that was just scheduled in Google Calendar or Teams, sent in the background to every guest except the
     * organizer. The calendar's invitation can be dropped or sent to junk by company mail servers (Titan / GoDaddy, for one), and when that happens
     * the guest never hears about the meeting; this e-mail carries the time (in the organizer's time zone) and the join link, so they always do.
     * Returns how many e-mails were queued.
     */
    public int inviteScheduled(String title, java.time.Instant start, java.time.Instant end, String timezone, String joinLink, String openPath,
                               Collection<String> to, String organizer) {
        if (!inviteEmails || to == null || to.isEmpty()) return 0;
        String from = organizer == null ? "" : organizer.trim().toLowerCase(Locale.ROOT);
        List<String> targets = to.stream().filter(a -> a != null && !a.isBlank() && !a.trim().equalsIgnoreCase(from)).map(a -> a.trim().toLowerCase(Locale.ROOT)).distinct().toList();
        if (targets.isEmpty()) return 0;
        String subject = "Invitation: " + safeSubject(title);
        String html = inviteHtml(title, start, end, timezone, joinLink, openPath, organizer);
        for (String addr : targets) {
            CompletableFuture.runAsync(() -> {
                try {
                    if (!email.sendHtmlEmail(addr, null, subject, html)) log.warn("[Meeting] invitation to a guest was not delivered (see the e-mail log)");
                } catch (RuntimeException e) { log.warn("[Meeting] invitation failed: {}", e.getClass().getSimpleName()); }
            });
        }
        return targets.size();
    }

    private Map<String, Boolean> sendInvite(String subjectPrefix, String title, java.time.Instant start, java.time.Instant end, String timezone,
                                            String joinLink, String openPath, Collection<String> to, String organizer) {
        Map<String, Boolean> result = new LinkedHashMap<>();
        if (to == null) return result;
        String html = inviteHtml(title, start, end, timezone, joinLink, openPath, organizer);
        String subject = subjectPrefix + safeSubject(title);
        int n = 0;
        for (String addr : to) {
            if (n++ >= RESEND_LIMIT) break;
            boolean ok;
            try { ok = email.sendHtmlEmail(addr, null, subject, html); }
            catch (RuntimeException e) { ok = false; log.warn("[Meeting] resend failed: {}", e.getClass().getSimpleName()); }
            result.put(addr, ok);
        }
        return result;
    }

    private String inviteHtml(String title, java.time.Instant start, java.time.Instant end, String timezone, String joinLink, String openPath, String organizer) {
        java.time.ZoneId zone = ZoneOffset.UTC;
        try { if (timezone != null && !timezone.isBlank()) zone = java.time.ZoneId.of(timezone.trim()); } catch (RuntimeException ignored) { /* unknown zone: show UTC */ }
        String when = start == null ? "Time to be confirmed"
                : DateTimeFormatter.ofPattern("EEE d MMM yyyy, HH:mm z", Locale.ENGLISH).format(start.atZone(zone))
                + (end == null ? "" : " (" + Math.max(1, java.time.Duration.between(start, end).toMinutes()) + " min)");
        String where = joinLink == null ? "" : joinLink.trim();
        return "<div style=\"font-family:Arial,sans-serif;max-width:520px\"><h2>You are invited to a meeting</h2>"
                + "<p><b>" + HtmlUtils.htmlEscape(safeSubject(title)) + "</b></p><p><b>When:</b> " + HtmlUtils.htmlEscape(when) + "</p>"
                + (where.isEmpty() ? "" : "<p><b>Join:</b> " + linkify(where) + "</p>")
                + (organizer == null || organizer.isBlank() ? "" : "<p>Organizer: " + HtmlUtils.htmlEscape(organizer) + "</p>")
                + "<p><a href=\"" + frontendUrl.replaceAll("/+$", "") + HtmlUtils.htmlEscape(openPath == null ? "/meetings" : openPath) + "\">Open in Prowosma</a></p></div>";
    }

    /** One person's "starting soon" reminder: a push notification, and an e-mail unless switched off. */
    public void remind(Meeting m, String address, long minutesLeft) {
        String when = minutesLeft <= 0 ? "now" : "in " + minutesLeft + " min";
        alerts.tell(address, "Meeting starting " + when, safeSubject(m.getTitle()), "/meetings?open=" + m.getId());
        if (!reminderEmails) return;
        String subject = "Starting " + when + ": " + safeSubject(m.getTitle());
        String html = body(m, "Your meeting starts " + when, "");
        CompletableFuture.runAsync(() -> {
            try { email.sendHtmlEmail(address, null, subject, html); }
            catch (RuntimeException e) { log.warn("[Meeting] reminder e-mail failed: {}", e.getClass().getSimpleName()); }
        });
    }

    private static String safeSubject(String title) {
        String t = title == null || title.isBlank() ? "Meeting" : title.replaceAll("[\\r\\n]+", " ").trim();
        return t.length() > 120 ? t.substring(0, 120) : t;
    }

    private String body(Meeting m, String heading, String extra) {
        LocalDateTime start = m.getMeetingDate();
        String when = start == null ? "Time to be confirmed" : WHEN.format(start.atOffset(ZoneOffset.UTC)) + " UTC"
                + (m.getDurationMins() == null ? "" : " (" + m.getDurationMins() + " min)");
        String where = m.getLocation() == null ? "" : m.getLocation().trim();
        String whereHtml = where.isEmpty() ? "" : "<p><b>Where:</b> " + linkify(where) + "</p>";
        String open = frontendUrl.replaceAll("/+$", "") + "/meetings?open=" + HtmlUtils.htmlEscape(String.valueOf(m.getId()));
        return "<div style=\"font-family:Arial,sans-serif;max-width:520px\"><h2>" + HtmlUtils.htmlEscape(heading) + "</h2>"
                + "<p><b>" + HtmlUtils.htmlEscape(safeSubject(m.getTitle())) + "</b></p>"
                + "<p><b>When:</b> " + HtmlUtils.htmlEscape(when) + "</p>" + whereHtml
                + (extra.isEmpty() ? "" : "<p>" + extra + "</p>")
                + "<p><a href=\"" + open + "\">Open in Prowosma</a></p></div>";
    }

    /** Escapes the text, and turns a web address in it into a link (http/https only, so nothing else can be injected). */
    static String linkify(String text) {
        String esc = HtmlUtils.htmlEscape(text);
        return esc.replaceAll("(https?://[^\\s<>&\"']+)", "<a href=\"$1\">$1</a>");
    }
}

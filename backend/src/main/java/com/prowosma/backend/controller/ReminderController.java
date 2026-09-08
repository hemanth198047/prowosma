package com.prowosma.backend.controller;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.service.DigestService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * "Send Reminder Now" — a manual trigger for this workspace's daily
 * digest email, for whoever doesn't want to wait for the 8am scheduled run.
 *
 * Previously backed by ReminderService, which had two real bugs: it
 * depended on the request-scoped WorkspaceContext bean, so despite its own
 * name it could never actually run as a background job (Spring throws
 * outside an active request) — it only ever worked as this manual button.
 * And every workspace's reminder went to one single hardcoded
 * app.reminder.email address rather than that workspace's actual members,
 * so two different workspaces clicking "Send Reminder Now" would both
 * notify the exact same inbox about neither workspace's real overdue work.
 *
 * Now delegates to DigestService.sendDailyDigestNowFor(), the same
 * correctly-scheduled, correctly-addressed logic the automatic 8am digest
 * uses — this button just runs it immediately for the caller's own
 * workspace instead of waiting for the cron trigger, and ignores that
 * workspace's dailyDigest opt-out since clicking the button is itself an
 * explicit request.
 */
@RestController
@RequestMapping("/api/reminders")
@RequiredArgsConstructor
public class ReminderController {

    private final DigestService    digestService;
    private final WorkspaceContext workspaceContext;

    @PostMapping("/send-now")
    public Map<String, String> sendNow() {
        digestService.sendDailyDigestNowFor(workspaceContext.getWorkspaceId());
        return Map.of("message", "Reminder sent to your workspace's members.");
    }
}

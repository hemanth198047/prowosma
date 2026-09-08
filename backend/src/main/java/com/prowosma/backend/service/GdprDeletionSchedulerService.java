package com.prowosma.backend.service;

import com.prowosma.backend.model.User;
import com.prowosma.backend.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;

/**
 * Actually performs the deferred account deletion that
 * SecurityController's POST /api/security/gdpr/delete-request promises.
 *
 * BEFORE THIS CLASS EXISTED: that endpoint returned "Your account will be
 * permanently deleted within 30 days" without recording the request
 * anywhere or scheduling anything — a real, false compliance claim (the
 * endpoint's own prior comment admitted as much: "In a real app this
 * would trigger a deletion workflow"). This is that workflow.
 *
 * Runs daily; deletes any user whose gdprDeletionScheduledFor has passed,
 * via the same UserDeletionService.deleteUser(...) path the immediate
 * self-service deletion endpoint uses — one deletion implementation,
 * two ways to trigger it (now vs. after a grace period), not two
 * different (and potentially inconsistent) deletion code paths.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class GdprDeletionSchedulerService {

    private final UserRepository userRepository;
    private final UserDeletionService userDeletionService;
    private final ActivityLogService activityLogService;

    @Scheduled(cron = "0 0 4 * * *") // daily, 04:00 server time
    public void purgeDueDeletions() {
        var due = userRepository.findByGdprDeletionScheduledForLessThanEqual(LocalDateTime.now());
        if (due.isEmpty()) return;

        log.info("[GdprDeletionSchedulerService] {} account(s) due for scheduled GDPR deletion", due.size());
        for (User user : due) {
            String email = user.getEmail();
            try {
                userDeletionService.deleteUser(email);
                log.info("[GdprDeletionSchedulerService] Completed scheduled deletion for {}", email);
                activityLogService.log("USER", email, email,
                        "GDPR_SCHEDULED_DELETION_COMPLETED", null, null, "system:gdpr-scheduler");
            } catch (Exception e) {
                // Don't let one failed deletion (e.g. a data-integrity issue in
                // one account) stop the rest of the sweep from running, and
                // don't silently drop the failure either — it needs a human
                // to look at it, since this account is now overdue on a
                // compliance-relevant deletion promise.
                log.error("[GdprDeletionSchedulerService] FAILED scheduled deletion for {} — needs manual " +
                    "follow-up, this account is now overdue on its deletion commitment: {}", email, e.getMessage());
                activityLogService.log("USER", email, email,
                        "GDPR_SCHEDULED_DELETION_FAILED", null, e.getMessage(), "system:gdpr-scheduler");
            }
        }
    }
}

package com.prowosma.backend.uma.app;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Hourly: deletes uploaded recordings once transcribed and past app.uma.recording-retention-hours, and whole meetings older than each
 * workspace's retention (default 15 days; admins change it in Settings, 0 keeps them). Tasks created from meetings are never deleted.
 */
@Component
@Slf4j
public class UmaRetention {
    private final UmaService service;
    @Value("${app.uma.jobs-enabled:true}") private boolean enabled = true;

    public UmaRetention(UmaService service) { this.service = service; }

    @Scheduled(fixedDelayString = "${app.uma.retention-check-ms:3600000}", initialDelayString = "${app.uma.retention-initial-delay-ms:300000}")
    public void run() {
        if (!enabled) return;
        try {
            int n = service.purgeRecordings();
            if (n > 0) log.info("uma retention: deleted {} recording(s)", n);
            int old = service.purgeOldMeetings();
            if (old > 0) log.info("uma retention: deleted {} meeting(s) past their workspace's retention", old);
        } catch (Exception e) {
            log.warn("uma retention failed: {}", e.getClass().getSimpleName());
        }
    }
}

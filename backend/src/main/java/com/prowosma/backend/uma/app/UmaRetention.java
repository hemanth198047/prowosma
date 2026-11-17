package com.prowosma.backend.uma.app;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Deletes uploaded recordings once they have been transcribed and the retention window (app.uma.recording-retention-hours) has passed. */
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
        } catch (Exception e) {
            log.warn("uma retention failed: {}", e.getClass().getSimpleName());
        }
    }
}

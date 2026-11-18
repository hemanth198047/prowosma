package com.prowosma.backend.attendance.app;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Instant;

/** Every five minutes: close sessions nobody clocked out of (after the workspace's limit) so a forgotten punch can't run for days. */
@Component
@Slf4j
public class AttendanceJobs {
    private final AttendanceService service;

    @Value("${app.attendance.jobs-enabled:true}")
    private boolean enabled = true;

    public AttendanceJobs(AttendanceService service) { this.service = service; }

    @Scheduled(fixedDelayString = "${app.attendance.sweep-ms:300000}", initialDelayString = "${app.attendance.sweep-initial-ms:60000}")
    public void sweep() {
        if (!enabled) return;
        try {
            int n = service.autoClose(Instant.now());
            if (n > 0) log.info("attendance: closed {} forgotten session(s)", n);
        } catch (RuntimeException e) {
            log.warn("attendance sweep failed: {}", e.getClass().getSimpleName());
        }
    }
}

package com.prowosma.backend.service;

import com.prowosma.backend.model.Automation;
import com.prowosma.backend.repository.AutomationRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.scheduling.support.CronTrigger;
import org.springframework.stereotype.Service;

import jakarta.annotation.PostConstruct;
import java.util.List;
import java.util.Map;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledFuture;

/**
 * P2-2: Scheduled Automation Triggers
 * Polls DB every minute for automations with triggerType=SCHEDULED + cronExpr.
 * Registers/unregisters dynamic cron jobs per automation.
 */
@Service
@RequiredArgsConstructor
public class AutomationSchedulerService {

    private final AutomationRepository automationRepository;
    private final AutomationService    automationService;
    private final TaskScheduler        taskScheduler;

    // Map of automationId -> running scheduled future
    private final Map<String, ScheduledFuture<?>> scheduled = new ConcurrentHashMap<>();

    @PostConstruct
    public void init() {
        refreshSchedules();
    }

    /** Refresh every minute — picks up newly created/enabled/disabled scheduled automations */
    @Scheduled(fixedDelay = 60_000)
    public void refreshSchedules() {
        // Cancel any removed/disabled automations
        scheduled.forEach((id, future) -> {
            Automation a = automationRepository.findById(id).orElse(null);
            if (a == null || !a.isEnabled() || !"SCHEDULED".equals(a.getTriggerType())) {
                future.cancel(false);
                scheduled.remove(id);
            }
        });

        // Register new scheduled automations
        automationRepository.findAll().stream()
            .filter(a -> a.isEnabled() && "SCHEDULED".equals(a.getTriggerType()))
            .filter(a -> a.getTriggerConfig() != null && a.getTriggerConfig().containsKey("cronExpr"))
            .filter(a -> !scheduled.containsKey(a.getId()))
            .forEach(a -> {
                try {
                    String cronExpr = (String) a.getTriggerConfig().get("cronExpr");
                    ScheduledFuture<?> future = taskScheduler.schedule(
                        () -> executeScheduledAutomation(a.getId()),
                        new CronTrigger(cronExpr)
                    );
                    scheduled.put(a.getId(), future);
                    System.out.println("✅ Scheduled automation: " + a.getName() + " [" + cronExpr + "]");
                } catch (Exception e) {
                    System.err.println("❌ Invalid cron for automation " + a.getName() + ": " + e.getMessage());
                }
            });
    }

    private void executeScheduledAutomation(String automationId) {
        try {
            automationService.trigger("SCHEDULED", "AUTOMATION", automationId, java.util.Map.of("trigger", "SCHEDULED"));
            System.out.println("🔄 Scheduled automation ran: " + automationId);
        } catch (Exception e) {
            System.err.println("❌ Scheduled automation failed: " + automationId + " — " + e.getMessage());
        }
    }

    /** Called externally when an automation is created/updated to refresh immediately */
    public void notifyUpdated(String automationId) {
        // Cancel old schedule
        ScheduledFuture<?> existing = scheduled.remove(automationId);
        if (existing != null) existing.cancel(false);
        // Re-register if still valid
        refreshSchedules();
    }
}

package com.prowosma.backend.service;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.Goal;
import com.prowosma.backend.model.KpiMetric;
import com.prowosma.backend.repository.GoalRepository;
import com.prowosma.backend.repository.KpiMetricRepository;
import com.prowosma.backend.service.ActivityLogService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.*;
import java.util.List;

@Service
@RequiredArgsConstructor
public class KpiService {

    private final KpiMetricRepository    kpiRepository;
    private final GoalRepository         goalRepository;
    private final NotificationService    notificationService;
    private final WorkspaceContext       workspaceContext;
    private final ActivityLogService     activityLogService;

    // ── CRUD ─────────────────────────────────────────────────────

    public List<KpiMetric> getAll() {
        return kpiRepository.findByOrganizationId(workspaceContext.getWorkspaceId());
    }

    public KpiMetric getById(String id) {
        return kpiRepository.findById(id)
            .orElseThrow(() -> new RuntimeException("KPI not found: " + id));
    }

    public KpiMetric create(KpiMetric kpi, String author) {
        kpi.setOrganizationId(workspaceContext.getWorkspaceId());
        kpi.setCreatedBy(author);
        kpi.setCreatedAt(LocalDateTime.now());
        kpi.setUpdatedAt(LocalDateTime.now());
        KpiMetric saved = kpiRepository.save(kpi);
        activityLogService.log("KPI", saved.getId(), saved.getName(),
                "CREATED", null, saved.getName(), null);
        return saved;
    }

    public KpiMetric update(String id, KpiMetric patch) {
        KpiMetric existing = getById(id);
        if (patch.getName()        != null) existing.setName(patch.getName());
        if (patch.getDescription() != null) existing.setDescription(patch.getDescription());
        if (patch.getUnit()        != null) existing.setUnit(patch.getUnit());
        if (patch.getCategory()    != null) existing.setCategory(patch.getCategory());
        if (patch.getOwner()       != null) existing.setOwner(patch.getOwner());
        if (patch.getPeriod()      != null) existing.setPeriod(patch.getPeriod());
        if (patch.getLinkedGoalId()!= null) existing.setLinkedGoalId(patch.getLinkedGoalId());
        existing.setTargetValue(patch.getTargetValue());
        existing.setAlertThreshold(patch.getAlertThreshold());
        existing.setAlertDirection(patch.getAlertDirection() != null ? patch.getAlertDirection() : "BELOW");
        existing.setAlertEnabled(patch.isAlertEnabled());
        existing.setUpdatedAt(LocalDateTime.now());
        return kpiRepository.save(existing);
    }

    public void delete(String id) {
        activityLogService.log("KPI", id, id, "DELETED", null, null, null);
        kpiRepository.deleteById(id);
    }

    // ── Record a new value ────────────────────────────────────────

    public KpiMetric recordValue(String id, double value, String note) {
        KpiMetric kpi = getById(id);
        kpi.setCurrentValue(value);

        // Add to history
        KpiMetric.ValueSnapshot snap = new KpiMetric.ValueSnapshot();
        snap.setId(UUID.randomUUID().toString());
        snap.setValue(value);
        snap.setNote(note != null ? note : "");
        snap.setRecordedAt(LocalDateTime.now());
        if (kpi.getHistory() == null) kpi.setHistory(new ArrayList<>());
        kpi.getHistory().add(0, snap);
        // Keep last 52 snapshots
        if (kpi.getHistory().size() > 52)
            kpi.setHistory(kpi.getHistory().subList(0, 52));

        // Update status
        double range = kpi.getTargetValue() - kpi.getBaselineValue();
        double pct   = range == 0 ? 0 : (value - kpi.getBaselineValue()) / range * 100;
        if (pct >= 100)       kpi.setStatus("ACHIEVED");
        else if (pct >= 70)   kpi.setStatus("ON_TRACK");
        else if (pct >= 40)   kpi.setStatus("AT_RISK");
        else                  kpi.setStatus("BEHIND");

        // Check threshold alert
        if (kpi.isAlertEnabled()) {
            boolean triggered = "BELOW".equals(kpi.getAlertDirection())
                ? value < kpi.getAlertThreshold()
                : value > kpi.getAlertThreshold();
            if (triggered && !kpi.isAlertTriggered()) {
                kpi.setAlertTriggered(true);
                notificationService.create(
                    "⚠️ KPI Alert: " + kpi.getName(),
                    kpi.getName() + " is " + ("BELOW".equals(kpi.getAlertDirection()) ? "below" : "above")
                        + " threshold of " + kpi.getAlertThreshold() + kpi.getUnit()
                        + " (current: " + value + kpi.getUnit() + ")",
                    "WARNING", "KPI", id);
            } else if (!triggered) {
                kpi.setAlertTriggered(false);
            }
        }

        kpi.setUpdatedAt(LocalDateTime.now());
        KpiMetric saved = kpiRepository.save(kpi);
        activityLogService.log("KPI", saved.getId(), saved.getName(),
                "CREATED", null, saved.getName(), null);
        return saved;
    }

    // ── B-9: Goal forecasting ─────────────────────────────────────
    // Predicts % chance of goal completion based on velocity + confidence history

    public Map<String, Object> forecastGoal(String goalId) {
        Goal goal = goalRepository.findById(goalId)
            .orElseThrow(() -> new RuntimeException("Goal not found"));

        int  currentProgress = goal.getProgress();
        int  currentConf     = goal.getConfidence() != 0 ? goal.getConfidence() : 50;
        List<Goal.CheckIn>  checkIns = goal.getCheckIns() != null ? goal.getCheckIns() : new java.util.ArrayList<>();
        List<Goal.KeyResult> krs = goal.getKeyResults() != null ? goal.getKeyResults() : new java.util.ArrayList<>();

        // Velocity: average progress gain per check-in
        double velocity = 0;
        if (checkIns.size() >= 2) {
            // Each check-in has progressSnapshot — compute average delta
            int[] snaps = checkIns.stream()
                .mapToInt(c -> c.getProgressSnapshot()).toArray();
            double totalDelta = 0;
            for (int i = 0; i < snaps.length - 1; i++)
                totalDelta += Math.max(0, snaps[i] - snaps[i+1]); // newest first
            velocity = totalDelta / (snaps.length - 1);
        } else if (!krs.isEmpty()) {
            velocity = krs.stream().mapToInt(kr -> kr.getProgress()).average().orElse(0)
                      / Math.max(1, krs.size());
        }

        // Estimated weeks to completion
        double remaining = 100 - currentProgress;
        double weeksToCompletion = velocity > 0 ? remaining / velocity : 99;

        // Confidence trend: is it going up or down?
        String confidenceTrend = "STABLE";
        List<Goal.ConfidenceEntry> confHistory = goal.getConfidenceHistory();
        if (confHistory != null && confHistory.size() >= 3) {
            int recent = confHistory.get(0).getValue();
            int older  = confHistory.get(2).getValue();
            if (recent > older + 5)       confidenceTrend = "IMPROVING";
            else if (recent < older - 5)  confidenceTrend = "DECLINING";
        }

        // Forecast score (0-100): blend of progress velocity, confidence, trend
        double trendBonus = "IMPROVING".equals(confidenceTrend) ? 10
                          : "DECLINING".equals(confidenceTrend) ? -10 : 0;
        double forecastScore = Math.min(100, Math.max(0,
            (currentProgress * 0.4) + (currentConf * 0.4) + trendBonus + (velocity * 2)));

        String prediction;
        String reasoning;
        if (forecastScore >= 75) {
            prediction = "HIGH";
            reasoning  = "Strong progress velocity and confidence. On track to complete.";
        } else if (forecastScore >= 50) {
            prediction = "MEDIUM";
            reasoning  = "Moderate progress. Needs attention to maintain momentum.";
        } else {
            prediction = "LOW";
            reasoning  = "Low velocity or declining confidence. At risk of missing target.";
        }

        if (velocity == 0 && checkIns.isEmpty()) {
            prediction = "UNKNOWN";
            reasoning  = "No check-in data available. Add weekly check-ins to enable forecasting.";
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("goalId",            goalId);
        result.put("goalTitle",         goal.getTitle());
        result.put("currentProgress",   currentProgress);
        result.put("currentConfidence", currentConf);
        result.put("velocity",          Math.round(velocity * 10.0) / 10.0);
        result.put("weeksToCompletion", weeksToCompletion > 52 ? "50+" : String.format("%.1f", weeksToCompletion));
        result.put("confidenceTrend",   confidenceTrend);
        result.put("forecastScore",     (int) forecastScore);
        result.put("prediction",        prediction);  // HIGH | MEDIUM | LOW | UNKNOWN
        result.put("reasoning",         reasoning);
        result.put("checkInCount",      checkIns.size());
        result.put("krCount",           krs.size());
        return result;
    }
}

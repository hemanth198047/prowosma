package com.prowosma.backend.service;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.Project;
import com.prowosma.backend.model.Sprint;
import com.prowosma.backend.model.Task;
import com.prowosma.backend.repository.*;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class RiskAdjustedPlanningService {

    private final ProjectRepository  projectRepo;
    private final TaskRepository     taskRepo;
    private final SprintRepository   sprintRepo;
    private final WorkspaceContext   ws;
    private final AIService          aiService;

    public Map<String, Object> analyseProject(String projectId) {
        String orgId = ws.getWorkspaceId();

        Project project = projectRepo.findById(projectId)
            .orElseThrow(() -> new RuntimeException("Project not found"));

        List<Task>   tasks   = taskRepo.findByOrganizationId(orgId).stream()
            .filter(t -> projectId.equals(t.getProjectId())).collect(Collectors.toList());
        List<Sprint> sprints = sprintRepo.findByProjectId(projectId);

        // ── 1. Velocity from completed sprints ────────────────
        List<Sprint> completed = sprints.stream()
            .filter(s -> "COMPLETED".equals(s.getStatus())).collect(Collectors.toList());

        double avgVelocity = completed.isEmpty() ? 20.0 :
            completed.stream().mapToLong(s ->
                tasks.stream().filter(t -> s.getTaskIds() != null
                    && s.getTaskIds().contains(t.getId()) && "DONE".equals(t.getStatus()))
                    .mapToInt(t -> t.getStoryPoints() != null ? t.getStoryPoints() : 0).sum()
            ).average().orElse(20.0);

        // ── 2. Velocity trend (improving/degrading) ───────────
        double velocityTrend = 0;
        if (completed.size() >= 2) {
            double first = completed.subList(0, completed.size()/2).stream()
                .mapToLong(s -> tasks.stream()
                    .filter(t -> s.getTaskIds() != null && s.getTaskIds().contains(t.getId())
                        && "DONE".equals(t.getStatus()))
                    .mapToInt(t -> t.getStoryPoints() != null ? t.getStoryPoints() : 0).sum())
                .average().orElse(avgVelocity);
            double second = completed.subList(completed.size()/2, completed.size()).stream()
                .mapToLong(s -> tasks.stream()
                    .filter(t -> s.getTaskIds() != null && s.getTaskIds().contains(t.getId())
                        && "DONE".equals(t.getStatus()))
                    .mapToInt(t -> t.getStoryPoints() != null ? t.getStoryPoints() : 0).sum())
                .average().orElse(avgVelocity);
            velocityTrend = first > 0 ? ((second - first) / first) * 100 : 0;
        }

        // ── 3. Remaining backlog ───────────────────────────────
        int remainingPts = tasks.stream()
            .filter(t -> !"DONE".equals(t.getStatus()))
            .mapToInt(t -> t.getStoryPoints() != null ? t.getStoryPoints() : 3).sum();

        // ── 4. Risk factors ────────────────────────────────────
        List<String> riskFactors = new ArrayList<>();
        int riskScore = 0;

        long overdueTasks = tasks.stream()
            .filter(t -> !"DONE".equals(t.getStatus()) && t.getDueDate() != null
                && t.getDueDate().isBefore(LocalDateTime.now())).count();
        if (overdueTasks > 0) { riskFactors.add(overdueTasks + " overdue tasks"); riskScore += Math.min(25, overdueTasks * 3); }

        long blockedTasks = tasks.stream()
            .filter(t -> t.getBlockedByTaskIds() != null && !t.getBlockedByTaskIds().isEmpty()
                && !"DONE".equals(t.getStatus())).count();
        if (blockedTasks > 0) { riskFactors.add(blockedTasks + " blocked tasks"); riskScore += Math.min(20, (int) blockedTasks * 4); }

        if (velocityTrend < -15) { riskFactors.add(String.format("Velocity declining %.0f%%", Math.abs(velocityTrend))); riskScore += 20; }

        if (project.getBudget() != null && project.getSpent() != null) {
            double burnPct = (project.getSpent() / project.getBudget()) * 100;
            if (burnPct > 80) { riskFactors.add(String.format("Budget %.0f%% consumed", burnPct)); riskScore += 15; }
        }

        if (completed.isEmpty()) { riskFactors.add("No completed sprints — velocity unproven"); riskScore += 10; }
        if (remainingPts > avgVelocity * 8) { riskFactors.add("Large backlog relative to velocity"); riskScore += 10; }

        riskScore = Math.min(100, riskScore);
        String riskLevel = riskScore >= 70 ? "CRITICAL" : riskScore >= 45 ? "HIGH" : riskScore >= 20 ? "MEDIUM" : "LOW";

        // ── 5. Risk-adjusted deadline (deterministic buffer) ──
        // Apply risk buffer: LOW=5%, MEDIUM=15%, HIGH=25%, CRITICAL=40%
        double buffer = riskScore >= 70 ? 1.40 : riskScore >= 45 ? 1.25 : riskScore >= 20 ? 1.15 : 1.05;
        int nominalSprints = avgVelocity > 0 ? (int) Math.ceil(remainingPts / avgVelocity) : 10;
        int riskAdjSprints = (int) Math.ceil(nominalSprints * buffer);
        LocalDateTime riskAdjDeadline = LocalDateTime.now().plusDays(riskAdjSprints * 14L);

        // ── 5b. Probabilistic forecast (P50 / P90) ─────────────
        // The buffer% above is a deterministic heuristic — useful, but not
        // actually "probabilistic." This adds a real confidence-based
        // forecast on top of it: derive the standard deviation of velocity
        // across completed sprints, then use it to project two dates
        // instead of one — a P50 (the median-case estimate, using average
        // velocity) and a P90 (a conservative estimate using a velocity
        // one standard deviation below average, i.e. "90% likely to finish
        // by this date if velocity keeps behaving the way it has"). This
        // is the same simplified confidence-forecasting approach several
        // agile tools use in place of a full Monte Carlo simulation —
        // lighter-weight, but grounded in this project's own actual
        // velocity variance rather than a single flat multiplier applied
        // to every project regardless of how consistent its delivery has
        // actually been.
        double velocityStdDev = 0;
        String forecastConfidence;
        LocalDateTime p50Deadline, p90Deadline;
        if (completed.size() >= 3) {
            List<Double> sprintVelocities = completed.stream()
                .map(s -> (double) tasks.stream()
                    .filter(t -> s.getTaskIds() != null && s.getTaskIds().contains(t.getId())
                        && "DONE".equals(t.getStatus()))
                    .mapToInt(t -> t.getStoryPoints() != null ? t.getStoryPoints() : 0).sum())
                .collect(Collectors.toList());
            double mean = sprintVelocities.stream().mapToDouble(v -> v).average().orElse(avgVelocity);
            double variance = sprintVelocities.stream()
                .mapToDouble(v -> Math.pow(v - mean, 2)).average().orElse(0);
            velocityStdDev = Math.sqrt(variance);

            // Conservative (P90-ish) velocity: one std dev below the mean,
            // floored so it never goes to zero/negative on a volatile team.
            double p90Velocity = Math.max(mean * 0.3, mean - velocityStdDev);
            int p90Sprints = p90Velocity > 0 ? (int) Math.ceil(remainingPts / p90Velocity) : nominalSprints * 2;

            p50Deadline = LocalDateTime.now().plusDays(nominalSprints * 14L);
            p90Deadline = LocalDateTime.now().plusDays(p90Sprints * 14L);
            forecastConfidence = "Based on " + completed.size() + " completed sprints — velocity has varied by ~"
                + Math.round(velocityStdDev) + " pts/sprint (σ). P50 assumes average velocity holds; "
                + "P90 assumes a materially worse sprint than usual becomes the norm.";
        } else {
            // Not enough sprint history for a meaningful standard deviation
            // — fall back to the deterministic buffer for both, rather than
            // presenting a false sense of statistical confidence from 0-2
            // data points.
            p50Deadline = riskAdjDeadline;
            p90Deadline = riskAdjDeadline;
            forecastConfidence = "Fewer than 3 completed sprints — not enough history for a real "
                + "confidence forecast yet. Showing the risk-buffered deadline for both P50 and P90 "
                + "until more sprint data is available.";
        }

        // ── 6. AI narrative ───────────────────────────────────
        String aiNarrative = "";
        try {
            String prompt = "Project: " + project.getName()
                + "\nRisk score: " + riskScore + "/100 (" + riskLevel + ")"
                + "\nRisk factors: " + String.join(", ", riskFactors)
                + "\nVelocity: " + Math.round(avgVelocity) + " pts/sprint (trend " + String.format("%.0f", velocityTrend) + "%)"
                + "\nRemaining: " + remainingPts + " pts across " + nominalSprints + " sprints"
                + "\nRisk-adjusted deadline adds " + (riskAdjSprints - nominalSprints) + " buffer sprints"
                + "\nP50 (median-case) completion: " + p50Deadline.toLocalDate()
                + "\nP90 (conservative) completion: " + p90Deadline.toLocalDate();
            aiNarrative = aiService.ask(
                "You are a risk-aware project delivery advisor. Provide a concise 3-4 sentence risk assessment and recommendation.",
                prompt);
        } catch (Exception ignored) { aiNarrative = "AI narrative unavailable."; }

        // Persist risk data on the project — these fields (completionRiskScore,
        // riskAdjustedDeadline, riskFactors, currentVelocity) have existed on
        // the Project model all along; this service computed the exact same
        // values every time it ran but never actually called their setters,
        // so nothing else in the app (project lists, dashboards) could ever
        // show a project's risk level without the caller re-running this
        // whole analysis itself. Fixed.
        project.setCompletionRiskScore((double) riskScore);
        project.setRiskAdjustedDeadline(riskAdjDeadline.toLocalDate().toString());
        project.setRiskFactors(riskFactors);
        project.setCurrentVelocity((int) Math.round(avgVelocity));
        project.setUpdatedAt(java.time.LocalDateTime.now());
        projectRepo.save(project);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("projectId",          projectId);
        result.put("projectName",        project.getName());
        result.put("riskScore",          riskScore);
        result.put("riskLevel",          riskLevel);
        result.put("riskFactors",        riskFactors);
        result.put("nominalDeadline",    project.getDueDate() != null ? project.getDueDate().toLocalDate().toString() : null);
        result.put("riskAdjDeadline",    riskAdjDeadline.toLocalDate().toString());
        result.put("bufferSprints",      riskAdjSprints - nominalSprints);
        result.put("avgVelocity",        Math.round(avgVelocity));
        result.put("velocityTrend",      Math.round(velocityTrend));
        result.put("velocityStdDev",     Math.round(velocityStdDev * 10.0) / 10.0);
        result.put("remainingPoints",    remainingPts);
        result.put("nominalSprints",     nominalSprints);
        result.put("riskAdjSprints",     riskAdjSprints);
        result.put("p50Deadline",        p50Deadline.toLocalDate().toString());
        result.put("p90Deadline",        p90Deadline.toLocalDate().toString());
        result.put("forecastConfidence", forecastConfidence);
        result.put("aiNarrative",        aiNarrative);
        return result;
    }

    public List<Map<String, Object>> analysePortfolio() {
        return projectRepo.findByOrganizationId(ws.getWorkspaceId()).stream()
            .filter(p -> !"DONE".equals(p.getStatus()))
            .map(p -> { try { return analyseProject(p.getId()); } catch (Exception e) { return null; } })
            .filter(Objects::nonNull)
            .collect(Collectors.toList());
    }
}

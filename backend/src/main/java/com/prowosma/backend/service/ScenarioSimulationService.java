package com.prowosma.backend.service;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.*;
import com.prowosma.backend.repository.*;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Scenario Simulation Engine
 * Computes the impact of what-if changes on delivery, goals, team load, and budget.
 */
@Service
@RequiredArgsConstructor
public class ScenarioSimulationService {

    private final TaskRepository        taskRepo;
    private final ProjectRepository     projectRepo;
    private final GoalRepository        goalRepo;
    private final SprintRepository      sprintRepo;
    private final TeamMemberRepository  memberRepo;
    private final AIService             aiService;
    private final WorkspaceContext      ws;

    public Scenario.ScenarioResults simulate(Scenario scenario) {
        String orgId = ws.getWorkspaceId();
        Scenario.ScenarioInputs in = scenario.getInputs();
        Scenario.ScenarioResults r = new Scenario.ScenarioResults();

        // ── Load baseline data ────────────────────────────────
        List<Task>       allTasks   = taskRepo.findByOrganizationId(orgId);
        List<Project>    projects   = projectRepo.findByOrganizationId(orgId);
        List<Goal>       goals      = goalRepo.findByOrganizationId(orgId);
        List<Sprint>     sprints    = sprintRepo.findByOrganizationId(orgId);
        List<TeamMember> members    = memberRepo.findByOrganizationId(orgId);

        List<Task> openTasks = allTasks.stream()
            .filter(t -> !"DONE".equals(t.getStatus()))
            .collect(Collectors.toList());

        // ── 1. TEAM CHANGE simulation ─────────────────────────
        int effectiveTeamSize = members.size() + in.getTeamSizeDelta()
            - in.getRemovedMemberEmails().size();
        effectiveTeamSize = Math.max(1, effectiveTeamSize);
        int baseTeamSize = Math.max(1, members.size());

        double teamSizeRatio = (double) effectiveTeamSize / baseTeamSize; // >1 faster, <1 slower

        // Average tasks per member in baseline
        double avgTasksPerMember = openTasks.isEmpty() ? 0
            : (double) openTasks.size() / baseTeamSize;
        double newAvgLoad = openTasks.isEmpty() ? 0
            : (double) openTasks.size() / effectiveTeamSize;
        r.setTeamLoadChange(Math.round((newAvgLoad / Math.max(0.01, avgTasksPerMember) - 1) * 100.0));
        r.setBurnoutRisk(newAvgLoad > avgTasksPerMember * 1.3 || newAvgLoad > 10);

        // ── 2. VELOCITY & SPRINT simulation ──────────────────
        // Compute baseline velocity from completed sprints
        List<Sprint> completedSprints = sprints.stream()
            .filter(s -> "COMPLETED".equals(s.getStatus()))
            .collect(Collectors.toList());

        int baselineVelocity = completedSprints.isEmpty() ? 20 :
            (int) completedSprints.stream()
                .mapToLong(s -> allTasks.stream()
                    .filter(t -> (s.getTaskIds() != null && s.getTaskIds().contains(t.getId()))
                        && "DONE".equals(t.getStatus()))
                    .mapToInt(t -> t.getStoryPoints() != null ? t.getStoryPoints() : 0)
                    .sum())
                .average().orElse(20);

        // Apply velocity adjustments: team size + explicit velocity change
        double velocityMultiplier = teamSizeRatio
            * (1.0 + in.getSprintVelocityChange() / 100.0);
        velocityMultiplier = Math.max(0.1, velocityMultiplier);
        int projectedVelocity = (int) Math.round(baselineVelocity * velocityMultiplier);
        r.setSprintVelocityProjected(projectedVelocity);

        // Total remaining story points in backlog
        int totalBacklogPoints = openTasks.stream()
            .mapToInt(t -> t.getStoryPoints() != null ? t.getStoryPoints() : 3)
            .sum();
        r.addMetric("totalBacklogPoints", totalBacklogPoints);
        r.addMetric("baselineVelocity", baselineVelocity);
        r.addMetric("effectiveTeamSize", effectiveTeamSize);

        // Scope change
        int adjustedBacklog = totalBacklogPoints
            + in.getScopeAddedPoints()
            - in.getScopeRemovedPoints();
        adjustedBacklog = Math.max(0, adjustedBacklog);
        r.addMetric("adjustedBacklogPoints", adjustedBacklog);

        // Sprints to completion
        int sprintsNeeded = projectedVelocity > 0
            ? (int) Math.ceil((double) adjustedBacklog / projectedVelocity) : 99;
        r.setSprintsToCompletion(sprintsNeeded);

        // ── 3. TIMELINE projection ────────────────────────────
        // Average sprint duration = 14 days
        int sprintDurationDays = 14;
        LocalDateTime baseline = in.getBaselineDate() != null ? in.getBaselineDate() : LocalDateTime.now();

        // Find earliest active project deadline
        LocalDateTime earliestDeadline = projects.stream()
            .filter(p -> p.getDueDate() != null && !"DONE".equals(p.getStatus()))
            .filter(p -> in.getLinkedProjectId() == null
                || in.getLinkedProjectId().equals(p.getId()))
            .map(Project::getDueDate)
            .min(LocalDateTime::compareTo)
            .orElse(baseline.plusDays(90));

        long daysToDeadline = ChronoUnit.DAYS.between(baseline, earliestDeadline);
        long projectedDaysToComplete = (long) sprintsNeeded * sprintDurationDays
            + in.getDeadlineShiftDays();
        projectedDaysToComplete = Math.max(0, projectedDaysToComplete);

        r.setBaselineCompletionDate(earliestDeadline);
        r.setProjectedCompletionDate(baseline.plusDays(projectedDaysToComplete));
        r.setEstimatedDelayDays((int) (projectedDaysToComplete - daysToDeadline));

        // Delivery confidence: based on buffer and team stability
        double bufferRatio = daysToDeadline > 0
            ? (double) daysToDeadline / Math.max(1, projectedDaysToComplete) : 0;
        double confidence = Math.min(100, Math.max(0, bufferRatio * 90
            - (r.isBurnoutRisk() ? 15 : 0)
            - (in.getScopeAddedPoints() > 0 ? 10 : 0)));
        r.setDeliveryConfidence(Math.round(confidence * 10.0) / 10.0);

        // ── 4. DELIVERY RISK SCORE ────────────────────────────
        int riskScore = 0;
        if (r.getEstimatedDelayDays() > 0)   riskScore += Math.min(40, r.getEstimatedDelayDays());
        if (r.isBurnoutRisk())                riskScore += 20;
        if (in.getTeamSizeDelta() < -1)       riskScore += 15;
        if (in.getScopeAddedPoints() > 10)    riskScore += 10;
        if (in.getBudgetCutPercent() > 20)    riskScore += 10;
        if (in.getSprintVelocityChange() < -20) riskScore += 15;
        riskScore = Math.min(100, riskScore);
        r.setDeliveryRiskScore(riskScore);
        r.setDeliveryRiskLevel(
            riskScore >= 75 ? "CRITICAL" :
            riskScore >= 50 ? "HIGH"     :
            riskScore >= 25 ? "MEDIUM"   : "LOW"
        );

        // ── 5. GOAL IMPACT ────────────────────────────────────
        List<Goal> activeGoals = goals.stream()
            .filter(g -> "ACTIVE".equals(g.getStatus()))
            .collect(Collectors.toList());

        double avgConfidenceBefore = activeGoals.isEmpty() ? 50.0 :
            activeGoals.stream().mapToInt(Goal::getConfidence).average().orElse(50);

        // Each day of delay erodes confidence, team changes compound this
        double confidenceDelta = 0;
        if (r.getEstimatedDelayDays() > 0)
            confidenceDelta -= Math.min(20, r.getEstimatedDelayDays() * 0.3);
        if (in.getTeamSizeDelta() < 0)
            confidenceDelta -= in.getTeamSizeDelta() * -2.5;
        if (in.getBudgetCutPercent() > 10)
            confidenceDelta -= in.getBudgetCutPercent() * 0.2;
        if (in.getScopeAddedPoints() > 0)
            confidenceDelta -= in.getScopeAddedPoints() * 0.5;
        if (in.getTeamSizeDelta() > 0)
            confidenceDelta += in.getTeamSizeDelta() * 1.5;

        r.setGoalConfidenceImpact(Math.round(confidenceDelta * 10.0) / 10.0);

        List<Map<String, Object>> affectedGoals = new ArrayList<>();
        int goalsAtRisk = 0;
        for (Goal g : activeGoals) {
            double newConf = Math.min(100, Math.max(0, g.getConfidence() + confidenceDelta));
            if (newConf < 40) goalsAtRisk++;
            if (Math.abs(confidenceDelta) > 5) {
                Map<String, Object> ag = new LinkedHashMap<>();
                ag.put("id",              g.getId());
                ag.put("title",           g.getTitle());
                ag.put("currentConf",     g.getConfidence());
                ag.put("projectedConf",   (int) Math.round(newConf));
                ag.put("delta",           (int) Math.round(confidenceDelta));
                ag.put("atRisk",          newConf < 40);
                affectedGoals.add(ag);
            }
        }
        r.setGoalsAtRisk(goalsAtRisk);
        r.setAffectedGoals(affectedGoals);

        // ── 6. BUDGET IMPACT ──────────────────────────────────
        double totalBudget = projects.stream()
            .filter(p -> !"DONE".equals(p.getStatus()))
            .filter(p -> in.getLinkedProjectId() == null
                || in.getLinkedProjectId().equals(p.getId()))
            .mapToDouble(p -> p.getBudget() != null ? p.getBudget() : 0)
            .sum();
        double totalSpent = projects.stream()
            .filter(p -> !"DONE".equals(p.getStatus()))
            .mapToDouble(p -> p.getSpent() != null ? p.getSpent() : 0)
            .sum();
        double remaining = totalBudget - totalSpent;
        double cutAmount  = remaining * (in.getBudgetCutPercent() / 100.0);
        r.setBudgetVariance(Math.round(-cutAmount * 100.0) / 100.0);
        double monthlyBurn = totalSpent > 0 ? totalSpent / 3.0 : totalBudget * 0.15;
        r.setProjectedBurnRate(Math.round(monthlyBurn * 100.0) / 100.0);
        r.addMetric("totalBudget", totalBudget);
        r.addMetric("remainingBudget", remaining - cutAmount);

        // ── 7. MEMBER IMPACTS ─────────────────────────────────
        List<Map<String, Object>> memberImpacts = new ArrayList<>();
        for (String email : in.getRemovedMemberEmails()) {
            long taskCount = openTasks.stream()
                .filter(t -> t.getAssigneeIds() != null && t.getAssigneeIds().contains(email))
                .count();
            Map<String, Object> mi = new LinkedHashMap<>();
            mi.put("email",      email);
            mi.put("action",     "REMOVED");
            mi.put("taskCount",  (int) taskCount);
            mi.put("impact",     taskCount > 5 ? "HIGH" : taskCount > 2 ? "MEDIUM" : "LOW");
            mi.put("note",       taskCount + " tasks need reassignment");
            memberImpacts.add(mi);
        }
        r.setMemberImpacts(memberImpacts);
        r.addMetric("tasksNeedingReassignment",
            in.getRemovedMemberEmails().stream()
                .mapToLong(email -> openTasks.stream()
                    .filter(t -> t.getAssigneeIds() != null && t.getAssigneeIds().contains(email))
                    .count())
                .sum());

        // ── 8. WARNINGS & RECOMMENDATIONS ────────────────────
        buildWarningsAndRecs(r, in, effectiveTeamSize, sprintsNeeded, adjustedBacklog);

        // ── 9. AI NARRATIVE ───────────────────────────────────
        try {
            String prompt = buildAiPrompt(scenario, r, adjustedBacklog, projectedVelocity,
                effectiveTeamSize, daysToDeadline, projectedDaysToComplete);
            scenario.setAiNarrative(aiService.ask(
                "You are an expert project delivery advisor. Provide a concise executive-level assessment (4-6 sentences) of this scenario simulation, highlighting the most important risks and actionable recommendations.",
                prompt));
        } catch (Exception e) {
            scenario.setAiNarrative("AI narrative unavailable. Review the simulation metrics above.");
        }

        return r;
    }

    private void buildWarningsAndRecs(Scenario.ScenarioResults r, Scenario.ScenarioInputs in,
                                       int effectiveTeamSize, int sprintsNeeded, int adjustedBacklog) {
        List<String> warnings = new ArrayList<>();
        List<String> recs     = new ArrayList<>();

        if (r.getEstimatedDelayDays() > 14)
            warnings.add("Delivery is projected to slip by " + r.getEstimatedDelayDays() + " days — exceeds 2-sprint buffer.");
        if (r.isBurnoutRisk())
            warnings.add("Team load will increase by " + (int)r.getTeamLoadChange() + "% — burnout risk detected.");
        if (effectiveTeamSize < 2)
            warnings.add("Team drops below 2 members — delivery risk is critical.");
        if (r.getGoalsAtRisk() > 0)
            warnings.add(r.getGoalsAtRisk() + " goal" + (r.getGoalsAtRisk()>1?"s":"") + " projected to fall below 40% confidence.");
        if (in.getScopeAddedPoints() > 20)
            warnings.add("Adding " + in.getScopeAddedPoints() + " story points without deadline extension will compress delivery.");
        if (in.getBudgetCutPercent() > 30)
            warnings.add("Budget cut of " + (int)in.getBudgetCutPercent() + "% may require scope reduction to remain viable.");
        if (r.getDeliveryRiskLevel().equals("CRITICAL"))
            warnings.add("CRITICAL: This scenario creates an unacceptable delivery risk. Consider alternatives.");
        if (in.getTeamSizeDelta() < -2)
            warnings.add("Losing " + Math.abs(in.getTeamSizeDelta()) + " engineers simultaneously is high risk — consider staggered offboarding.");

        if (in.getTeamSizeDelta() < 0)
            recs.add("Immediately reassign tasks from departing members and identify critical path tasks to protect.");
        if (r.isBurnoutRisk())
            recs.add("Reduce scope or extend deadline to prevent overloading remaining team members.");
        if (r.getEstimatedDelayDays() > 0)
            recs.add("Negotiate a " + Math.round(r.getEstimatedDelayDays() * 1.1) + "-day deadline extension with stakeholders.");
        if (in.getScopeAddedPoints() > 0)
            recs.add("Deprioritise equivalent story points from the backlog to absorb new scope.");
        if (in.getBudgetCutPercent() > 0)
            recs.add("Review contractor/vendor contracts first before cutting core team headcount.");
        if (r.getGoalsAtRisk() > 0)
            recs.add("Flag at-risk goals to leadership and prepare contingency key results.");
        if (in.getDeadlineShiftDays() < 0)
            recs.add("Compressing timelines requires velocity data validation — check last 3 sprint actuals.");

        if (warnings.isEmpty())
            warnings.add("No critical warnings. This scenario appears manageable with current capacity.");
        if (recs.isEmpty())
            recs.add("Maintain current trajectory — no immediate corrective action required.");

        r.setWarnings(warnings);
        r.setRecommendations(recs);
    }

    private String buildAiPrompt(Scenario scenario, Scenario.ScenarioResults r,
                                  int backlog, int velocity, int teamSize,
                                  long daysToDeadline, long projectedDays) {
        return String.format(
            "Scenario: %s | Type: %s\n" +
            "Changes: team delta=%d, deadline shift=%d days, velocity change=%d%%, scope added=%d pts, budget cut=%.0f%%\n" +
            "Simulation results: delivery risk=%s (%d/100), delay=%d days, delivery confidence=%.0f%%\n" +
            "Team: %d members effective, load change=%.0f%%, burnout risk=%s\n" +
            "Goals: %d at risk, confidence impact=%.0f pts\n" +
            "Backlog: %d adjusted pts, velocity %d pts/sprint, %d sprints to complete",
            scenario.getName(), scenario.getType(),
            scenario.getInputs().getTeamSizeDelta(), scenario.getInputs().getDeadlineShiftDays(),
            scenario.getInputs().getSprintVelocityChange(), scenario.getInputs().getScopeAddedPoints(),
            scenario.getInputs().getBudgetCutPercent(),
            r.getDeliveryRiskLevel(), r.getDeliveryRiskScore(), r.getEstimatedDelayDays(),
            r.getDeliveryConfidence(),
            teamSize, r.getTeamLoadChange(), r.isBurnoutRisk(),
            r.getGoalsAtRisk(), r.getGoalConfidenceImpact(),
            backlog, velocity, r.getSprintsToCompletion()
        );
    }

    // Helper to add metrics to results
    public void addMetricsHelper(Scenario.ScenarioResults r, String key, Object value) {
        r.getMetrics().put(key, value);
    }
}

// Extension to ScenarioResults to add addMetric helper
// We'll use a helper method pattern

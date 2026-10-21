package com.prowosma.backend.service;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.Goal;
import com.prowosma.backend.model.Step;
import com.prowosma.backend.model.SubGoal;
import com.prowosma.backend.repository.GoalRepository;
import com.prowosma.backend.service.FileStorageService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;

@Service
@RequiredArgsConstructor
public class GoalService {

    private final GoalRepository goalRepository;
    private final ActivityLogService activityLogService;
    private final NotificationService notificationService;
    private final RealtimeService realtimeService;
    private final WorkspaceContext workspaceContext;
    private final FileStorageService fileStorageService;
    private final VisibilityService visibility;
    private final com.prowosma.backend.repository.ProjectRepository projectRepository;

    // A goal is seen by whoever made or owns it, or through a project that is linked to it and visible to them.
    private static final java.util.function.Function<Goal, List<String>> PEOPLE = g -> VisibilityService.people(g.getCreatedBy(), g.getOwner());

    private java.util.function.Function<Goal, List<String>> projectsOfGoal() {
        java.util.Map<String, List<String>> byGoal = new java.util.HashMap<>();
        for (com.prowosma.backend.model.Project p : projectRepository.findByOrganizationId(workspaceContext.getWorkspaceId()))
            if (p.getLinkedGoalId() != null) byGoal.computeIfAbsent(p.getLinkedGoalId(), k -> new java.util.ArrayList<>()).add(p.getId());
        return g -> byGoal.getOrDefault(g.getId(), new java.util.ArrayList<>());
    }

    private List<Goal> visible(List<Goal> goals) {
        return visibility.isRestricted() ? visibility.filterLinked(goals, PEOPLE, projectsOfGoal()) : goals;
    }

    /** The goal for changing: visible, and the caller may change planning records. */
    private Goal writable(String id) {
        Goal g = getById(id);
        visibility.requireCapability(com.prowosma.backend.access.AccessConstants.CAP_MANAGE_PLANNING);
        return g;
    }

    public List<Goal> getAll() {
        return visible(goalRepository.findByOrganizationId(workspaceContext.getWorkspaceId()));
    }

    public Goal getById(String id) {
        Goal g = goalRepository.findById(id).orElseThrow(() -> new RuntimeException("Goal not found"));
        if (!visibility.isRestricted()) return g;
        return visibility.requireLinked(g, PEOPLE, projectsOfGoal());
    }

    public Goal create(Goal goal) {
        visibility.requireMayCreateLinked((String) null);
        goal.setCreatedAt(LocalDateTime.now());
        goal.setUpdatedAt(LocalDateTime.now());
        goal.setOrganizationId(workspaceContext.getWorkspaceId());
        Goal saved = goalRepository.save(goal);
        activityLogService.logFull("GOAL", saved.getId(), saved.getTitle(),
                "GOAL_CREATED", null, saved.getTitle(), null,
                null, null, saved.getId());
        realtimeService.broadcast(workspaceContext.getWorkspaceId(), "GOAL_CREATED",
                "GOAL", saved.getId(), saved.getTitle(), null,
                "New goal created: " + saved.getTitle());
        return saved;
    }

    public Goal update(String id, Goal updated) {
        Goal existing = writable(id);
        String oldTitle = existing.getTitle();
        existing.setTitle(updated.getTitle());
        existing.setDescription(updated.getDescription());
        existing.setTargetDate(updated.getTargetDate());
        existing.setStatus(updated.getStatus());
        // B-1 fields
        if (updated.getParentGoalId() != null) existing.setParentGoalId(updated.getParentGoalId());
        if (updated.getLevel()  != null) existing.setLevel(updated.getLevel());
        if (updated.getOwner()  != null) existing.setOwner(updated.getOwner());
        if (updated.getQuarter()!= null) existing.setQuarter(updated.getQuarter());
        existing.setUpdatedAt(LocalDateTime.now());
        Goal saved = goalRepository.save(existing);
        activityLogService.logFull("GOAL", saved.getId(), saved.getTitle(),
                "GOAL_UPDATED", oldTitle, saved.getTitle(), null,
                null, null, saved.getId());
        return saved;
    }

    public void delete(String id) {
        Goal goal = writable(id);
        activityLogService.logFull("GOAL", id, goal.getTitle(),
                "GOAL_DELETED", goal.getTitle(), null, null,
                null, null, id);
        goalRepository.deleteById(id);
    }

    public Goal updateProgress(String id, int progress) {
        Goal existing = writable(id);
        int oldProgress = existing.getProgress();
        existing.setProgress(Math.min(100, Math.max(0, progress)));
        if (existing.getProgress() == 100) existing.setStatus("ACHIEVED");
        existing.setUpdatedAt(LocalDateTime.now());
        Goal saved = goalRepository.save(existing);
        String action = saved.getProgress() == 100 ? "GOAL_COMPLETED" : "GOAL_PROGRESS_CHANGED";
        activityLogService.logFull("GOAL", saved.getId(), saved.getTitle(),
                action, oldProgress + "", saved.getProgress() + "", null,
                null, null, saved.getId());
        if (saved.getProgress() == 100) {
            notificationService.create("Goal Achieved! 🎉",
                    saved.getTitle() + " is 100% complete!", "SUCCESS", "GOAL", saved.getId());
            realtimeService.broadcast(workspaceContext.getWorkspaceId(), "GOAL_COMPLETED",
                    "GOAL", saved.getId(), saved.getTitle(), null,
                    "🎉 Goal achieved: " + saved.getTitle());
        } else {
            realtimeService.broadcast(workspaceContext.getWorkspaceId(), "GOAL_PROGRESS_CHANGED",
                    "GOAL", saved.getId(), saved.getTitle(), null,
                    "Goal \"" + saved.getTitle() + "\" progress → " + saved.getProgress() + "%");
        }
        return saved;
    }

    public Goal addSubGoal(String id, SubGoal subGoal) {
        Goal goal = writable(id);
        if (goal.getSubGoals() == null) goal.setSubGoals(new java.util.ArrayList<>());
        goal.getSubGoals().add(subGoal);
        goal.setUpdatedAt(LocalDateTime.now());
        activityLogService.logFull("GOAL", goal.getId(), goal.getTitle(),
                "SUBGOAL_CREATED", goal.getTitle(), subGoal.getTitle(), null,
                null, null, goal.getId());
        return goalRepository.save(goal);
    }

    public Goal updateSubGoal(String id, String subGoalId, SubGoal updated) {
        Goal goal = writable(id);
        goal.getSubGoals().stream().filter(sg -> sg.getId().equals(subGoalId)).findFirst()
                .ifPresent(sg -> {
                    sg.setTitle(updated.getTitle());
                    sg.setDescription(updated.getDescription());
                    sg.setStatus(updated.getStatus());
                });
        goal.setUpdatedAt(LocalDateTime.now());
        return goalRepository.save(goal);
    }

    public Goal deleteSubGoal(String id, String subGoalId) {
        Goal goal = writable(id);
        goal.getSubGoals().removeIf(sg -> sg.getId().equals(subGoalId));
        goal.setUpdatedAt(LocalDateTime.now());
        return goalRepository.save(goal);
    }

    public Goal addStep(String id, String subGoalId, Step step) {
        Goal goal = writable(id);
        goal.getSubGoals().stream().filter(sg -> sg.getId().equals(subGoalId)).findFirst()
                .ifPresent(sg -> {
                    if (sg.getSteps() == null) sg.setSteps(new java.util.ArrayList<>());
                    sg.getSteps().add(step);
                });
        goal.setUpdatedAt(LocalDateTime.now());
        return goalRepository.save(goal);
    }

    public Goal toggleStep(String id, String subGoalId, String stepId) {
        Goal goal = writable(id);
        final String[] stepTitle = {null};
        final boolean[] nowDone  = {false};
        goal.getSubGoals().stream().filter(sg -> sg.getId().equals(subGoalId)).findFirst()
                .ifPresent(sg -> sg.getSteps().stream()
                        .filter(s -> s.getId().equals(stepId)).findFirst()
                        .ifPresent(s -> {
                            s.setCompleted(!s.isCompleted());
                            stepTitle[0] = s.getTitle();
                            nowDone[0]   = s.isCompleted();
                        }));
        updateGoalProgressFromSubGoals(goal);
        goal.setUpdatedAt(LocalDateTime.now());
        Goal saved = goalRepository.save(goal);
        if (Boolean.TRUE.equals(nowDone[0])) {
            activityLogService.logFull("GOAL", saved.getId(), saved.getTitle(),
                    "STEP_COMPLETED", null, stepTitle[0], null,
                    null, null, saved.getId());
        }
        if (saved.getProgress() == 100) {
            activityLogService.logFull("GOAL", saved.getId(), saved.getTitle(),
                    "GOAL_COMPLETED", null, "100%", null,
                    null, null, saved.getId());
            notificationService.create("Goal Achieved! 🎉",
                    saved.getTitle() + " is complete!", "SUCCESS", "GOAL", saved.getId());
        }
        return saved;
    }

    public Goal deleteStep(String id, String subGoalId, String stepId) {
        Goal goal = writable(id);
        goal.getSubGoals().stream().filter(sg -> sg.getId().equals(subGoalId)).findFirst()
                .ifPresent(sg -> sg.getSteps().removeIf(s -> s.getId().equals(stepId)));
        updateGoalProgressFromSubGoals(goal);
        goal.setUpdatedAt(LocalDateTime.now());
        return goalRepository.save(goal);
    }

    // ── Step helper ───────────────────────────────────────────
    private Step findStep(Goal goal, String subGoalId, String stepId) {
        return goal.getSubGoals().stream()
                .filter(sg -> sg.getId().equals(subGoalId)).findFirst()
                .flatMap(sg -> sg.getSteps().stream().filter(s -> s.getId().equals(stepId)).findFirst())
                .orElseThrow(() -> new RuntimeException("Step not found: " + stepId));
    }

    // ── Step Comments ─────────────────────────────────────────
    public Goal addStepComment(String id, String subGoalId, String stepId,
                               com.prowosma.backend.model.Comment comment) {
        Goal goal = writable(id);
        Step step = findStep(goal, subGoalId, stepId);
        if (step.getComments() == null) step.setComments(new java.util.ArrayList<>());
        step.getComments().add(comment);
        goal.setUpdatedAt(LocalDateTime.now());
        return goalRepository.save(goal);
    }

    public Goal deleteStepComment(String id, String subGoalId, String stepId, String commentId) {
        Goal goal = writable(id);
        Step step = findStep(goal, subGoalId, stepId);
        if (step.getComments() != null)
            step.getComments().removeIf(c -> c.getId().equals(commentId));
        goal.setUpdatedAt(LocalDateTime.now());
        return goalRepository.save(goal);
    }

    // ── Step Attachments ──────────────────────────────────────
    public Goal addStepAttachment(String id, String subGoalId, String stepId,
                                  org.springframework.web.multipart.MultipartFile file,
                                  String uploadedBy) throws java.io.IOException {
        Goal goal = writable(id);
        Step step = findStep(goal, subGoalId, stepId);
        if (step.getAttachments() == null) step.setAttachments(new java.util.ArrayList<>());
        String fileName = fileStorageService.store(file);
        com.prowosma.backend.model.Attachment att = new com.prowosma.backend.model.Attachment();
        att.setFileName(fileName);
        att.setOriginalName(file.getOriginalFilename());
        att.setFileType(file.getContentType());
        att.setFileSize(file.getSize());
        att.setUploadedBy(uploadedBy);
        step.getAttachments().add(att);
        goal.setUpdatedAt(LocalDateTime.now());
        return goalRepository.save(goal);
    }

    public Goal deleteStepAttachment(String id, String subGoalId, String stepId, String attachmentId) {
        Goal goal = writable(id);
        Step step = findStep(goal, subGoalId, stepId);
        if (step.getAttachments() != null)
            step.getAttachments().removeIf(a -> a.getId().equals(attachmentId));
        goal.setUpdatedAt(LocalDateTime.now());
        return goalRepository.save(goal);
    }

    // ── Step Dependencies ─────────────────────────────────────
    public Goal addStepDependency(String id, String subGoalId, String stepId, String blockedByStepId) {
        if (stepId.equals(blockedByStepId)) throw new RuntimeException("Step cannot depend on itself");
        Goal goal = writable(id);
        Step step = findStep(goal, subGoalId, stepId);
        if (step.getBlockedByStepIds() == null) step.setBlockedByStepIds(new java.util.ArrayList<>());
        if (!step.getBlockedByStepIds().contains(blockedByStepId))
            step.getBlockedByStepIds().add(blockedByStepId);
        goal.setUpdatedAt(LocalDateTime.now());
        return goalRepository.save(goal);
    }

    public Goal removeStepDependency(String id, String subGoalId, String stepId, String blockedByStepId) {
        Goal goal = writable(id);
        Step step = findStep(goal, subGoalId, stepId);
        if (step.getBlockedByStepIds() != null)
            step.getBlockedByStepIds().remove(blockedByStepId);
        goal.setUpdatedAt(LocalDateTime.now());
        return goalRepository.save(goal);
    }

    private void updateGoalProgressFromSubGoals(Goal goal) {
        if (goal.getSubGoals() == null || goal.getSubGoals().isEmpty()) return;
        int total = goal.getSubGoals().stream()
                .mapToInt(sg -> sg.getSteps() == null ? 0 : sg.getSteps().size()).sum();
        if (total == 0) return;
        long done = goal.getSubGoals().stream()
                .mapToLong(sg -> sg.getSteps() == null ? 0 :
                        sg.getSteps().stream().filter(Step::isCompleted).count()).sum();
        goal.setProgress((int)((done * 100) / total));
        if (goal.getProgress() == 100) goal.setStatus("ACHIEVED");
    }

    // ═══════════════════════════════════════════════════════════
    // B-1: Cascading goals — hierarchy helpers
    // ═══════════════════════════════════════════════════════════

    public List<Goal> getRootGoals() {
        return visible(goalRepository.findByOrganizationIdAndParentGoalIdIsNull(workspaceContext.getWorkspaceId()));
    }

    public List<Goal> getChildGoals(String parentGoalId) {
        return visible(goalRepository.findByParentGoalId(parentGoalId).stream()
                .filter(g -> workspaceContext.getWorkspaceId() != null && workspaceContext.getWorkspaceId().equals(g.getOrganizationId()))
                .collect(java.util.stream.Collectors.toList()));
    }

    public List<Goal> getByLevel(String level) {
        return visible(goalRepository.findByOrganizationIdAndLevel(workspaceContext.getWorkspaceId(), level));
    }

    public List<Goal> getByQuarter(String quarter) {
        return visible(goalRepository.findByOrganizationIdAndQuarter(workspaceContext.getWorkspaceId(), quarter));
    }

    /** Returns the full goal tree: each root goal with its children resolved */
    public java.util.Map<String, Object> getGoalTree() {
        List<Goal> all = visible(goalRepository.findByOrganizationId(workspaceContext.getWorkspaceId()));
        // build id→goal map
        java.util.Map<String, Goal> map = new java.util.LinkedHashMap<>();
        for (Goal g : all) map.put(g.getId(), g);
        return java.util.Map.of("goals", all);
    }

    // Update parent goal progress when child changes
    private void bubbleProgressToParent(String parentGoalId) {
        if (parentGoalId == null) return;
        goalRepository.findById(parentGoalId).ifPresent(parent -> {
            List<Goal> children = goalRepository.findByParentGoalId(parentGoalId);
            if (!children.isEmpty()) {
                int avgProgress = (int) children.stream().mapToInt(Goal::getProgress).average().orElse(0);
                parent.setProgress(avgProgress);
                if (avgProgress == 100) parent.setStatus("ACHIEVED");
                parent.setUpdatedAt(java.time.LocalDateTime.now());
                goalRepository.save(parent);
                // bubble further up
                bubbleProgressToParent(parent.getParentGoalId());
            }
        });
    }

    // ═══════════════════════════════════════════════════════════
    // B-2: Confidence scoring
    // ═══════════════════════════════════════════════════════════

    public Goal updateConfidence(String id, int confidence, String note, String author) {
        Goal goal = writable(id);
        goal.setConfidence(Math.min(100, Math.max(0, confidence)));
        Goal.ConfidenceEntry entry = new Goal.ConfidenceEntry();
        entry.setValue(confidence);
        entry.setNote(note != null ? note : "");
        entry.setRecordedBy(author);
        entry.setRecordedAt(java.time.LocalDateTime.now());
        if (goal.getConfidenceHistory() == null) goal.setConfidenceHistory(new java.util.ArrayList<>());
        goal.getConfidenceHistory().add(entry);
        // keep last 20 entries
        if (goal.getConfidenceHistory().size() > 20)
            goal.setConfidenceHistory(goal.getConfidenceHistory().subList(
                goal.getConfidenceHistory().size() - 20, goal.getConfidenceHistory().size()));
        goal.setUpdatedAt(java.time.LocalDateTime.now());
        return goalRepository.save(goal);
    }

    // ═══════════════════════════════════════════════════════════
    // B-3: Weekly check-ins
    // ═══════════════════════════════════════════════════════════

    public Goal addCheckIn(String id, Goal.CheckIn checkIn, String author) {
        Goal goal = writable(id);
        checkIn.setId(java.util.UUID.randomUUID().toString());
        checkIn.setAuthor(author);
        checkIn.setProgressSnapshot(goal.getProgress());
        checkIn.setConfidenceSnapshot(goal.getConfidence());
        checkIn.setCreatedAt(java.time.LocalDateTime.now());
        if (goal.getCheckIns() == null) goal.setCheckIns(new java.util.ArrayList<>());
        goal.getCheckIns().add(0, checkIn); // newest first
        // keep last 52 (one year of weekly check-ins)
        if (goal.getCheckIns().size() > 52)
            goal.setCheckIns(goal.getCheckIns().subList(0, 52));
        goal.setUpdatedAt(java.time.LocalDateTime.now());
        return goalRepository.save(goal);
    }

    public Goal deleteCheckIn(String id, String checkInId) {
        Goal goal = writable(id);
        if (goal.getCheckIns() != null)
            goal.getCheckIns().removeIf(c -> checkInId.equals(c.getId()));
        goal.setUpdatedAt(java.time.LocalDateTime.now());
        return goalRepository.save(goal);
    }

    // ═══════════════════════════════════════════════════════════
    // B-4: Key Results
    // ═══════════════════════════════════════════════════════════

    public Goal addKeyResult(String id, Goal.KeyResult kr) {
        Goal goal = writable(id);
        kr.setId(java.util.UUID.randomUUID().toString());
        kr.setUpdatedAt(java.time.LocalDateTime.now());
        if (goal.getKeyResults() == null) goal.setKeyResults(new java.util.ArrayList<>());
        goal.getKeyResults().add(kr);
        syncProgressFromKeyResults(goal);
        goal.setUpdatedAt(java.time.LocalDateTime.now());
        return goalRepository.save(goal);
    }

    public Goal updateKeyResult(String id, String krId, Goal.KeyResult patch) {
        Goal goal = writable(id);
        goal.getKeyResults().stream()
            .filter(kr -> krId.equals(kr.getId())).findFirst()
            .ifPresent(kr -> {
                if (patch.getTitle()        != null) kr.setTitle(patch.getTitle());
                if (patch.getMetric()       != null) kr.setMetric(patch.getMetric());
                if (patch.getUnit()         != null) kr.setUnit(patch.getUnit());
                if (patch.getStatus()       != null) kr.setStatus(patch.getStatus());
                kr.setStartValue(patch.getStartValue());
                kr.setTargetValue(patch.getTargetValue());
                kr.setCurrentValue(patch.getCurrentValue());
                kr.setUpdatedAt(java.time.LocalDateTime.now());
            });
        syncProgressFromKeyResults(goal);
        goal.setUpdatedAt(java.time.LocalDateTime.now());
        Goal saved = goalRepository.save(goal);
        bubbleProgressToParent(saved.getParentGoalId());
        return saved;
    }

    public Goal deleteKeyResult(String id, String krId) {
        Goal goal = writable(id);
        if (goal.getKeyResults() != null)
            goal.getKeyResults().removeIf(kr -> krId.equals(kr.getId()));
        syncProgressFromKeyResults(goal);
        goal.setUpdatedAt(java.time.LocalDateTime.now());
        return goalRepository.save(goal);
    }

    /** Auto-sync goal progress = average KR progress when KRs exist */
    private void syncProgressFromKeyResults(Goal goal) {
        if (goal.getKeyResults() == null || goal.getKeyResults().isEmpty()) return;
        int avg = (int) goal.getKeyResults().stream()
            .mapToInt(Goal.KeyResult::getProgress).average().orElse(0);
        goal.setProgress(avg);
        if (avg == 100) goal.setStatus("ACHIEVED");
    }



    public Goal save(Goal goal) {
        return goalRepository.save(goal);
    }

}

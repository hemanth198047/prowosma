package com.prowosma.backend.controller;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.repository.*;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/search/global")
@Tag(name = "Global Search", description = "Unified cross-entity search")
@RequiredArgsConstructor
public class GlobalSearchController {

    private final TaskRepository     taskRepository;
    private final ProjectRepository  projectRepository;
    private final GoalRepository     goalRepository;
    private final DocRepository      docRepository;
    private final DecisionRepository decisionRepository;
    private final MeetingRepository  meetingRepository;
    private final MeetingActionItemRepository meetingActionItemRepository;
    private final WorkspaceContext   workspaceContext;
    private final com.prowosma.backend.service.VisibilityService visibility;

    @GetMapping
    public Map<String, Object> search(
            @RequestParam String q,
            @RequestParam(required = false) String type,
            @RequestParam(defaultValue = "5") int limit) {

        if (q == null || q.trim().length() < 2)
            return Map.of("results", List.of(), "total", 0, "query", q != null ? q : "");

        String orgId = workspaceContext.getWorkspaceId();
        String ql = q.toLowerCase();
        List<Map<String, Object>> results = new ArrayList<>();

        // Tasks — TaskRepository has findByTitleContainingIgnoreCase (no orgId variant)
        if (type == null || "task".equals(type)) {
            visibility.filterTasks(taskRepository.findByTitleContainingIgnoreCase(q).stream()
                .filter(t -> orgId.equals(t.getOrganizationId())).toList()).stream()
                .limit(limit)
                .forEach(t -> results.add(Map.of(
                    "id", t.getId(), "title", t.getTitle(),
                    "type", "task", "subtitle", t.getStatus() != null ? t.getStatus() : "",
                    "url", "/tasks", "icon", "✅"
                )));
        }

        // Projects — ProjectRepository has findByNameContainingIgnoreCase
        if (type == null || "project".equals(type)) {
            visibility.filterProjects(projectRepository.findByNameContainingIgnoreCase(q).stream()
                .filter(p -> orgId.equals(p.getOrganizationId())).toList()).stream()
                .limit(limit)
                .forEach(p -> results.add(Map.of(
                    "id", p.getId(), "title", p.getName(),
                    "type", "project", "subtitle", p.getStatus() != null ? p.getStatus() : "",
                    "url", "/projects", "icon", "📁"
                )));
        }

        // Goals — GoalRepository has findByTitleContainingIgnoreCase
        if (!visibility.isRestricted() && (type == null || "goal".equals(type))) {
            goalRepository.findByTitleContainingIgnoreCase(q).stream()
                .filter(g -> orgId.equals(g.getOrganizationId()))
                .limit(limit)
                .forEach(g -> results.add(Map.of(
                    "id", g.getId(), "title", g.getTitle(),
                    "type", "goal", "subtitle", "Goal",
                    "url", "/goals", "icon", "🎯"
                )));
        }

        // Docs — DocRepository has findByWorkspaceIdAndTitleContainingIgnoreCaseAndDeletedFalse
        if (type == null || "doc".equals(type)) {
            visibility.filterDocs(docRepository.findByWorkspaceIdAndTitleContainingIgnoreCaseAndDeletedFalse(orgId, q)).stream()
                .limit(limit)
                .forEach(d -> results.add(Map.of(
                    "id", d.getId(), "title", d.getTitle(),
                    "type", "doc", "subtitle", "Document",
                    "url", "/docs", "icon", "📝"
                )));
        }

        // Decisions — DecisionRepository has findByWorkspaceIdAndTitleContainingIgnoreCaseOrderByCreatedAtDesc
        if (!visibility.isRestricted() && (type == null || "decision".equals(type))) {
            decisionRepository.findByWorkspaceIdAndTitleContainingIgnoreCaseOrderByCreatedAtDesc(orgId, q).stream()
                .limit(limit)
                .forEach(d -> results.add(Map.of(
                    "id", d.getId(), "title", d.getTitle(),
                    "type", "decision", "subtitle", d.getStatus() != null ? d.getStatus() : "",
                    "url", "/decisions", "icon", "⚖️"
                )));
        }

        // Meetings
        if (!visibility.isRestricted() && (type == null || "meeting".equals(type))) {
            meetingRepository.findByWorkspaceIdAndTitleContainingIgnoreCaseOrderByMeetingDateDesc(orgId, q).stream()
                .limit(limit)
                .forEach(m -> results.add(Map.of(
                    "id", m.getId(), "title", m.getTitle(),
                    "type", "meeting", "subtitle", m.getStatus() != null ? m.getStatus() : "",
                    "url", "/meetings", "icon", "📅"
                )));
        }

        // Meeting action items — no title-search repository method exists yet,
        // so filter the org's items in-memory (consistent with this
        // controller's existing organizationId-filter approach for tasks).
        if (!visibility.isRestricted() && (type == null || "meeting-action-item".equals(type))) {
            meetingActionItemRepository.findByOrganizationId(orgId).stream()
                .filter(a -> a.getTitle() != null && a.getTitle().toLowerCase().contains(ql))
                .limit(limit)
                .forEach(a -> results.add(Map.of(
                    "id", a.getId(), "title", a.getTitle(),
                    "type", "meeting-action-item", "subtitle", a.getStatus() != null ? a.getStatus() : "",
                    "url", "/meetings", "icon", "☑️"
                )));
        }

        return Map.of("results", results, "total", results.size(), "query", q);
    }

    @GetMapping("/quick")
    public List<Map<String, Object>> quickSearch(@RequestParam String q) {
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> results = (List<Map<String, Object>>) search(q, null, 3).get("results");
        return results;
    }
}

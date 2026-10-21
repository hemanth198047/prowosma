package com.prowosma.backend.controller;

import com.prowosma.backend.repository.GoalRepository;
import com.prowosma.backend.repository.ProjectRepository;
import com.prowosma.backend.repository.TaskRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/search")
@RequiredArgsConstructor
public class SearchController {

    private final ProjectRepository projectRepository;
    private final TaskRepository taskRepository;
    private final GoalRepository goalRepository;
    private final com.prowosma.backend.config.WorkspaceContext workspaceContext;
    private final com.prowosma.backend.service.VisibilityService visibility;

    @GetMapping
    public Map<String, Object> search(@RequestParam String q) {
        Map<String, Object> results = new HashMap<>();
        if (q == null || q.trim().length() < 2) {
            results.put("projects", java.util.List.of());
            results.put("tasks", java.util.List.of());
            results.put("goals", java.util.List.of());
            return results;
        }
        // Search used to match every workspace's records; it is now limited to the caller's workspace, and for
        // restricted callers to the projects and tasks they may see (goals are not scoped yet, so they get none).
        String org = workspaceContext.getWorkspaceId();
        var projects = visibility.filterProjects(projectRepository.findByNameContainingIgnoreCase(q).stream()
                .filter(p -> org != null && org.equals(p.getOrganizationId())).toList());
        var tasks = visibility.filterTasks(taskRepository.findByTitleContainingIgnoreCase(q).stream()
                .filter(t -> org != null && org.equals(t.getOrganizationId())).toList());
        results.put("projects", visibility.redact(projects).stream().limit(20).toList());
        results.put("tasks", tasks.stream().limit(20).toList());
        results.put("goals", visibility.isRestricted() ? java.util.List.of()
                : goalRepository.findByTitleContainingIgnoreCase(q).stream()
                    .filter(g -> org != null && org.equals(g.getOrganizationId())).limit(20).toList());
        return results;
    }
}

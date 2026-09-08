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

    @GetMapping
    public Map<String, Object> search(@RequestParam String q) {
        Map<String, Object> results = new HashMap<>();
        if (q == null || q.trim().length() < 2) {
            results.put("projects", java.util.List.of());
            results.put("tasks", java.util.List.of());
            results.put("goals", java.util.List.of());
            return results;
        }
        results.put("projects", projectRepository.findByNameContainingIgnoreCase(q).stream().limit(20).toList());
        results.put("tasks", taskRepository.findByTitleContainingIgnoreCase(q).stream().limit(20).toList());
        results.put("goals", goalRepository.findByTitleContainingIgnoreCase(q).stream().limit(20).toList());
        return results;
    }
}

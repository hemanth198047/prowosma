package com.prowosma.backend.controller;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.Task;
import com.prowosma.backend.model.Project;
import com.prowosma.backend.repository.TaskRepository;
import com.prowosma.backend.repository.ProjectRepository;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.time.LocalDateTime;
import java.util.*;

@RestController
@RequestMapping("/api/import")
@Tag(name = "Import", description = "Bulk import from CSV and external tools")
@RequiredArgsConstructor
public class ImportController {

    private final TaskRepository    taskRepository;
    private final ProjectRepository projectRepository;
    private final WorkspaceContext  workspaceContext;

    /** Upload and parse a CSV file — returns preview (no commit) */
    @PostMapping("/preview")
    public ResponseEntity<Map<String, Object>> preview(
            @RequestParam("file") MultipartFile file,
            @RequestParam(defaultValue = "tasks") String entityType) throws Exception {

        List<Map<String, String>> rows = parseCsv(file);
        int total = rows.size();
        List<Map<String, String>> sample = rows.subList(0, Math.min(10, total));

        Set<String> columns = new LinkedHashSet<>();
        if (!rows.isEmpty()) columns.addAll(rows.get(0).keySet());

        return ResponseEntity.ok(Map.of(
            "totalRows",   total,
            "columns",     columns,
            "sample",      sample,
            "entityType",  entityType,
            "suggestions", suggestMapping(columns, entityType)
        ));
    }

    /** Commit a CSV import with a column mapping */
    @PostMapping("/commit")
    public ResponseEntity<Map<String, Object>> commit(
            @RequestParam("file") MultipartFile file,
            @RequestParam(defaultValue = "tasks") String entityType,
            @RequestParam(required = false) String projectId,
            @RequestBody(required = false) Map<String, String> columnMap,
            Authentication auth) throws Exception {

        List<Map<String, String>> rows = parseCsv(file);
        String orgId = workspaceContext.getWorkspaceId();
        Map<String, String> mapping = columnMap != null ? columnMap : suggestMapping(
                rows.isEmpty() ? Set.of() : rows.get(0).keySet(), entityType);

        int imported = 0;
        List<String> errors = new ArrayList<>();

        for (int i = 0; i < rows.size(); i++) {
            Map<String, String> row = rows.get(i);
            try {
                if ("tasks".equals(entityType)) {
                    Task task = new Task();
                    task.setOrganizationId(orgId);
                    task.setProjectId(projectId);
                    task.setCreatedBy(auth.getName());
                    task.setStatus("TODO");
                    task.setCreatedAt(LocalDateTime.now());
                    task.setUpdatedAt(LocalDateTime.now());
                    task.setTitle(row.getOrDefault(mapping.getOrDefault("title", "title"), "Imported task " + (i + 1)));
                    task.setDescription(row.getOrDefault(mapping.getOrDefault("description", "description"), null));
                    String prio = row.getOrDefault(mapping.getOrDefault("priority", "priority"), "MEDIUM");
                    task.setPriority(prio.toUpperCase().matches("LOW|MEDIUM|HIGH") ? prio.toUpperCase() : "MEDIUM");
                    taskRepository.save(task);
                } else if ("projects".equals(entityType)) {
                    Project project = new Project();
                    project.setOrganizationId(orgId);
                    project.setCreatedBy(auth.getName());
                    project.setStatus("ACTIVE");
                    project.setCreatedAt(LocalDateTime.now());
                    project.setUpdatedAt(LocalDateTime.now());
                    project.setName(row.getOrDefault(mapping.getOrDefault("name", "name"), "Imported project " + (i + 1)));
                    project.setDescription(row.getOrDefault(mapping.getOrDefault("description", "description"), null));
                    projectRepository.save(project);
                }
                imported++;
            } catch (Exception e) {
                errors.add("Row " + (i + 2) + ": " + e.getMessage());
            }
        }

        return ResponseEntity.ok(Map.of(
            "imported",   imported,
            "total",      rows.size(),
            "errors",     errors,
            "entityType", entityType
        ));
    }

    /** Return supported entity types and their expected columns */
    @GetMapping("/templates")
    public Map<String, Object> templates() {
        return Map.of(
            "tasks", Map.of(
                "columns", List.of("title","description","priority","status","dueDate","assignee","projectId"),
                "downloadUrl", "/api/import/templates/tasks.csv"
            ),
            "projects", Map.of(
                "columns", List.of("name","description","status","startDate","dueDate","owner"),
                "downloadUrl", "/api/import/templates/projects.csv"
            )
        );
    }

    /** Download a blank CSV template */
    @GetMapping("/templates/{type}.csv")
    public ResponseEntity<String> downloadTemplate(@PathVariable String type) {
        String csv = switch (type) {
            case "tasks"    -> "title,description,priority,status,dueDate,assignee\nExample Task,Task description,MEDIUM,TODO,2026-12-31,user@example.com\n";
            case "projects" -> "name,description,status,startDate,dueDate,owner\nExample Project,Project description,ACTIVE,2026-01-01,2026-12-31,user@example.com\n";
            default         -> "type,value\n";
        };
        return ResponseEntity.ok()
            .header("Content-Type", "text/csv")
            .header("Content-Disposition", "attachment; filename=\"" + type + "-template.csv\"")
            .body(csv);
    }

    /* ── Jira-style JSON import ──────────────────────────────── */
    @PostMapping("/jira")
    public ResponseEntity<Map<String, Object>> importJira(
            @RequestBody Map<String, Object> payload,
            @RequestParam(required = false) String projectId,
            Authentication auth) {
        // Jira export format: { issues: [{ fields: { summary, description, issuetype, priority, status } }] }
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> issues = (List<Map<String, Object>>) payload.getOrDefault("issues", List.of());
        String orgId = workspaceContext.getWorkspaceId();
        int imported = 0;
        for (Map<String, Object> issue : issues) {
            try {
                @SuppressWarnings("unchecked")
                Map<String, Object> fields = (Map<String, Object>) issue.get("fields");
                if (fields == null) continue;
                Task task = new Task();
                task.setOrganizationId(orgId);
                task.setProjectId(projectId);
                task.setCreatedBy(auth.getName());
                task.setStatus("TODO");
                task.setCreatedAt(LocalDateTime.now());
                task.setUpdatedAt(LocalDateTime.now());
                task.setTitle(String.valueOf(fields.getOrDefault("summary", "Jira task")));
                task.setDescription(fields.get("description") != null ? String.valueOf(fields.get("description")) : null);
                @SuppressWarnings("unchecked")
                Map<String, Object> prio = (Map<String, Object>) fields.get("priority");
                task.setPriority(prio != null ? mapJiraPriority(String.valueOf(prio.get("name"))) : "MEDIUM");
                taskRepository.save(task);
                imported++;
            } catch (Exception ignored) {}
        }
        return ResponseEntity.ok(Map.of("imported", imported, "total", issues.size(), "source", "jira"));
    }

    /* ── helpers ─────────────────────────────────────────────── */
    private List<Map<String, String>> parseCsv(MultipartFile file) throws Exception {
        List<Map<String, String>> rows = new ArrayList<>();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(file.getInputStream()))) {
            String headerLine = reader.readLine();
            if (headerLine == null) return rows;
            String[] headers = headerLine.split(",");
            String line;
            while ((line = reader.readLine()) != null) {
                String[] values = line.split(",", -1);
                Map<String, String> row = new LinkedHashMap<>();
                for (int i = 0; i < headers.length; i++) {
                    row.put(headers[i].trim(), i < values.length ? values[i].trim() : "");
                }
                rows.add(row);
            }
        }
        return rows;
    }

    private Map<String, String> suggestMapping(Set<String> columns, String entityType) {
        Map<String, String> suggestions = new LinkedHashMap<>();
        List<String> colList = new ArrayList<>(columns);
        if ("tasks".equals(entityType)) {
            for (String target : List.of("title","description","priority","status","dueDate","assignee")) {
                colList.stream().filter(c -> c.toLowerCase().contains(target.toLowerCase()))
                    .findFirst().ifPresent(c -> suggestions.put(target, c));
            }
        } else if ("projects".equals(entityType)) {
            for (String target : List.of("name","description","status","startDate","dueDate","owner")) {
                colList.stream().filter(c -> c.toLowerCase().contains(target.toLowerCase()))
                    .findFirst().ifPresent(c -> suggestions.put(target, c));
            }
        }
        return suggestions;
    }

    private String mapJiraPriority(String jiraPriority) {
        return switch (jiraPriority.toLowerCase()) {
            case "highest", "critical", "blocker" -> "HIGH";
            case "low", "trivial", "minor"        -> "LOW";
            default                               -> "MEDIUM";
        };
    }
}

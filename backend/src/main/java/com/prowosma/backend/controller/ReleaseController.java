package com.prowosma.backend.controller;
import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.Release;
import com.prowosma.backend.repository.ReleaseRepository;
import com.prowosma.backend.util.PagedResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.data.mongodb.core.MongoOperations;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

@RestController @RequestMapping("/api/releases") @RequiredArgsConstructor
public class ReleaseController {
    private final org.springframework.context.ApplicationContext applicationContext;
    private final ReleaseRepository repo;
    private final WorkspaceContext  ws;
    private final com.prowosma.backend.service.VisibilityService visibility;

    @GetMapping
    public PagedResponse<Release> getAll(
            @RequestParam(required = false) String projectId,
            @RequestParam(defaultValue = "0")  int page,
            @RequestParam(defaultValue = "50") int size) {
        var all = repo.findByOrganizationId(ws.getWorkspaceId());
        if (projectId != null)
            all = all.stream().filter(r -> projectId.equals(r.getProjectId())).toList();
        return PagedResponse.ofList(visibility.filterLinked(all, x -> com.prowosma.backend.service.VisibilityService.people(x.getCreatedBy(), x.getOwner()), x -> com.prowosma.backend.service.VisibilityService.projectsOf(x.getProjectId())), page, Math.min(size, 200));
    }

    @PostMapping
    public Release create(@RequestBody Release r, Authentication auth) {
        visibility.requireMayCreateLinked(r.getProjectId());
        r.setOrganizationId(ws.getWorkspaceId());
        r.setCreatedBy(auth.getName());
        r.setCreatedAt(LocalDateTime.now());
        r.setUpdatedAt(LocalDateTime.now());
        return repo.save(r);
    }

    @PutMapping("/{id}")
    public Release update(@PathVariable String id, @RequestBody Release patch) {
        return repo.findById(id).map(r -> {
            visibility.requireLinkedWrite(r, x -> com.prowosma.backend.service.VisibilityService.people(x.getCreatedBy(), x.getOwner()), x -> com.prowosma.backend.service.VisibilityService.projectsOf(x.getProjectId()));
            if (patch.getVersion()      != null) r.setVersion(patch.getVersion());
            if (patch.getName()         != null) r.setName(patch.getName());
            if (patch.getDescription()  != null) r.setDescription(patch.getDescription());
            if (patch.getStatus()       != null) r.setStatus(patch.getStatus());
            if (patch.getReleaseDate()  != null) r.setReleaseDate(patch.getReleaseDate());
            if (patch.getReleaseNotes() != null) r.setReleaseNotes(patch.getReleaseNotes());
            if (patch.getOwner()        != null) r.setOwner(patch.getOwner());
            if (patch.getEnvironment()  != null) r.setEnvironment(patch.getEnvironment());
            if (patch.getTaskIds()      != null) r.setTaskIds(patch.getTaskIds());
            r.setUpdatedAt(LocalDateTime.now());
            return repo.save(r);
        }).orElseThrow();
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String,String>> delete(@PathVariable String id) {
        repo.findById(id).ifPresent(r -> { visibility.requireLinkedWrite(r, x -> com.prowosma.backend.service.VisibilityService.people(x.getCreatedBy(), x.getOwner()), x -> com.prowosma.backend.service.VisibilityService.projectsOf(x.getProjectId())); repo.delete(r); });
        return ResponseEntity.ok(Map.of("message","Deleted"));
    }

    @PostMapping("/{id}/generate-changelog")
    public com.prowosma.backend.model.Release generateChangelog(
            @PathVariable String id,
            @RequestBody(required = false) java.util.Map<String, Object> body) {

        return repo.findById(id).map(release -> {
            visibility.requireLinkedWrite(release, x -> com.prowosma.backend.service.VisibilityService.people(x.getCreatedBy(), x.getOwner()), x -> com.prowosma.backend.service.VisibilityService.projectsOf(x.getProjectId()));
            com.prowosma.backend.repository.TaskRepository taskRepo =
                applicationContext.getBean(com.prowosma.backend.repository.TaskRepository.class);
            com.prowosma.backend.service.AIService ai =
                applicationContext.getBean(com.prowosma.backend.service.AIService.class);

            // Collect task titles for this release
            java.util.List<String> taskTitles = new java.util.ArrayList<>();
            if (release.getTaskIds() != null) {
                release.getTaskIds().forEach(tid ->
                    taskRepo.findById(tid).filter(visibility::canSeeTask).ifPresent(t -> taskTitles.add(t.getTitle())));   // titles of tasks the caller can't see never go into the AI prompt
            }

            String context = "Release: " + release.getVersion() + " — " + release.getName()
                + "\nEnvironment: " + release.getEnvironment()
                + "\nTasks completed:\n" + String.join("\n- ", taskTitles);

            try {
                String changelog = ai.ask(
                    "Generate a professional, user-facing release changelog. "
                    + "Group changes into: New Features, Improvements, Bug Fixes, and Breaking Changes. "
                    + "Use markdown formatting with bullet points. Be concise and user-centric.",
                    context);
                release.setAutoChangelog(changelog);
                release.setChangelogGeneratedAt(java.time.LocalDateTime.now().toString());
            } catch (Exception e) {
                release.setAutoChangelog("## " + release.getVersion() + "\n\n"
                    + taskTitles.stream().map(t -> "- " + t).collect(java.util.stream.Collectors.joining("\n")));
            }
            release.setUpdatedAt(java.time.LocalDateTime.now());
            return repo.save(release);
        }).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Release not found"));
    }

    @PatchMapping("/{id}/commits")
    public com.prowosma.backend.model.Release addCommits(
            @PathVariable String id,
            @RequestBody java.util.Map<String, Object> body) {
        return repo.findById(id).map(r -> {
            visibility.requireLinkedWrite(r, x -> com.prowosma.backend.service.VisibilityService.people(x.getCreatedBy(), x.getOwner()), x -> com.prowosma.backend.service.VisibilityService.projectsOf(x.getProjectId()));
            @SuppressWarnings("unchecked")
            java.util.List<String> msgs = (java.util.List<String>) body.get("commitMessages");
            if (msgs != null) r.setCommitMessages(msgs);
            r.setUpdatedAt(java.time.LocalDateTime.now());
            return repo.save(r);
        }).orElseThrow();
    }

}

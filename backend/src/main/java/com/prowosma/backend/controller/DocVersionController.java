package com.prowosma.backend.controller;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.Doc;
import com.prowosma.backend.model.DocVersion;
import com.prowosma.backend.repository.DocRepository;
import com.prowosma.backend.repository.DocVersionRepository;
import io.swagger.v3.oas.annotations.tags.Tag;
import com.prowosma.backend.util.PagedResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.*;

@RestController
@RequestMapping("/api/docs/{docId}/versions")
@Tag(name = "Doc Versions", description = "Version history for documents")
@RequiredArgsConstructor
public class DocVersionController {

    private final DocVersionRepository docVersionRepository;
    private final DocRepository        docRepository;
    private final WorkspaceContext     workspaceContext;

    @GetMapping
    public PagedResponse<DocVersion> getVersions(
            @PathVariable String docId,
            @RequestParam(defaultValue = "0")  int page,
            @RequestParam(defaultValue = "50") int size) {
        var all = docVersionRepository.findByDocIdOrderByVersionNumberDesc(docId);
        return PagedResponse.ofList(all, page, Math.min(size, 200));
    }

    @GetMapping("/{versionId}")
    public DocVersion getVersion(@PathVariable String docId, @PathVariable String versionId) {
        return docVersionRepository.findById(versionId)
                .orElseThrow(() -> new RuntimeException("Version not found: " + versionId));
    }

    @PostMapping
    public DocVersion saveVersion(@PathVariable String docId,
                                   @RequestBody(required = false) Map<String, String> body,
                                   Authentication auth) {
        Doc doc = docRepository.findById(docId)
                .orElseThrow(() -> new RuntimeException("Doc not found: " + docId));
        long next = docVersionRepository.countByDocId(docId) + 1;
        String labelStr = body != null ? body.getOrDefault("label", "v" + next) : "v" + next;

        DocVersion version = new DocVersion();
        version.setDocId(docId);
        version.setVersionNumber((int) next);
        version.setContent(doc.getContent());
        version.setTitle(doc.getTitle());
        version.setSavedBy(auth.getName());
        version.setLabel(labelStr);          // label field exists in DocVersion model
        version.setCreatedAt(LocalDateTime.now());
        return docVersionRepository.save(version);
    }

    @PostMapping("/{versionId}/restore")
    public Doc restoreVersion(@PathVariable String docId,
                               @PathVariable String versionId,
                               Authentication auth) {
        DocVersion version = docVersionRepository.findById(versionId)
                .orElseThrow(() -> new RuntimeException("Version not found: " + versionId));
        Doc doc = docRepository.findById(docId)
                .orElseThrow(() -> new RuntimeException("Doc not found: " + docId));

        // Save snapshot before overwriting
        long next = docVersionRepository.countByDocId(docId) + 1;
        DocVersion snapshot = new DocVersion();
        snapshot.setDocId(docId);
        snapshot.setVersionNumber((int) next);
        snapshot.setContent(doc.getContent());
        snapshot.setTitle(doc.getTitle());
        snapshot.setSavedBy(auth.getName());
        snapshot.setLabel("Before restore to v" + version.getVersionNumber());
        snapshot.setCreatedAt(LocalDateTime.now());
        docVersionRepository.save(snapshot);

        // Restore
        doc.setContent(version.getContent());
        doc.setTitle(version.getTitle());
        doc.setUpdatedAt(LocalDateTime.now());
        // Doc model has no setLastEditedBy — store in existing field if needed
        return docRepository.save(doc);
    }

    @GetMapping("/compare")
    public Map<String, Object> compareVersions(@PathVariable String docId,
                                                @RequestParam String versionA,
                                                @RequestParam String versionB) {
        DocVersion a = docVersionRepository.findById(versionA)
                .orElseThrow(() -> new RuntimeException("Version not found: " + versionA));
        DocVersion b = docVersionRepository.findById(versionB)
                .orElseThrow(() -> new RuntimeException("Version not found: " + versionB));
        return Map.of("versionA", a, "versionB", b);
    }

    @DeleteMapping("/{versionId}")
    public ResponseEntity<Map<String, String>> deleteVersion(
            @PathVariable String docId, @PathVariable String versionId) {
        docVersionRepository.deleteById(versionId);
        return ResponseEntity.ok(Map.of("message", "Version deleted"));
    }
}

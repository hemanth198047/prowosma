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
    private final com.prowosma.backend.service.VisibilityService visibility;

    /** The doc, or 404 if it isn't there or the caller can't see it. */
    private Doc visibleDoc(String docId) {
        Doc d = docRepository.findById(docId).orElseThrow(() -> new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.NOT_FOUND, "Doc not found"));
        visibility.requireDocVisible(d);
        return d;
    }

    /** A version of THIS doc (an id from another doc is answered as not found). */
    private DocVersion versionOf(String docId, String versionId) {
        return docVersionRepository.findById(versionId).filter(v -> docId.equals(v.getDocId()))
                .orElseThrow(() -> new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.NOT_FOUND, "Version not found"));
    }

    @GetMapping
    public PagedResponse<DocVersion> getVersions(
            @PathVariable String docId,
            @RequestParam(defaultValue = "0")  int page,
            @RequestParam(defaultValue = "50") int size) {
        visibleDoc(docId);
        var all = docVersionRepository.findByDocIdOrderByVersionNumberDesc(docId);
        return PagedResponse.ofList(all, page, Math.min(size, 200));
    }

    @GetMapping("/{versionId}")
    public DocVersion getVersion(@PathVariable String docId, @PathVariable String versionId) {
        visibleDoc(docId);
        return versionOf(docId, versionId);
    }

    @PostMapping
    public DocVersion saveVersion(@PathVariable String docId,
                                   @RequestBody(required = false) Map<String, String> body,
                                   Authentication auth) {
        Doc doc = visibleDoc(docId);
        visibility.requireCanEditDoc(doc);
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
        Doc doc = visibleDoc(docId);
        visibility.requireCanEditDoc(doc);
        DocVersion version = versionOf(docId, versionId);

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
        visibleDoc(docId);
        DocVersion a = versionOf(docId, versionA);
        DocVersion b = versionOf(docId, versionB);
        return Map.of("versionA", a, "versionB", b);
    }

    @DeleteMapping("/{versionId}")
    public ResponseEntity<Map<String, String>> deleteVersion(
            @PathVariable String docId, @PathVariable String versionId) {
        visibility.requireCanManageDoc(visibleDoc(docId));
        versionOf(docId, versionId);
        docVersionRepository.deleteById(versionId);
        return ResponseEntity.ok(Map.of("message", "Version deleted"));
    }
}

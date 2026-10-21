package com.prowosma.backend.controller;

import com.prowosma.backend.model.Doc;
import com.prowosma.backend.service.DocService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/docs")
@Tag(name = "Docs API", description = "Knowledge base document management")
@RequiredArgsConstructor
public class DocController {

    private final DocService docService;

    // ── GET /api/docs?workspaceId=… ───────────────────────────
    @GetMapping
    @Operation(summary = "List all docs for a workspace")
    public ResponseEntity<Map<String, Object>> getAll(
            @RequestParam String workspaceId,
            Authentication auth) {
        List<Doc> docs = docService.getByWorkspace(workspaceId);
        return ResponseEntity.ok(Map.of("data", docs));
    }

    // ── GET /api/docs/recent?workspaceId=… ────────────────────
    @GetMapping("/recent")
    @Operation(summary = "Get recently viewed docs")
    public ResponseEntity<Map<String, Object>> getRecent(
            @RequestParam String workspaceId,
            Authentication auth) {
        List<Doc> docs = docService.getRecent(workspaceId);
        return ResponseEntity.ok(Map.of("data", docs));
    }

    // ── GET /api/docs/favorites?workspaceId=… ─────────────────
    @GetMapping("/favorites")
    @Operation(summary = "Get favourite docs")
    public ResponseEntity<Map<String, Object>> getFavorites(
            @RequestParam String workspaceId,
            Authentication auth) {
        List<Doc> docs = docService.getFavorites(workspaceId);
        return ResponseEntity.ok(Map.of("data", docs));
    }

    // ── GET /api/docs/search?q=…&workspaceId=… ────────────────
    @GetMapping("/search")
    @Operation(summary = "Search docs by title")
    public ResponseEntity<Map<String, Object>> search(
            @RequestParam String q,
            @RequestParam String workspaceId,
            Authentication auth) {
        List<Doc> docs = docService.search(workspaceId, q);
        return ResponseEntity.ok(Map.of("data", docs));
    }

    // ── GET /api/docs/{id} ────────────────────────────────────
    @GetMapping("/{id}")
    @Operation(summary = "Get a single doc by ID")
    public ResponseEntity<Map<String, Object>> getById(
            @PathVariable String id,
            Authentication auth) {
        return docService.getById(id)
                .map(doc -> {
                    docService.touch(id);
                    Map<String, Object> body = new java.util.HashMap<>();
                    body.put("data", doc);
                    return ResponseEntity.<Map<String, Object>>ok(body);
                })
                .orElse(ResponseEntity.<Map<String, Object>>notFound().build());
    }

    // ── POST /api/docs ────────────────────────────────────────
    @PostMapping
    @Operation(summary = "Create a new doc")
    public ResponseEntity<Map<String, Object>> create(
            @RequestBody Doc doc,
            Authentication auth) {
        String email = auth != null ? auth.getName() : "anonymous";
        Doc created  = docService.create(doc, email);
        return ResponseEntity.ok(Map.of("data", created));
    }

    // ── PUT /api/docs/{id} ────────────────────────────────────
    @PutMapping("/{id}")
    @Operation(summary = "Update a doc (title, emoji, content, parentId)")
    public ResponseEntity<Map<String, Object>> update(
            @PathVariable String id,
            @RequestBody Doc patch,
            Authentication auth) {
        return docService.update(id, patch)
                .map(updated -> {
                    Map<String, Object> body = new java.util.HashMap<>();
                    body.put("data", updated);
                    return ResponseEntity.<Map<String, Object>>ok(body);
                })
                .orElse(ResponseEntity.<Map<String, Object>>notFound().build());
    }

    // ── DELETE /api/docs/{id} ─────────────────────────────────
    @DeleteMapping("/{id}")
    @Operation(summary = "Soft-delete a doc")
    public ResponseEntity<Map<String, Object>> delete(
            @PathVariable String id,
            Authentication auth) {
        boolean ok = docService.delete(id);
        return ok
                ? ResponseEntity.ok(Map.of("message", "Deleted"))
                : ResponseEntity.notFound().build();
    }

    // ── POST /api/docs/{id}/favorite ──────────────────────────
    @PostMapping("/{id}/favorite")
    @Operation(summary = "Toggle favourite status")
    public ResponseEntity<Map<String, Object>> toggleFavorite(
            @PathVariable String id,
            Authentication auth) {
        return docService.toggleFavorite(id)
                .map(doc -> {
                    Map<String, Object> body = new java.util.HashMap<>();
                    body.put("data", doc);
                    return ResponseEntity.<Map<String, Object>>ok(body);
                })
                .orElse(ResponseEntity.<Map<String, Object>>notFound().build());
    }

    // ── PATCH /api/docs/{id}/move ─────────────────────────────
    @PatchMapping("/{id}/move")
    @Operation(summary = "Move a doc to a different parent")
    public ResponseEntity<Map<String, Object>> move(
            @PathVariable String id,
            @RequestBody Map<String, String> body,
            Authentication auth) {
        String parentId = body.get("parentId");
        return docService.move(id, parentId)
                .map(doc -> {
                    Map<String, Object> responseBody = new java.util.HashMap<>();
                    responseBody.put("data", doc);
                    return ResponseEntity.<Map<String, Object>>ok(responseBody);
                })
                .orElse(ResponseEntity.<Map<String, Object>>notFound().build());
    }

    // ── POST /api/docs/{id}/duplicate ─────────────────────────
    @PostMapping("/{id}/duplicate")
    @Operation(summary = "Duplicate a doc")
    public ResponseEntity<Map<String, Object>> duplicate(
            @PathVariable String id,
            Authentication auth) {
        String email = auth != null ? auth.getName() : "anonymous";
        try {
            Doc copy = docService.duplicate(id, email);
            return ResponseEntity.ok(Map.of("data", copy));
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    // ── GET /api/docs/{id}/versions ───────────────────────
    @GetMapping("/{id}/versions")
    @Operation(summary = "Get version history for a doc")
    public ResponseEntity<Map<String, Object>> getVersions(
            @PathVariable String id,
            Authentication auth) {
        var versions = docService.getVersions(id);
        return ResponseEntity.ok(Map.of("data", versions));
    }

    // ── POST /api/docs/{id}/versions/{v}/restore ──────────────
    @PostMapping("/{id}/versions/{versionNumber}/restore")
    @Operation(summary = "Restore a doc to a specific version")
    public ResponseEntity<Map<String, Object>> restoreVersion(
            @PathVariable String id,
            @PathVariable int versionNumber,
            Authentication auth) {
        String email = auth != null ? auth.getName() : "anonymous";
        return docService.restoreVersion(id, versionNumber, email)
                .map(doc -> {
                    Map<String, Object> responseBody = new java.util.HashMap<>();
                    responseBody.put("data", doc);
                    return ResponseEntity.<Map<String, Object>>ok(responseBody);
                })
                .orElse(ResponseEntity.<Map<String, Object>>notFound().build());
    }

    // ── PUT /api/docs/{id}/access ─────────────────────────────
    /** Who can see the doc: audience (PRIVATE | DEPARTMENTS | WORKSPACE), departmentIds, sharedWith (emails). Omitted = unchanged. */
    @PutMapping("/{id}/access")
    @SuppressWarnings("unchecked")
    public ResponseEntity<Map<String, Object>> updateAccess(@PathVariable String id, @RequestBody Map<String, Object> body) {
        return docService.updateAccess(id, (String) body.get("audience"),
                        (List<String>) body.get("departmentIds"), (List<String>) body.get("sharedWith"))
                .map(doc -> {
                    Map<String, Object> out = new java.util.HashMap<>();
                    out.put("data", doc);
                    return ResponseEntity.<Map<String, Object>>ok(out);
                })
                .orElse(ResponseEntity.<Map<String, Object>>notFound().build());
    }

    // ── PUT /api/docs/{id}/access ─────────────────────────────
    /** Who can see the doc: audience (PRIVATE | DEPARTMENTS | WORKSPACE), departmentIds, sharedWith (emails). Omitted = unchanged. */
    @PutMapping("/{id}/access")
    @SuppressWarnings("unchecked")
    public ResponseEntity<Map<String, Object>> updateAccess(@PathVariable String id, @RequestBody Map<String, Object> body) {
        return docService.updateAccess(id, (String) body.get("audience"),
                        (List<String>) body.get("departmentIds"), (List<String>) body.get("sharedWith"))
                .map(doc -> {
                    Map<String, Object> out = new java.util.HashMap<>();
                    out.put("data", doc);
                    return ResponseEntity.<Map<String, Object>>ok(out);
                })
                .orElse(ResponseEntity.<Map<String, Object>>notFound().build());
    }

    // ── A-8: PATCH /api/docs/{id}/publish ────────────────────
    @PatchMapping("/{id}/publish")
    @Operation(summary = "Set doc visibility: PRIVATE | TEAM | PUBLIC")
    public ResponseEntity<Map<String, Object>> setVisibility(
            @PathVariable String id,
            @RequestBody Map<String, String> body,
            Authentication auth) {
        String visibility = body.getOrDefault("visibility", "PRIVATE");
        return docService.setVisibility(id, visibility)
                .map(doc -> {
                    Map<String, Object> rb = new java.util.HashMap<>();
                    rb.put("data", doc);
                    return ResponseEntity.<Map<String, Object>>ok(rb);
                })
                .orElse(ResponseEntity.<Map<String, Object>>notFound().build());
    }

    // ── A-12: PATCH /api/docs/{id}/tags ──────────────────────
    @PatchMapping("/{id}/tags")
    @Operation(summary = "Update tags and category for a doc")
    public ResponseEntity<Map<String, Object>> updateTags(
            @PathVariable String id,
            @RequestBody Map<String, Object> body,
            Authentication auth) {
        return docService.updateTags(id, body)
                .map(doc -> {
                    Map<String, Object> rb = new java.util.HashMap<>();
                    rb.put("data", doc);
                    return ResponseEntity.<Map<String, Object>>ok(rb);
                })
                .orElse(ResponseEntity.<Map<String, Object>>notFound().build());
    }

}

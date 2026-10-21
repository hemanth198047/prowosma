package com.prowosma.backend.controller;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.Doc;
import com.prowosma.backend.repository.DocRepository;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.*;

/**
 * Doc publishing uses Doc.publishedSlug as the public token.
 * Extra metadata (publishedBy, access level, expiry) stored in a
 * lightweight "doc_publish_meta" collection via MongoTemplate.
 */
@RestController
@Tag(name = "Doc Publishing", description = "Public sharing and publishing of documents")
@RequiredArgsConstructor
public class DocPublishingController {

    private final DocRepository    docRepository;
    private final MongoTemplate    mongoTemplate;
    private final WorkspaceContext workspaceContext;
    private final com.prowosma.backend.service.VisibilityService visibility;

    private static final String META_COL = "doc_publish_meta";

    @PostMapping("/api/docs/{id}/publish")
    public Map<String, Object> publish(@PathVariable String id,
                                        @RequestBody(required = false) Map<String, Object> options,
                                        Authentication auth) {
        Doc doc = docRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Doc not found: " + id));
        visibility.requireCanManageDoc(doc);

        String token = UUID.randomUUID().toString().replace("-", "");
        doc.setPublishedSlug(token);         // Doc.publishedSlug is the existing field
        doc.setVisibility("PUBLIC");
        doc.setUpdatedAt(LocalDateTime.now());
        docRepository.save(doc);

        // Store extra metadata in separate collection
        String access = options != null ? (String) options.getOrDefault("access", "view") : "view";
        LocalDateTime expiry = null;
        if (options != null && options.containsKey("expiresInDays")) {
            int days = ((Number) options.get("expiresInDays")).intValue();
            expiry = LocalDateTime.now().plusDays(days);
        }
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("docId",       id);
        meta.put("token",       token);
        meta.put("access",      access);
        meta.put("publishedBy", auth.getName());
        meta.put("publishedAt", LocalDateTime.now().toString());
        meta.put("expiresAt",   expiry != null ? expiry.toString() : null);
        // Upsert: remove old meta for this doc then save
        mongoTemplate.remove(new Query(Criteria.where("docId").is(id)), META_COL);
        mongoTemplate.save(meta, META_COL);

        return Map.of(
            "token",     token,
            "url",       "/public/docs/" + token,
            "access",    access,
            "expiresAt", expiry != null ? expiry.toString() : "never",
            "message",   "Document published"
        );
    }

    @DeleteMapping("/api/docs/{id}/publish")
    public Map<String, String> unpublish(@PathVariable String id) {
        Doc doc = docRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Doc not found: " + id));
        visibility.requireCanManageDoc(doc);
        doc.setPublishedSlug(null);
        doc.setVisibility("PRIVATE");
        doc.setUpdatedAt(LocalDateTime.now());
        docRepository.save(doc);
        mongoTemplate.remove(new Query(Criteria.where("docId").is(id)), META_COL);
        return Map.of("message", "Document unpublished — public link revoked");
    }

    @GetMapping("/api/docs/{id}/publish")
    public Map<String, Object> getPublishStatus(@PathVariable String id) {
        Doc doc = docRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Doc not found: " + id));
        visibility.requireDocVisible(doc);
        boolean published = doc.getPublishedSlug() != null;
        List<Map> metas = mongoTemplate.find(
            new Query(Criteria.where("docId").is(id)), Map.class, META_COL);
        Map<String, Object> status = new LinkedHashMap<>();
        status.put("published",   published);
        status.put("url",         published ? "/public/docs/" + doc.getPublishedSlug() : null);
        if (!metas.isEmpty()) {
            Map m = metas.get(0);
            status.put("access",      m.get("access"));
            status.put("publishedBy", m.get("publishedBy"));
            status.put("publishedAt", m.get("publishedAt"));
            status.put("expiresAt",   m.get("expiresAt"));
        }
        return status;
    }

    /** Public read — no auth required */
    @GetMapping("/public/docs/{token}")
    public ResponseEntity<Map<String, Object>> getPublicDoc(@PathVariable String token) {
        // Find doc by publishedSlug
        Query q = new Query(Criteria.where("publishedSlug").is(token));
        List<Doc> docs = mongoTemplate.find(q, Doc.class);
        if (docs.isEmpty()) return ResponseEntity.notFound().build();
        Doc doc = docs.get(0);
        if (!"PUBLIC".equals(doc.getVisibility())) return ResponseEntity.notFound().build();

        // Check expiry from meta
        List<Map> metas = mongoTemplate.find(
            new Query(Criteria.where("token").is(token)), Map.class, META_COL);
        if (!metas.isEmpty()) {
            String expiresStr = (String) metas.get(0).get("expiresAt");
            if (expiresStr != null) {
                LocalDateTime exp = LocalDateTime.parse(expiresStr);
                if (exp.isBefore(LocalDateTime.now()))
                    return ResponseEntity.status(410).body(Map.of("error", "This public link has expired"));
            }
        }

        Map<String, Object> view = new LinkedHashMap<>();
        view.put("title",     doc.getTitle());
        view.put("content",   doc.getContent());
        view.put("updatedAt", doc.getUpdatedAt());
        view.put("access",    metas.isEmpty() ? "view" : metas.get(0).get("access"));
        return ResponseEntity.ok(view);
    }
}

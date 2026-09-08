package com.prowosma.backend.service;

import com.prowosma.backend.model.Doc;
import com.prowosma.backend.model.DocVersion;
import com.prowosma.backend.repository.DocRepository;
import com.prowosma.backend.repository.DocVersionRepository;
import com.prowosma.backend.service.ActivityLogService;
import com.prowosma.backend.config.WorkspaceContext;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Service
@RequiredArgsConstructor
public class DocService {

    private final DocRepository        docRepository;
    private final DocVersionRepository versionRepository;
    private final ActivityLogService   activityLogService;
    private final WorkspaceContext     workspaceContext;

    // Max versions to keep per doc (oldest auto-pruned beyond this)
    private static final int MAX_VERSIONS = 50;

    // ── List all docs in a workspace ──────────────────────────
    public List<Doc> getByWorkspace(String workspaceId) {
        return docRepository.findByWorkspaceIdAndDeletedFalse(workspaceId);
    }

    // ── Get single doc ────────────────────────────────────────
    public Optional<Doc> getById(String id) {
        return docRepository.findById(id);
    }

    // ── Create doc ────────────────────────────────────────────
    public Doc create(Doc doc, String createdBy) {
        doc.setCreatedBy(createdBy);
        doc.setCreatedAt(LocalDateTime.now());
        doc.setUpdatedAt(LocalDateTime.now());
        doc.setViewedAt(LocalDateTime.now());
        doc.setDeleted(false);
        if (doc.getEmoji()   == null || doc.getEmoji().isEmpty())   doc.setEmoji("📄");
        if (doc.getTitle()   == null) doc.setTitle("Untitled");
        if (doc.getContent() == null) doc.setContent("[]");
        Doc saved = docRepository.save(doc);
        // Snapshot version 1 on creation
        snapshotVersion(saved, createdBy, "Created");
        activityLogService.log("DOC", saved.getId(), saved.getTitle(),
                "CREATED", null, saved.getTitle(), createdBy);
        return saved;
    }

    // ── Update doc + auto-snapshot ────────────────────────────
    public Optional<Doc> update(String id, Doc patch) {
        return update(id, patch, "anonymous", "Auto-save");
    }

    public Optional<Doc> update(String id, Doc patch, String savedBy, String label) {
        return docRepository.findById(id).map(existing -> {
            if (patch.getTitle()   != null) existing.setTitle(patch.getTitle());
            if (patch.getEmoji()   != null) existing.setEmoji(patch.getEmoji());
            if (patch.getContent()    != null) existing.setContent(patch.getContent());
            if (patch.getParentId()   != null) existing.setParentId(patch.getParentId());
            if (patch.getVisibility() != null) existing.setVisibility(patch.getVisibility());
            if (patch.getCategory()   != null) existing.setCategory(patch.getCategory());
            if (patch.getTags()       != null) existing.setTags(patch.getTags());
            existing.setUpdatedAt(LocalDateTime.now());
            Doc saved = docRepository.save(existing);
            // Snapshot — skip if content identical to last version
            snapshotIfChanged(saved, savedBy, label);
            return saved;
        });
    }

    // ── Soft delete ───────────────────────────────────────────
    public boolean delete(String id) {
        return docRepository.findById(id).map(doc -> {
            activityLogService.log("DOC", doc.getId(), doc.getTitle(),
                    "DELETED", doc.getTitle(), null, null);
            doc.setDeleted(true);
            doc.setUpdatedAt(LocalDateTime.now());
            docRepository.save(doc);
            return true;
        }).orElse(false);
    }

    // ── Search ────────────────────────────────────────────────
    public List<Doc> search(String workspaceId, String q) {
        return docRepository.findByWorkspaceIdAndTitleContainingIgnoreCaseAndDeletedFalse(workspaceId, q);
    }

    // ── Recent docs ───────────────────────────────────────────
    public List<Doc> getRecent(String workspaceId) {
        return docRepository.findTop10ByWorkspaceIdAndDeletedFalseOrderByViewedAtDesc(workspaceId);
    }

    // ── Favorites ─────────────────────────────────────────────
    public List<Doc> getFavorites(String workspaceId) {
        return docRepository.findByWorkspaceIdAndFavoriteTrueAndDeletedFalse(workspaceId);
    }

    public Optional<Doc> toggleFavorite(String id) {
        return docRepository.findById(id).map(doc -> {
            doc.setFavorite(!doc.isFavorite());
            doc.setUpdatedAt(LocalDateTime.now());
            return docRepository.save(doc);
        });
    }

    // ── Move (change parent) ──────────────────────────────────
    public Optional<Doc> move(String id, String newParentId) {
        return docRepository.findById(id).map(doc -> {
            doc.setParentId(newParentId);
            doc.setUpdatedAt(LocalDateTime.now());
            return docRepository.save(doc);
        });
    }

    // ── Duplicate ─────────────────────────────────────────────
    public Doc duplicate(String id, String createdBy) {
        return docRepository.findById(id).map(original -> {
            Doc copy = new Doc();
            copy.setWorkspaceId(original.getWorkspaceId());
            copy.setParentId(original.getParentId());
            copy.setTitle(original.getTitle() + " (copy)");
            copy.setEmoji(original.getEmoji());
            copy.setContent(original.getContent());
            copy.setCreatedBy(createdBy);
            copy.setCreatedAt(LocalDateTime.now());
            copy.setUpdatedAt(LocalDateTime.now());
            copy.setViewedAt(LocalDateTime.now());
            Doc saved = docRepository.save(copy);
            snapshotVersion(saved, createdBy, "Duplicated");
            return saved;
        }).orElseThrow(() -> new RuntimeException("Doc not found: " + id));
    }

    // ── Touch viewedAt ────────────────────────────────────────
    public void touch(String id) {
        docRepository.findById(id).ifPresent(doc -> {
            doc.setViewedAt(LocalDateTime.now());
            docRepository.save(doc);
        });
    }

    // ── Version history ───────────────────────────────────────
    public List<DocVersion> getVersions(String docId) {
        return versionRepository.findByDocIdOrderByVersionNumberDesc(docId);
    }

    // ── Restore a specific version ────────────────────────────
    public Optional<Doc> restoreVersion(String docId, int versionNumber, String restoredBy) {
        return versionRepository.findByDocIdOrderByVersionNumberDesc(docId)
                .stream()
                .filter(v -> v.getVersionNumber() == versionNumber)
                .findFirst()
                .flatMap(version -> {
                    Doc patch = new Doc();
                    patch.setTitle(version.getTitle());
                    patch.setEmoji(version.getEmoji());
                    patch.setContent(version.getContent());
                    return update(docId, patch, restoredBy, "Restored from v" + versionNumber);
                });
    }

    // ── Snapshot helpers ──────────────────────────────────────
    private void snapshotIfChanged(Doc doc, String savedBy, String label) {
        // Skip snapshot if content is identical to the most recent version
        versionRepository.findFirstByDocIdOrderByVersionNumberDesc(doc.getId())
                .ifPresentOrElse(
                    last -> {
                        boolean contentSame = doc.getContent() != null
                                && doc.getContent().equals(last.getContent());
                        boolean titleSame   = doc.getTitle() != null
                                && doc.getTitle().equals(last.getTitle());
                        if (!contentSame || !titleSame) {
                            snapshotVersion(doc, savedBy, label);
                        }
                    },
                    () -> snapshotVersion(doc, savedBy, label)
                );
    }

    private void snapshotVersion(Doc doc, String savedBy, String label) {
        long nextNum = versionRepository.countByDocId(doc.getId()) + 1;

        DocVersion v = new DocVersion();
        v.setDocId(doc.getId());
        v.setWorkspaceId(doc.getWorkspaceId());
        v.setVersionNumber((int) nextNum);
        v.setTitle(doc.getTitle());
        v.setEmoji(doc.getEmoji());
        v.setContent(doc.getContent());
        v.setSavedBy(savedBy);
        v.setChangeLabel(label);
        v.setWordCount(countWords(doc.getContent()));
        v.setCreatedAt(LocalDateTime.now());
        versionRepository.save(v);

        // Prune oldest versions beyond MAX_VERSIONS
        pruneOldVersions(doc.getId());
    }

    private void pruneOldVersions(String docId) {
        List<DocVersion> all = versionRepository.findByDocIdOrderByVersionNumberAsc(docId);
        if (all.size() > MAX_VERSIONS) {
            List<DocVersion> toDelete = all.subList(0, all.size() - MAX_VERSIONS);
            versionRepository.deleteAll(toDelete);
        }
    }

    private int countWords(String content) {
        if (content == null || content.isEmpty()) return 0;
        // Simple word count — strip JSON syntax, split on whitespace
        String text = content
                .replaceAll("\\{[^}]*\\}", " ")  // remove JSON keys
                .replaceAll("[\"\\[\\]{}:,]", " ")
                .trim();
        if (text.isEmpty()) return 0;
        return text.split("\\s+").length;
    }

    // ── A-8: Set visibility ───────────────────────────────────
    public Optional<Doc> setVisibility(String id, String visibility) {
        return docRepository.findById(id).map(doc -> {
            doc.setVisibility(visibility);
            if ("PUBLIC".equals(visibility) && (doc.getPublishedSlug() == null || doc.getPublishedSlug().isEmpty())) {
                // generate a slug from title
                String slug = doc.getTitle().toLowerCase()
                    .replaceAll("[^a-z0-9]+", "-")
                    .replaceAll("^-|-$", "");
                if (slug.isEmpty()) slug = "doc";
                doc.setPublishedSlug(slug + "-" + doc.getId().substring(0, 6));
            }
            doc.setUpdatedAt(java.time.LocalDateTime.now());
            return docRepository.save(doc);
        });
    }

    // ── A-12: Update tags & category ─────────────────────────
    @SuppressWarnings("unchecked")
    public Optional<Doc> updateTags(String id, java.util.Map<String, Object> body) {
        return docRepository.findById(id).map(doc -> {
            if (body.containsKey("tags")) {
                Object t = body.get("tags");
                if (t instanceof java.util.List) doc.setTags((java.util.List<String>) t);
            }
            if (body.containsKey("category")) {
                doc.setCategory((String) body.get("category"));
            }
            doc.setUpdatedAt(java.time.LocalDateTime.now());
            return docRepository.save(doc);
        });
    }


    // ── A-9: Collab helpers ───────────────────────────────────────
    public Doc save(Doc doc) {
        doc.setUpdatedAt(java.time.LocalDateTime.now());
        return docRepository.save(doc);
    }


}

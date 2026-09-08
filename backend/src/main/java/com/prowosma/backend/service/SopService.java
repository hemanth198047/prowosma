package com.prowosma.backend.service;

import com.prowosma.backend.model.Sop;
import com.prowosma.backend.repository.SopRepository;
import com.prowosma.backend.service.ActivityLogService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

@Service
@RequiredArgsConstructor
public class SopService {

    private final SopRepository sopRepository;
    private final ActivityLogService activityLogService;

    // ── List ──────────────────────────────────────────────────
    public List<Sop> getByWorkspace(String wsId) {
        return sopRepository.findByWorkspaceIdOrderByUpdatedAtDesc(wsId);
    }

    public List<Sop> getByStatus(String wsId, String status) {
        return sopRepository.findByWorkspaceIdAndStatusOrderByUpdatedAtDesc(wsId, status);
    }

    public List<Sop> getByCategory(String wsId, String category) {
        return sopRepository.findByWorkspaceIdAndCategoryOrderByUpdatedAtDesc(wsId, category);
    }

    public List<Sop> search(String wsId, String q) {
        return sopRepository.findByWorkspaceIdAndTitleContainingIgnoreCaseOrderByUpdatedAtDesc(wsId, q);
    }

    public Optional<Sop> getById(String id) {
        return sopRepository.findById(id);
    }

    // ── Create ────────────────────────────────────────────────
    public Sop create(Sop sop, String createdBy) {
        sop.setCreatedBy(createdBy);
        sop.setCreatedAt(LocalDateTime.now());
        sop.setUpdatedAt(LocalDateTime.now());
        if (sop.getStatus() == null || sop.getStatus().isEmpty()) sop.setStatus("DRAFT");
        if (sop.getTitle()  == null) sop.setTitle("Untitled SOP");
        if (sop.getVersion() == 0)   sop.setVersion(1);
        if (sop.getVersionHistory() == null) sop.setVersionHistory(new ArrayList<>());
        if (sop.getAcknowledgements() == null) sop.setAcknowledgements(new ArrayList<>());
        Sop saved = sopRepository.save(sop);
        activityLogService.log("SOP", saved.getId(), saved.getTitle(),
                "CREATED", null, saved.getTitle(), createdBy);
        return saved;
    }

    // ── Update (auto-saves content without bumping version) ───
    public Optional<Sop> update(String id, Sop patch) {
        return sopRepository.findById(id).map(existing -> {
            if (patch.getTitle()       != null) existing.setTitle(patch.getTitle());
            if (patch.getDescription() != null) existing.setDescription(patch.getDescription());
            if (patch.getContent()     != null) existing.setContent(patch.getContent());
            if (patch.getCategory()    != null) existing.setCategory(patch.getCategory());
            if (patch.getOwner()       != null) existing.setOwner(patch.getOwner());
            if (patch.getStatus()      != null) existing.setStatus(patch.getStatus());
            if (patch.getReviewDue()   != null) existing.setReviewDue(patch.getReviewDue());
            if (patch.getRequiredAcknowledgers() != null)
                existing.setRequiredAcknowledgers(patch.getRequiredAcknowledgers());
            existing.setUpdatedAt(LocalDateTime.now());
            return sopRepository.save(existing);
        });
    }

    // ── Publish — bumps version, snapshots old content ────────
    public Optional<Sop> publish(String id, String publishedBy, String changeNote) {
        return sopRepository.findById(id).map(sop -> {
            // Snapshot current version
            Sop.SopVersion snap = new Sop.SopVersion();
            snap.setVersion(sop.getVersion());
            snap.setContent(sop.getContent());
            snap.setChangedBy(publishedBy);
            snap.setChangeNote(changeNote != null ? changeNote : "Published v" + sop.getVersion());
            snap.setCreatedAt(LocalDateTime.now());
            sop.getVersionHistory().add(snap);

            // Bump version and set status
            sop.setVersion(sop.getVersion() + 1);
            sop.setStatus("PUBLISHED");
            sop.setPublishedAt(LocalDateTime.now());
            sop.setUpdatedAt(LocalDateTime.now());
            // Clear acknowledgements — everyone must re-ack the new version
            sop.setAcknowledgements(new ArrayList<>());
            Sop saved = sopRepository.save(sop);
        activityLogService.log("SOP", saved.getId(), saved.getTitle(),
                "CREATED", null, saved.getTitle(), null);
        return saved;
        });
    }

    // ── Archive ───────────────────────────────────────────────
    public Optional<Sop> archive(String id) {
        return sopRepository.findById(id).map(sop -> {
            sop.setStatus("ARCHIVED");
            sop.setUpdatedAt(LocalDateTime.now());
            Sop saved = sopRepository.save(sop);
        activityLogService.log("SOP", saved.getId(), saved.getTitle(),
                "CREATED", null, saved.getTitle(), null);
        return saved;
        });
    }

    // ── Acknowledge ───────────────────────────────────────────
    public Optional<Sop> acknowledge(String id, String userEmail, String userName) {
        return sopRepository.findById(id).map(sop -> {
            // Remove any previous ack from this user
            sop.getAcknowledgements().removeIf(a -> userEmail.equals(a.getUserEmail()));

            Sop.Acknowledgement ack = new Sop.Acknowledgement();
            ack.setUserEmail(userEmail);
            ack.setUserName(userName);
            ack.setSopVersion(sop.getVersion());
            ack.setAckedAt(LocalDateTime.now());
            sop.getAcknowledgements().add(ack);
            sop.setUpdatedAt(LocalDateTime.now());
            Sop saved = sopRepository.save(sop);
        activityLogService.log("SOP", saved.getId(), saved.getTitle(),
                "CREATED", null, saved.getTitle(), null);
        return saved;
        });
    }

    // ── Revoke acknowledgement ────────────────────────────────
    public Optional<Sop> revokeAck(String id, String userEmail) {
        return sopRepository.findById(id).map(sop -> {
            sop.getAcknowledgements().removeIf(a -> userEmail.equals(a.getUserEmail()));
            sop.setUpdatedAt(LocalDateTime.now());
            Sop saved = sopRepository.save(sop);
        activityLogService.log("SOP", saved.getId(), saved.getTitle(),
                "CREATED", null, saved.getTitle(), null);
        return saved;
        });
    }

    // ── Delete ────────────────────────────────────────────────
    public boolean delete(String id) {
        if (!sopRepository.existsById(id)) return false;
        activityLogService.log("SOP", id, id, "DELETED", null, null, null);
        sopRepository.deleteById(id);
        return true;
    }
}

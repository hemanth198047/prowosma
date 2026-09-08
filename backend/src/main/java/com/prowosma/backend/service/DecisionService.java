package com.prowosma.backend.service;

import com.prowosma.backend.model.Decision;
import com.prowosma.backend.repository.DecisionRepository;
import com.prowosma.backend.service.ActivityLogService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Service
@RequiredArgsConstructor
public class DecisionService {

    private final DecisionRepository decisionRepository;
    private final ActivityLogService activityLogService;

    public List<Decision> getByWorkspace(String workspaceId) {
        return decisionRepository.findByWorkspaceIdOrderByCreatedAtDesc(workspaceId);
    }

    public List<Decision> getByDoc(String docId) {
        return decisionRepository.findByDocIdOrderByCreatedAtDesc(docId);
    }

    public List<Decision> getByStatus(String workspaceId, String status) {
        return decisionRepository.findByWorkspaceIdAndStatusOrderByCreatedAtDesc(workspaceId, status);
    }

    public List<Decision> search(String workspaceId, String q) {
        return decisionRepository.findByWorkspaceIdAndTitleContainingIgnoreCaseOrderByCreatedAtDesc(workspaceId, q);
    }

    public Optional<Decision> getById(String id) {
        return decisionRepository.findById(id);
    }

    public Decision create(Decision d, String createdBy) {
        d.setCreatedBy(createdBy);
        d.setCreatedAt(LocalDateTime.now());
        d.setUpdatedAt(LocalDateTime.now());
        if (d.getStatus()  == null || d.getStatus().isEmpty())  d.setStatus("PROPOSED");
        if (d.getImpact()  == null || d.getImpact().isEmpty())  d.setImpact("MEDIUM");
        if (d.getTitle()   == null) d.setTitle("Untitled Decision");
        Decision saved = decisionRepository.save(d);
        activityLogService.log("DECISION", saved.getId(), saved.getTitle(),
                "CREATED", null, saved.getTitle(), createdBy != null ? createdBy : null);
        return saved;
    }

    public Optional<Decision> update(String id, Decision patch) {
        return decisionRepository.findById(id).map(existing -> {
            if (patch.getTitle()     != null) existing.setTitle(patch.getTitle());
            if (patch.getContext()   != null) existing.setContext(patch.getContext());
            if (patch.getDecision()  != null) existing.setDecision(patch.getDecision());
            if (patch.getRationale() != null) existing.setRationale(patch.getRationale());
            if (patch.getOutcome()   != null) existing.setOutcome(patch.getOutcome());
            if (patch.getOwner()     != null) existing.setOwner(patch.getOwner());
            if (patch.getStatus()    != null) existing.setStatus(patch.getStatus());
            if (patch.getImpact()    != null) existing.setImpact(patch.getImpact());
            if (patch.getTags()      != null) existing.setTags(patch.getTags());
            if (patch.getLinkedTaskIds()    != null) existing.setLinkedTaskIds(patch.getLinkedTaskIds());
            if (patch.getLinkedProjectIds() != null) existing.setLinkedProjectIds(patch.getLinkedProjectIds());
            if (patch.getDecidedAt() != null) existing.setDecidedAt(patch.getDecidedAt());
            if (patch.getDocId()     != null) existing.setDocId(patch.getDocId());
            existing.setUpdatedAt(LocalDateTime.now());
            return decisionRepository.save(existing);
        });
    }

    public boolean delete(String id) {
        if (!decisionRepository.existsById(id)) return false;
        activityLogService.log("DECISION", id, id, "DELETED", null, null, null);
        decisionRepository.deleteById(id);
        return true;
    }
}

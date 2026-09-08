package com.prowosma.backend.controller;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.Decision;
import com.prowosma.backend.repository.DecisionRepository;
import com.prowosma.backend.service.AIService;
import com.prowosma.backend.util.PagedResponse;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import java.time.LocalDateTime;
import java.util.*;

@RestController @RequestMapping("/api/decisions") @RequiredArgsConstructor
public class DecisionController {
    private final DecisionRepository repo;
    private final AIService          aiService;
    private final WorkspaceContext   ws;

    @GetMapping
    public List<Decision> getAll() {
        return repo.findByOrganizationIdOrderByCreatedAtDesc(ws.getWorkspaceId());
    }

    /**
     * Decisions linked to a specific doc — DecisionRepository already had
     * findByDocIdOrderByCreatedAtDesc (marked "legacy... old feature" in
     * its own comment) ready to use, but no route ever called it. Docs.jsx
     * has been calling GET /decisions/doc/{docId} every time a document is
     * opened, 404ing silently (caught, falls back to an empty list) — the
     * "decisions linked to this doc" panel has likely never shown anything.
     *
     * findByDocIdOrderByCreatedAtDesc filters only by docId, with no
     * organizationId check — exposing it directly would let any workspace
     * read another workspace's decisions for a guessed/leaked doc ID, so
     * the workspace filter here isn't optional.
     */
    @GetMapping("/doc/{docId}")
    public List<Decision> getByDoc(@PathVariable String docId) {
        return repo.findByDocIdOrderByCreatedAtDesc(docId).stream()
                .filter(d -> ws.getWorkspaceId() != null && ws.getWorkspaceId().equals(d.getOrganizationId()))
                .toList();
    }

    @PostMapping
    public Decision create(@RequestBody Decision d, Authentication auth) {
        d.setOrganizationId(ws.getWorkspaceId());
        d.setCreatedBy(auth.getName());
        d.setCreatedAt(LocalDateTime.now()); d.setUpdatedAt(LocalDateTime.now());
        // AI analysis on creation
        if (aiService != null && d.getContext() != null && !d.getContext().isEmpty()) {
            try {
                String prompt = "Analyse this decision. Consider: alternatives, risks, second-order effects, reversibility. Be concise (3-4 sentences).";
                d.setAiSuggestion(aiService.ask(prompt, "Decision: " + d.getTitle() + "\nContext: " + d.getContext()));
            } catch (Exception ignored) {}
        }
        return repo.save(d);
    }

    @PutMapping("/{id}")
    public Decision update(@PathVariable String id, @RequestBody Decision patch) {
        return repo.findById(id).map(d -> {
            if (patch.getTitle()         != null) d.setTitle(patch.getTitle());
            if (patch.getContext()       != null) d.setContext(patch.getContext());
            if (patch.getDecision()      != null) d.setDecision(patch.getDecision());
            if (patch.getRationale()     != null) d.setRationale(patch.getRationale());
            if (patch.getAlternatives()  != null) d.setAlternatives(patch.getAlternatives());
            if (patch.getOutcome()       != null) d.setOutcome(patch.getOutcome());
            if (patch.getStatus()        != null) d.setStatus(patch.getStatus());
            if (patch.getImpact()        != null) d.setImpact(patch.getImpact());
            if (patch.getReversibility() != null) d.setReversibility(patch.getReversibility());
            d.setUpdatedAt(LocalDateTime.now());
            return repo.save(d);
        }).orElseThrow();
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String,String>> delete(@PathVariable String id) {
        repo.deleteById(id); return ResponseEntity.ok(Map.of("message","Deleted"));
    }

    @PostMapping("/{id}/ai-analyse")
    public Map<String, String> aiAnalyse(@PathVariable String id) {
        Decision d = repo.findById(id).orElseThrow();
        try {
            String prompt = "You are a decision intelligence advisor. Analyse this decision for: "
                + "1) hidden risks, 2) better alternatives, 3) second-order effects, "
                + "4) reversibility assessment, 5) recommendation. Be specific and actionable.";
            String ctx = "Title: " + d.getTitle() + "\nContext: " + d.getContext()
                + "\nDecision made: " + d.getDecision()
                + "\nAlternatives considered: " + d.getAlternatives()
                + "\nImpact: " + d.getImpact() + " | Reversibility: " + d.getReversibility();
            String analysis = aiService.ask(prompt, ctx);
            d.setAiSuggestion(analysis);
            d.setUpdatedAt(LocalDateTime.now());
            repo.save(d);
            return Map.of("analysis", analysis);
        } catch (Exception e) {
            return Map.of("analysis", "AI analysis unavailable: " + e.getMessage());
        }
    }
}

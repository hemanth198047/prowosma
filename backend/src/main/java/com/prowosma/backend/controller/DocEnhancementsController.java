package com.prowosma.backend.controller;
import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.Doc;
import com.prowosma.backend.repository.DocRepository;
import com.prowosma.backend.service.AIService;
import com.prowosma.backend.util.PagedResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

@RestController @RequestMapping("/api/docs") @RequiredArgsConstructor
public class DocEnhancementsController {
    private final DocRepository  docRepo;
    private final AIService      aiService;
    private final WorkspaceContext ws;

    @GetMapping("/{id}/comments")
    public List<Doc.InlineComment> getComments(@PathVariable String id) {
        return docRepo.findById(id).map(d ->
            d.getInlineComments() != null ? d.getInlineComments() : List.<Doc.InlineComment>of()
        ).orElse(List.of());
    }

    @PostMapping("/{id}/comments")
    public Doc addComment(@PathVariable String id,
                           @RequestBody Doc.InlineComment comment, Authentication auth) {
        comment.setAuthorEmail(auth.getName());
        comment.setCreatedAt(LocalDateTime.now());
        return docRepo.findById(id).map(d -> {
            if (d.getInlineComments() == null) d.setInlineComments(new ArrayList<>());
            d.getInlineComments().add(comment);
            return docRepo.save(d);
        }).orElseThrow();
    }

    @PostMapping("/{id}/comments/{cid}/reply")
    public Doc addReply(@PathVariable String id, @PathVariable String cid,
                         @RequestBody Doc.InlineComment reply, Authentication auth) {
        reply.setAuthorEmail(auth.getName());
        reply.setCreatedAt(LocalDateTime.now());
        return docRepo.findById(id).map(d -> {
            if (d.getInlineComments() != null)
                d.getInlineComments().stream().filter(c -> cid.equals(c.getId())).findFirst()
                    .ifPresent(c -> { if (c.getReplies()==null) c.setReplies(new ArrayList<>()); c.getReplies().add(reply); });
            return docRepo.save(d);
        }).orElseThrow();
    }

    @PatchMapping("/{id}/comments/{cid}/resolve")
    public Doc resolveComment(@PathVariable String id, @PathVariable String cid) {
        return docRepo.findById(id).map(d -> {
            if (d.getInlineComments() != null)
                d.getInlineComments().stream().filter(c -> cid.equals(c.getId())).findFirst()
                    .ifPresent(c -> c.setResolved(true));
            return docRepo.save(d);
        }).orElseThrow();
    }

    @PatchMapping("/{id}/freshness")
    public Doc updateFreshness(@PathVariable String id, @RequestBody Map<String, Object> body) {
        return docRepo.findById(id).map(d -> {
            if (body.containsKey("reviewAt"))
                try { d.setReviewAt(LocalDateTime.parse((String)body.get("reviewAt"))); } catch (Exception ignored) {}
            if (body.containsKey("stale")) d.setStale((Boolean)body.get("stale"));
            d.setLastReviewedAt(LocalDateTime.now()); d.setFreshnessScore(100);
            return docRepo.save(d);
        }).orElseThrow();
    }

    @GetMapping("/stale")
    public List<Doc> getStale(@RequestParam(defaultValue = "90") int olderThanDays) {
        LocalDateTime cutoff = LocalDateTime.now().minusDays(olderThanDays);
        return docRepo.findByWorkspaceIdAndDeletedFalse(ws.getWorkspaceId()).stream()
            .limit(2000)  // [PAGINATION-FIX]
            .filter(d -> d.getUpdatedAt() != null && d.getUpdatedAt().isBefore(cutoff))
            .peek(d -> { d.setStale(true); docRepo.save(d); })
            .collect(Collectors.toList());
    }

    @PostMapping("/{id}/auto-link")
    public ResponseEntity<Map<String, Object>> autoLink(@PathVariable String id) {
        Doc doc = docRepo.findById(id).orElseThrow();
        List<Doc> allDocs = docRepo.findByWorkspaceIdAndDeletedFalse(ws.getWorkspaceId()).stream().limit(2000).toList(); // [PAGINATION-FIX]
        String[] words = doc.getTitle().toLowerCase().split("\\s+");
        List<String> related = allDocs.stream()
            .filter(d -> !d.getId().equals(id))
            .filter(d -> Arrays.stream(words).anyMatch(w ->
                w.length() > 3 && d.getTitle().toLowerCase().contains(w)))
            .map(Doc::getId).limit(5).collect(Collectors.toList());
        doc.setAutoLinkedDocIds(related);
        docRepo.save(doc);
        String aiSuggestion = "";
        try { aiSuggestion = aiService.ask(
            "Given this document title and tags, suggest 3 related topics.",
            "Title: " + doc.getTitle() + "\nTags: " + doc.getTags()); } catch (Exception ignored) {}
        Map<String,Object> result = new LinkedHashMap<>();
        result.put("relatedDocIds", related);
        result.put("aiSuggestions", aiSuggestion);
        return ResponseEntity.ok(result);
    }
}

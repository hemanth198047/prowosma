package com.prowosma.backend.controller;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.MeetingActionItem;
import com.prowosma.backend.service.MeetingActionItemService;
import io.swagger.v3.oas.annotations.tags.Tag;
import com.prowosma.backend.util.PagedResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * Meeting-originated action items — the canonical, top-level record that
 * meetings reference (never copy) so an item carried across many meetings
 * stays a single business record. See MeetingActionItemService for the
 * carry-forward / defer / dismiss lifecycle rules.
 */
@RestController
@RequestMapping("/api/meeting-action-items")
@Tag(name = "Meeting Action Items", description = "Canonical action items raised in meetings")
@RequiredArgsConstructor
public class MeetingActionItemController {

    private final MeetingActionItemService service;
    private final WorkspaceContext workspaceContext;

    @GetMapping
    public PagedResponse<MeetingActionItem> getAll(
            @RequestParam(defaultValue = "0")  int page,
            @RequestParam(defaultValue = "50") int size) {
        String orgId = workspaceContext.getWorkspaceId();
        return PagedResponse.ofList(service.getAll(orgId), page, Math.min(size, 200));
    }

    @GetMapping("/{id}")
    public MeetingActionItem getById(@PathVariable String id) {
        return service.getById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Action item not found: " + id));
    }

    /**
     * Ad-hoc creation not tied to a specific meeting's project-discussion
     * flow (e.g. quick-add). {@code sourceMeetingId} is optional here —
     * the normal path is via MeetingController's project sub-resources,
     * which always pass a meetingId.
     */
    @PostMapping
    public MeetingActionItem create(@RequestBody MeetingActionItem item,
                                     @RequestParam(required = false) String meetingId,
                                     Authentication auth) {
        return service.create(item, meetingId, auth.getName());
    }

    @PutMapping("/{id}")
    public MeetingActionItem update(@PathVariable String id, @RequestBody MeetingActionItem patch, Authentication auth) {
        return service.update(id, patch, auth.getName());
    }

    @PostMapping("/{id}/complete")
    public MeetingActionItem complete(@PathVariable String id,
                                       @RequestParam(required = false) String meetingId,
                                       Authentication auth) {
        return service.complete(id, auth.getName(), meetingId);
    }

    @PostMapping("/{id}/dismiss")
    public MeetingActionItem dismiss(@PathVariable String id,
                                      @RequestParam(required = false) String meetingId,
                                      Authentication auth) {
        return service.dismiss(id, auth.getName(), meetingId);
    }

    /** Defer until next meeting (omit deferredUntil) or a specific date. */
    @PostMapping("/{id}/defer")
    public MeetingActionItem defer(@PathVariable String id,
                                    @RequestBody(required = false) Map<String, String> body,
                                    @RequestParam(required = false) String meetingId,
                                    Authentication auth) {
        LocalDateTime deferredUntil = null;
        if (body != null && body.get("deferredUntil") != null) {
            deferredUntil = LocalDateTime.parse(body.get("deferredUntil"));
        }
        return service.defer(id, deferredUntil, auth.getName(), meetingId);
    }

    @PostMapping("/{id}/reassign")
    public MeetingActionItem reassign(@PathVariable String id, @RequestBody Map<String, String> body, Authentication auth) {
        return service.reassign(id, body.get("owner"), auth.getName());
    }

    @PostMapping("/{id}/touch")
    public MeetingActionItem touch(@PathVariable String id, @RequestParam String meetingId) {
        return service.touchInMeeting(id, meetingId);
    }

    @PatchMapping("/{id}/converted-task")
    public MeetingActionItem markConverted(@PathVariable String id, @RequestBody Map<String, String> body) {
        return service.markConvertedToTask(id, body.get("taskId"));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, String>> delete(@PathVariable String id) {
        boolean deleted = service.delete(id);
        if (!deleted) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Action item not found: " + id);
        return ResponseEntity.ok(Map.of("message", "Deleted"));
    }
}

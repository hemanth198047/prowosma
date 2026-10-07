package com.prowosma.backend.controller;

import com.prowosma.backend.service.MeetingAssistantService;
import com.prowosma.backend.service.MeetingAssistantService.CreateRequest;
import com.prowosma.backend.service.MeetingAssistantException;
import com.prowosma.backend.service.MeetingAssistantService.TranscriptUpload;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Everyday Meeting Assistant endpoints. Viewers are read-only (RoleGuardFilter); all data access is
 * organization-scoped and per-meeting access is enforced in the service.
 */
@RestController
@RequestMapping("/api/meeting-assistant")
@Tag(name = "Meeting Assistant", description = "Register meetings and follow their status")
@RequiredArgsConstructor
public class MeetingAssistantController {

    private final MeetingAssistantService service;

    @GetMapping("/capabilities")
    public Map<String, Object> capabilities(Authentication auth) {
        return service.capabilities(auth.getName());
    }

    @PostMapping("/validate-url")
    public Map<String, Object> validate(@RequestBody Map<String, String> body) {
        return service.validateUrl(body.get("url"));
    }

    @GetMapping("/sessions")
    public List<Map<String, Object>> list(Authentication auth) {
        return service.list(auth.getName());
    }

    @PostMapping("/sessions")
    public ResponseEntity<Map<String, Object>> create(@RequestBody CreateRequest req, Authentication auth) {
        var created = service.createSession(req, auth.getName());
        return ResponseEntity.status(HttpStatus.CREATED).body(service.get(created.getId(), auth.getName()));
    }

    @GetMapping("/sessions/{id}")
    public Map<String, Object> get(@PathVariable String id, Authentication auth) {
        return service.get(id, auth.getName());
    }

    @PostMapping("/sessions/{id}/cancel")
    public Map<String, Object> cancel(@PathVariable String id, Authentication auth) {
        return service.cancel(id, auth.getName());
    }

    @PostMapping("/sessions/{id}/retry")
    public Map<String, Object> retry(@PathVariable String id, Authentication auth) {
        return service.retry(id, auth.getName());
    }

    @PutMapping("/sessions/{id}/access")
    public Map<String, Object> access(@PathVariable String id, @RequestBody Map<String, Object> body, Authentication auth) {
        List<String> shared = body.get("sharedWith") instanceof List<?> l
                ? l.stream().map(String::valueOf).toList() : null;
        String visibility = body.get("visibility") == null ? null : String.valueOf(body.get("visibility"));
        return service.updateAccess(id, visibility, shared, auth.getName());
    }

    // ── transcripts ──────────────────────────────────────────────────────────

    /** Paste or upload: the browser sends the file's text. Requester or admin only. */
    @PostMapping("/sessions/{id}/transcript")
    public Map<String, Object> addTranscript(@PathVariable String id, @RequestBody TranscriptUpload body, Authentication auth) {
        return service.uploadTranscript(id, body, auth.getName());
    }

    @GetMapping("/sessions/{id}/transcript")
    public Map<String, Object> transcript(@PathVariable String id,
                                          @RequestParam(defaultValue = "0") int after,
                                          @RequestParam(defaultValue = "200") int limit, Authentication auth) {
        return service.getTranscript(id, after, limit, auth.getName());
    }

    @DeleteMapping("/sessions/{id}/transcript")
    public Map<String, Object> deleteTranscript(@PathVariable String id, Authentication auth) {
        return service.deleteTranscript(id, auth.getName());
    }

    /** "Check now" — imports from Google Meet immediately using the caller's own Google access. */
    @PostMapping("/sessions/{id}/fetch")
    public Map<String, Object> fetchNow(@PathVariable String id, Authentication auth) {
        return service.fetchNow(id, auth.getName());
    }

    // ── each person's own Google connection ─────────────────────────────────

    @GetMapping("/google/connection")
    public Map<String, Object> googleConnection(Authentication auth) {
        return service.googleConnection(auth.getName());
    }

    @PostMapping("/google/authorize")
    public Map<String, Object> googleAuthorize(Authentication auth) {
        return service.googleAuthorize(auth.getName());
    }

    /** Called by the app's own callback page (an authenticated request), so no public endpoint is needed. */
    @PostMapping("/google/connect")
    public Map<String, Object> googleConnect(@RequestBody Map<String, String> body, Authentication auth) {
        return service.googleComplete(body.get("code"), body.get("state"), auth.getName());
    }

    @DeleteMapping("/google/connection")
    public Map<String, Object> googleDisconnect(Authentication auth) {
        return service.googleDisconnect(auth.getName());
    }

    /** Development fixture. Returns 404 unless app.meeting-assistant.dev-fixtures-enabled=true. */
    @PostMapping("/sessions/{id}/dev/advance")
    public Map<String, Object> devAdvance(@PathVariable String id, @RequestBody Map<String, String> body, Authentication auth) {
        return service.devAdvance(id, body.get("status"), auth.getName());
    }

    @ExceptionHandler(MeetingAssistantException.class)
    public ResponseEntity<Map<String, Object>> handle(MeetingAssistantException ex) {
        Map<String, Object> out = new LinkedHashMap<>(ex.getExtras());
        out.put("error", ex.getCode());
        out.put("message", ex.getMessage());
        return ResponseEntity.status(ex.getStatus()).body(out);
    }
}

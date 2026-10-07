package com.prowosma.backend.controller;

import com.prowosma.backend.service.MeetingAssistantService;
import com.prowosma.backend.service.MeetingAssistantService.CreateRequest;
import com.prowosma.backend.service.MeetingAssistantService.MeetingAssistantException;
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
    public Map<String, Object> capabilities() {
        return service.capabilities();
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

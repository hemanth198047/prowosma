package com.prowosma.backend.controller;

import com.prowosma.backend.model.MeetingAssistantSettings;
import com.prowosma.backend.model.MeetingIntegration;
import com.prowosma.backend.service.MeetingAssistantService;
import com.prowosma.backend.service.MeetingAssistantException;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Administrator configuration. The "/api/admin/" prefix is what makes RoleGuardFilter require
 * ADMIN or OWNER for reads and writes alike — do not move these routes without re-checking that.
 */
@RestController
@RequestMapping("/api/admin/meeting-assistant")
@Tag(name = "Meeting Assistant (admin)", description = "Meeting platform connections and policies")
@RequiredArgsConstructor
public class MeetingAssistantAdminController {

    private final MeetingAssistantService service;

    @GetMapping("/settings")
    public MeetingAssistantSettings settings() {
        return service.getSettings();
    }

    @PutMapping("/settings")
    public MeetingAssistantSettings updateSettings(@RequestBody Map<String, Object> patch, Authentication auth) {
        return service.updateSettings(patch, auth.getName());
    }

    /** AI usage in tokens (not money — prices depend on the model you chose in AI Settings). */
    @GetMapping("/usage")
    public Map<String, Object> usage(@RequestParam(defaultValue = "30") int days) {
        return service.aiUsage(days);
    }

    @GetMapping("/platforms")
    public List<MeetingIntegration> platforms() {
        return service.listIntegrations();
    }

    @PutMapping("/platforms/{provider}/enabled")
    public MeetingIntegration setEnabled(@PathVariable String provider, @RequestBody Map<String, Object> body, Authentication auth) {
        return service.setEnabled(provider, Boolean.parseBoolean(String.valueOf(body.get("enabled"))), auth.getName());
    }

    @PostMapping("/platforms/{provider}/test")
    public Map<String, Object> test(@PathVariable String provider, Authentication auth) {
        return service.testConnection(provider, auth.getName());
    }

    @DeleteMapping("/platforms/{provider}")
    public MeetingIntegration disconnect(@PathVariable String provider, Authentication auth) {
        return service.disconnect(provider, auth.getName());
    }

    @ExceptionHandler(MeetingAssistantException.class)
    public ResponseEntity<Map<String, Object>> handle(MeetingAssistantException ex) {
        Map<String, Object> out = new LinkedHashMap<>(ex.getExtras());
        out.put("error", ex.getCode());
        out.put("message", ex.getMessage());
        return ResponseEntity.status(ex.getStatus()).body(out);
    }
}

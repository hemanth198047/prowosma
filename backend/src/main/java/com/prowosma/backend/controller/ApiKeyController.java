package com.prowosma.backend.controller;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.ApiKey;
import com.prowosma.backend.repository.ApiKeyRepository;
import com.prowosma.backend.service.ActivityLogService;
import io.swagger.v3.oas.annotations.tags.Tag;
import com.prowosma.backend.util.PagedResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.*;

@RestController
@RequestMapping("/api/api-keys")
@Tag(name = "API Keys", description = "Manage developer API keys")
@RequiredArgsConstructor
public class ApiKeyController {

    private final ApiKeyRepository apiKeyRepository;
    private final WorkspaceContext workspaceContext;
    private final org.springframework.security.crypto.password.PasswordEncoder passwordEncoder;
    private final ActivityLogService activityLogService;

    @GetMapping
    public PagedResponse<ApiKey> getAll(
            @RequestParam(defaultValue = "0")   int page,
            @RequestParam(defaultValue = "100") int size) {
        List<ApiKey> keys = apiKeyRepository.findByOrganizationId(workspaceContext.getWorkspaceId());
        keys.forEach(k -> k.setFullKey(null));
        return PagedResponse.ofList(keys, page, Math.min(size, 500));
    }

    @PostMapping
    public Map<String, Object> create(@RequestBody ApiKey apiKey, Authentication auth) {
        String rawKey = "pk_" + workspaceContext.getWorkspaceId().substring(0, Math.min(4, workspaceContext.getWorkspaceId().length()))
                + "_" + UUID.randomUUID().toString().replace("-", "");
        String prefix = rawKey.substring(0, Math.min(12, rawKey.length()));

        apiKey.setOrganizationId(workspaceContext.getWorkspaceId());
        apiKey.setCreatedBy(auth.getName());
        apiKey.setActive(true);
        apiKey.setKeyPrefix(prefix);
        apiKey.setKeyHash(passwordEncoder.encode(rawKey));
        apiKey.setCreatedAt(LocalDateTime.now());
        apiKey.setUpdatedAt(LocalDateTime.now());
        apiKey.setLastUsed(null);
        apiKey.setFullKey(null); // never persist plain key
        ApiKey saved = apiKeyRepository.save(apiKey);
        activityLogService.log("API_KEY", saved.getId(), saved.getName(),
                "API_KEY_CREATED", null, saved.getName(), auth.getName());

        return Map.of("id", saved.getId(), "key", rawKey, "prefix", prefix,
                "name", saved.getName() != null ? saved.getName() : "",
                "message", "Copy this key now — it will not be shown again.");
    }

    @PatchMapping("/{id}/toggle")
    public ApiKey toggle(@PathVariable String id) {
        return apiKeyRepository.findById(id).map(k -> {
            k.setActive(!k.isActive());
            k.setUpdatedAt(LocalDateTime.now());
            return apiKeyRepository.save(k);
        }).orElseThrow(() -> new RuntimeException("API key not found: " + id));
    }

    @PutMapping("/{id}")
    public ApiKey update(@PathVariable String id, @RequestBody Map<String, String> patch) {
        return apiKeyRepository.findById(id).map(k -> {
            if (patch.containsKey("name"))        k.setName(patch.get("name"));
            if (patch.containsKey("description")) k.setDescription(patch.get("description"));
            if (patch.containsKey("expiresAt") && patch.get("expiresAt") != null)
                k.setExpiresAt(LocalDateTime.parse(patch.get("expiresAt")));
            k.setUpdatedAt(LocalDateTime.now());
            return apiKeyRepository.save(k);
        }).orElseThrow(() -> new RuntimeException("API key not found: " + id));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, String>> revoke(@PathVariable String id) {
        apiKeyRepository.deleteById(id);
        return ResponseEntity.ok(Map.of("message", "API key revoked"));
    }

    @GetMapping("/scopes")
    public List<Map<String, String>> scopes() {
        return List.of(
                Map.of("scope","tasks:read",     "description","Read tasks"),
                Map.of("scope","tasks:write",    "description","Create and update tasks"),
                Map.of("scope","projects:read",  "description","Read projects"),
                Map.of("scope","projects:write", "description","Create and update projects"),
                Map.of("scope","goals:read",     "description","Read goals"),
                Map.of("scope","docs:read",      "description","Read documents"),
                Map.of("scope","docs:write",     "description","Create and update documents"),
                Map.of("scope","analytics:read", "description","Read analytics data"),
                Map.of("scope","webhooks:write", "description","Manage webhooks"),
                Map.of("scope","admin:read",     "description","Read workspace admin data"),
                Map.of("scope","workspace:read", "description","Read workspace configuration")
        );
    }
}
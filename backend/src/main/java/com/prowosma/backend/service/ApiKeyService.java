package com.prowosma.backend.service;

import com.prowosma.backend.model.ApiKey;
import com.prowosma.backend.repository.ApiKeyRepository;
import com.prowosma.backend.service.ActivityLogService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.*;

@Service
@RequiredArgsConstructor
public class ApiKeyService {

    private final ApiKeyRepository apiKeyRepository;
    private final ActivityLogService activityLogService;
    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();

    public Map<String, Object> create(ApiKey apiKey, String orgId, String createdBy) {
        // Generate raw key — returned ONCE, never stored
        String rawKey = "pk_" + UUID.randomUUID().toString().replace("-", "")
                        + UUID.randomUUID().toString().replace("-", "");
        String prefix = rawKey.substring(0, 12) + "...";

        apiKey.setOrganizationId(orgId);
        apiKey.setCreatedBy(createdBy);
        apiKey.setCreatedAt(LocalDateTime.now());
        apiKey.setKeyHash(encoder.encode(rawKey));
        apiKey.setKeyPrefix(prefix);
        apiKey.setActive(true);

        ApiKey saved = apiKeyRepository.save(apiKey);
        activityLogService.log("API_KEY", saved.getId(), saved.getName(),
                "API_KEY_CREATED", null, saved.getName(), null);

        // Return saved key + the raw key (shown once)
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id",        saved.getId());
        result.put("name",      saved.getName());
        result.put("key",       rawKey);   // ← shown once only
        result.put("keyPrefix", prefix);
        result.put("scopes",    saved.getScopes());
        result.put("createdAt", saved.getCreatedAt());
        return result;
    }

    public List<ApiKey> getAll(String orgId) {
        return apiKeyRepository.findByOrganizationId(orgId);
    }

    public ApiKey revoke(String id) {
        ApiKey key = apiKeyRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("API key not found: " + id));
        key.setActive(false);
        return apiKeyRepository.save(key);
    }

    public void delete(String id) {
        activityLogService.log("API_KEY", id, id, "DELETED", null, null, null);
        apiKeyRepository.deleteById(id);
    }
}

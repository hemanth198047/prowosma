package com.prowosma.backend.controller;

import com.prowosma.backend.config.ScimAuthFilter;
import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.ApiKey;
import com.prowosma.backend.repository.ApiKeyRepository;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * SCIM token management for admins — generate/view/revoke the bearer token
 * an identity provider (Okta, Azure AD, ...) uses to authenticate its
 * SCIM calls to /scim/v2/**. See ScimAuthFilter for where the token is
 * actually verified.
 *
 * A SCIM token is deliberately just an ApiKey tagged with the
 * "scim:provision" scope, rather than a new model/collection — it reuses
 * the exact same generation/hashing/storage code path the Developer
 * Portal's API keys already use (ApiKeyController), it just isn't listed
 * or manageable there since real IdPs only support exactly one active
 * provisioning token at a time (unlike general-purpose API keys, where
 * having several named keys is normal).
 *
 * Lives under /api/admin/ specifically so it inherits RoleGuardFilter's
 * existing ADMIN_ONLY_PATHS protection (OWNER/ADMIN only, enforced on both
 * reads and writes) with no filter changes required.
 */
@RestController
@RequestMapping("/api/admin/scim-token")
@Tag(name = "SCIM Token", description = "Manage the bearer token used by your identity provider for SCIM provisioning")
@RequiredArgsConstructor
public class ScimTokenController {

    private final ApiKeyRepository apiKeyRepository;
    private final WorkspaceContext workspaceContext;
    private final PasswordEncoder  passwordEncoder;

    @GetMapping
    public Map<String, Object> status() {
        Optional<ApiKey> existing = currentScimKey();
        if (existing.isEmpty()) {
            return Map.of("active", false);
        }
        ApiKey k = existing.get();
        return Map.of(
                "active",    k.isActive(),
                "keyPrefix", k.getKeyPrefix(),
                "createdAt", k.getCreatedAt(),
                "lastUsed",  k.getLastUsed() != null ? k.getLastUsed() : ""
        );
    }

    /**
     * Generates a new token, replacing any existing one. "Generate" always
     * means "replace" here (not "add another") because a SCIM IdP only
     * ever has one bearer token configured — this matches the "Regenerate"
     * button semantics in Okta/Azure AD's own admin consoles, so rotating
     * here is a one-step operation, not delete-then-create-then-repaste.
     */
    @PostMapping("/generate")
    public Map<String, Object> generate(Authentication auth) {
        currentScimKey().ifPresent(apiKeyRepository::delete);

        String rawToken = "scim_" + UUID.randomUUID().toString().replace("-", "")
                                   + UUID.randomUUID().toString().replace("-", "");
        String prefix = rawToken.substring(0, 12);

        ApiKey key = new ApiKey();
        key.setOrganizationId(workspaceContext.getWorkspaceId());
        key.setName("SCIM Provisioning Token");
        key.setDescription("Used by your identity provider to auto-provision and deprovision users via SCIM.");
        key.setScopes(List.of(ScimAuthFilter.SCIM_SCOPE));
        key.setActive(true);
        key.setKeyPrefix(prefix);
        key.setKeyHash(passwordEncoder.encode(rawToken));
        key.setCreatedBy(auth.getName());
        key.setCreatedAt(LocalDateTime.now());
        key.setUpdatedAt(LocalDateTime.now());
        apiKeyRepository.save(key);

        return Map.of(
                "token",      rawToken,
                "keyPrefix",  prefix,
                "scimBaseUrl", "/scim/v2",
                "message",    "Copy this token now — it will not be shown again."
        );
    }

    @DeleteMapping
    public ResponseEntity<Map<String, String>> revoke() {
        currentScimKey().ifPresent(apiKeyRepository::delete);
        return ResponseEntity.ok(Map.of("message", "SCIM token revoked. Your identity provider will no longer be able to provision users until a new token is generated and configured."));
    }

    private Optional<ApiKey> currentScimKey() {
        return apiKeyRepository.findByOrganizationId(workspaceContext.getWorkspaceId()).stream()
                .filter(k -> k.getScopes() != null && k.getScopes().contains(ScimAuthFilter.SCIM_SCOPE))
                .findFirst();
    }
}

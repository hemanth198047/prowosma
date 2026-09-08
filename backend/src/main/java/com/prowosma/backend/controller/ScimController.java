package com.prowosma.backend.controller;

import com.prowosma.backend.model.User;
import com.prowosma.backend.repository.UserRepository;
import com.prowosma.backend.repository.WorkspaceRepository;
import com.prowosma.backend.config.WorkspaceContext;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.*;

/**
 * C-2: SCIM 2.0 Provisioning
 * Implements SCIM 2.0 endpoints for auto user create/update/deactivate from Okta, Azure AD, etc.
 * Endpoint base: /scim/v2/Users
 */
@RestController
@RequestMapping("/scim/v2")
@Tag(name = "SCIM 2.0", description = "System for Cross-domain Identity Management")
@RequiredArgsConstructor
public class ScimController {

    private final UserRepository     userRepository;
    private final WorkspaceContext   workspaceContext;
    private final PasswordEncoder    passwordEncoder;

    // ── SCIM Users ────────────────────────────────────────────

    @GetMapping("/Users")
    @Operation(summary = "List users (SCIM)")
    public Map<String, Object> listUsers(
            @RequestParam(defaultValue = "1")   int startIndex,
            @RequestParam(defaultValue = "20")  int count,
            @RequestParam(required = false)     String filter) {

        // Scoped to the calling token's workspace (see ScimAuthFilter) —
        // this used to be userRepository.findAll(), which returned every
        // user across every tenant to any caller, since nothing upstream
        // authenticated or scoped the request at all.
        List<User> all = userRepository.findByOrganizationId(workspaceContext.getWorkspaceId());

        // Basic filter: userName eq "email"
        if (filter != null && filter.contains("userName eq")) {
            String email = filter.replaceAll(".*userName eq \"?([^\"]+)\"?.*", "$1").trim();
            all = all.stream().filter(u -> email.equalsIgnoreCase(u.getEmail())).toList();
        }

        int total = all.size();
        List<User> page = all.stream()
            .skip(Math.max(0, startIndex - 1))
            .limit(count).toList();

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("schemas",      List.of("urn:ietf:params:scim:api:messages:2.0:ListResponse"));
        result.put("totalResults", total);
        result.put("startIndex",   startIndex);
        result.put("itemsPerPage", count);
        result.put("Resources",    page.stream().map(this::toScimUser).toList());
        return result;
    }

    @GetMapping("/Users/{id}")
    @Operation(summary = "Get user by ID (SCIM)")
    public ResponseEntity<Map<String, Object>> getUser(@PathVariable String id) {
        return userRepository.findById(id)
            .filter(this::belongsToCallingWorkspace)
            .map(u -> ResponseEntity.ok(toScimUser(u)))
            .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping("/Users")
    @Operation(summary = "Create user via SCIM (auto-provision)")
    public ResponseEntity<Map<String, Object>> createUser(@RequestBody Map<String, Object> body) {
        String email = extractEmail(body);
        if (email == null) return ResponseEntity.badRequest().build();

        // Idempotent: return existing if already exists IN THIS WORKSPACE.
        // (An email matching a user in a *different* workspace is a
        // different account as far as SCIM provisioning for this tenant
        // is concerned — falling through to create a new record, scoped to
        // this workspace, is correct rather than returning someone else's
        // account.)
        Optional<User> existing = userRepository.findByEmail(email)
                .filter(this::belongsToCallingWorkspace);
        if (existing.isPresent()) {
            return ResponseEntity.ok(toScimUser(existing.get()));
        }

        User user = new User();
        user.setOrganizationId(workspaceContext.getWorkspaceId());
        user.setEmail(email);
        user.setName(extractName(body));
        user.setPassword(passwordEncoder.encode(UUID.randomUUID().toString())); // random password
        user.setRole("MEMBER");
        user.setCreatedAt(LocalDateTime.now());
        user = userRepository.save(user);
        return ResponseEntity.status(201).body(toScimUser(user));
    }

    @PutMapping("/Users/{id}")
    @Operation(summary = "Replace user (SCIM)")
    public ResponseEntity<Map<String, Object>> replaceUser(@PathVariable String id,
                                                           @RequestBody Map<String, Object> body) {
        return userRepository.findById(id)
            .filter(this::belongsToCallingWorkspace)
            .map(user -> {
                user.setName(extractName(body));
                // active=false → soft-deactivate (could set a flag in future)
                boolean active = (Boolean) body.getOrDefault("active", true);
                if (!active) user.setRole("DEACTIVATED");
                return ResponseEntity.ok(toScimUser(userRepository.save(user)));
            }).orElse(ResponseEntity.notFound().build());
    }

    @PatchMapping("/Users/{id}")
    @Operation(summary = "Update user attributes (SCIM)")
    public ResponseEntity<Map<String, Object>> patchUser(@PathVariable String id,
                                                         @RequestBody Map<String, Object> body) {
        return userRepository.findById(id)
            .filter(this::belongsToCallingWorkspace)
            .map(user -> {
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> ops = (List<Map<String, Object>>) body.get("Operations");
                if (ops != null) {
                    for (Map<String, Object> op : ops) {
                        String opType = (String) op.get("op");
                        String path   = (String) op.getOrDefault("path", "");
                        Object val    = op.get("value");
                        if ("Replace".equalsIgnoreCase(opType) || "Add".equalsIgnoreCase(opType)) {
                            if ("active".equals(path) && val instanceof Boolean) {
                                if (!(Boolean)val) user.setRole("DEACTIVATED");
                            }
                            if ("displayName".equals(path) && val instanceof String) {
                                user.setName((String) val);
                            }
                        }
                    }
                }
                return ResponseEntity.ok(toScimUser(userRepository.save(user)));
            }).orElse(ResponseEntity.notFound().build());
    }

    @DeleteMapping("/Users/{id}")
    @Operation(summary = "Deactivate user (SCIM)")
    public ResponseEntity<Void> deleteUser(@PathVariable String id) {
        userRepository.findById(id)
            .filter(this::belongsToCallingWorkspace)
            .ifPresent(u -> {
                u.setRole("DEACTIVATED");
                userRepository.save(u);
            });
        return ResponseEntity.noContent().build();
    }

    // ── SCIM ServiceProviderConfig ────────────────────────────

    @GetMapping("/ServiceProviderConfig")
    @Operation(summary = "SCIM service provider configuration")
    public Map<String, Object> serviceProviderConfig() {
        return Map.of(
            "schemas",       List.of("urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"),
            "patch",         Map.of("supported", true),
            "bulk",          Map.of("supported", false, "maxOperations", 0, "maxPayloadSize", 0),
            "filter",        Map.of("supported", true, "maxResults", 200),
            "changePassword",Map.of("supported", false),
            "sort",          Map.of("supported", false),
            "etag",          Map.of("supported", false),
            "authenticationSchemes", List.of(Map.of(
                "name", "OAuth Bearer Token", "type", "oauthbearertoken",
                "description", "Authentication scheme using the OAuth Bearer Token Standard"))
        );
    }

    // ── Helpers ───────────────────────────────────────────────

    /** Every per-resource SCIM operation (get/replace/patch/delete by id) must check this — MongoDB's findById has no concept of tenant, so without this a caller from workspace A could act on workspace B's user just by guessing/enumerating a valid Mongo ObjectId. */
    private boolean belongsToCallingWorkspace(User u) {
        return workspaceContext.getWorkspaceId() != null
                && workspaceContext.getWorkspaceId().equals(u.getOrganizationId());
    }

    private Map<String, Object> toScimUser(User u) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("schemas",    List.of("urn:ietf:params:scim:schemas:core:2.0:User"));
        r.put("id",         u.getId());
        r.put("userName",   u.getEmail());
        r.put("displayName",u.getName());
        r.put("active",     !"DEACTIVATED".equals(u.getRole()));
        r.put("emails",     List.of(Map.of("value", u.getEmail(), "primary", true)));
        r.put("meta",       Map.of("resourceType", "User",
            "created",  u.getCreatedAt() != null ? u.getCreatedAt().toString() : ""));
        return r;
    }

    private String extractEmail(Map<String, Object> body) {
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> emails = (List<Map<String, Object>>) body.get("emails");
        if (emails != null && !emails.isEmpty())
            return (String) emails.get(0).get("value");
        return (String) body.get("userName");
    }

    private String extractName(Map<String, Object> body) {
        String display = (String) body.get("displayName");
        if (display != null) return display;
        @SuppressWarnings("unchecked")
        Map<String, String> name = (Map<String, String>) body.get("name");
        if (name != null)
            return (name.getOrDefault("givenName","") + " " + name.getOrDefault("familyName","")).trim();
        return (String) body.getOrDefault("userName", "User");
    }
}

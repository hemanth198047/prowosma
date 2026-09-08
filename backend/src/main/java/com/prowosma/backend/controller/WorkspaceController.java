package com.prowosma.backend.controller;

import com.prowosma.backend.model.TeamMember;
import com.prowosma.backend.model.Workspace;
import com.prowosma.backend.repository.TeamMemberRepository;
import com.prowosma.backend.service.WorkspaceService;
import com.prowosma.backend.repository.WorkspaceRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import java.util.Map;
import java.util.Set;
import java.util.HashMap;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

@RestController
@RequestMapping("/api/workspaces")
@RequiredArgsConstructor
public class WorkspaceController {

    private final WorkspaceService     workspaceService;
    private final WorkspaceRepository  workspaceRepository;
    private final TeamMemberRepository teamMemberRepository;

    /**
     * Returns ALL workspaces the current user has access to:
     * 1. Workspaces they OWN (ownerEmail match)
     * 2. Workspaces they are a MEMBER of (TeamMember record)
     *
     * This is the key fix for the VIEWER login problem.
     */
    @GetMapping
    public ResponseEntity<?> getMyWorkspaces(Authentication auth) {
        // Return empty list for unauthenticated requests (no token yet)
        if (auth == null || !auth.isAuthenticated() ||
                "anonymousUser".equals(auth.getName())) {
            return ResponseEntity.ok(java.util.List.of());
        }
        String email = auth.getName();
        List<Workspace> result = new ArrayList<>();

        // 1. Workspaces this user owns — case-insensitive email match
        //    (handles cases where ownerEmail was stored with different casing)
        List<Workspace> owned = workspaceRepository.findByOwnerEmailIgnoreCase(email);
        result.addAll(owned);

        // 2. Workspaces this user is a member of (invited/added)
        //    Search by both exact email and lowercase to handle data inconsistencies
        Set<String> emailVariants = new java.util.HashSet<>();
        emailVariants.add(email);
        emailVariants.add(email.toLowerCase());
        emailVariants.add(email.toUpperCase());

        Set<String> addedIds = result.stream()
                .map(Workspace::getId).collect(java.util.stream.Collectors.toSet());

        for (String emailVariant : emailVariants) {
            List<TeamMember> memberships = teamMemberRepository.findAllByEmail(emailVariant);
            for (TeamMember membership : memberships) {
                String orgId = membership.getOrganizationId();
                if (orgId != null && !addedIds.contains(orgId)) {
                    try {
                        Workspace ws = workspaceService.getById(orgId);
                        if (!addedIds.contains(ws.getId())) {
                            result.add(ws);
                            addedIds.add(ws.getId());
                        }
                    } catch (Exception ignored) {
                        // Workspace may have been deleted
                    }
                }
            }
        }
        // Return slim projection — exclude large fields like base64 logoUrl
        // Full workspace details are fetched separately when needed (/api/workspaces/{id})
        java.util.List<Map<String, Object>> slim = result.stream().map(ws -> {
            Map<String, Object> m = new HashMap<>();
            m.put("id",         ws.getId());
            m.put("name",       ws.getName());
            m.put("ownerEmail", ws.getOwnerEmail());
            m.put("currency",   ws.getCurrency());
            m.put("dateFormat", ws.getDateFormat());
            // Only include logoUrl if it's a real URL (not base64)
            String logo = ws.getLogoUrl();
            if (logo != null && !logo.startsWith("data:")) {
                m.put("logoUrl", logo);
            }
            // Resolved role for THIS user in THIS workspace — owner check
            // first (mirrors RoleGuardFilter.resolveRole()'s precedence),
            // then the TeamMember record. Lets the frontend show "you are
            // Owner/Admin/Member/Viewer here" right on the workspace list
            // (e.g. right after login) without a separate call per workspace.
            if (ws.getOwnerEmail() != null && ws.getOwnerEmail().equalsIgnoreCase(email)) {
                m.put("role", "OWNER");
            } else {
                String role = teamMemberRepository.findAllByEmailAndOrganizationId(email, ws.getId())
                        .stream().findFirst().map(TeamMember::getRole).orElse(null);
                if (role == null) {
                    role = teamMemberRepository.findAllByEmailAndOrganizationId(email.toLowerCase(), ws.getId())
                            .stream().findFirst().map(TeamMember::getRole).orElse(null);
                }
                m.put("role", role);
            }
            return m;
        }).collect(java.util.stream.Collectors.toList());
        return ResponseEntity.ok(slim);
    }

    @GetMapping("/{id}")
    public Workspace getById(@PathVariable String id) {
        return workspaceService.getById(id);
    }

    @GetMapping("/org/{organizationId}")
    public List<Workspace> getByOrganizationId(
            @PathVariable String organizationId) {
        return workspaceService.getByOrganizationId(organizationId);
    }

    @PostMapping
    public ResponseEntity<?> create(@RequestBody Workspace workspace,
                                    Authentication auth) {
        if (auth == null || !auth.isAuthenticated() ||
                "anonymousUser".equals(auth.getName())) {
            return ResponseEntity.status(401).body("Authentication required");
        }
        return ResponseEntity.ok(workspaceService.create(workspace, auth.getName()));
    }

    @PutMapping("/{id}")
    public Workspace update(@PathVariable String id,
                            @RequestBody Workspace workspace,
                            Authentication auth) {
        if (auth == null || !auth.isAuthenticated() ||
                "anonymousUser".equals(auth.getName())) {
            throw new RuntimeException("Authentication required");
        }
        Workspace existing = workspaceService.getById(id);
        if (!existing.getOwnerEmail().equals(auth.getName())) {
            throw new RuntimeException(
                    "Only the workspace owner can update settings");
        }
        return workspaceService.update(id, workspace);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> delete(@PathVariable String id,
                                    Authentication auth) {
        // RoleGuardFilter deliberately does not reject unauthenticated
        // requests itself (that's JwtFilter's job) — it just lets them
        // through with `auth` unset, so this endpoint must not assume auth
        // is present. Without this check an anonymous DELETE NPE'd on
        // auth.getName() below and surfaced as a 500 instead of a 403.
        if (auth == null || !auth.isAuthenticated() ||
                "anonymousUser".equals(auth.getName())) {
            return ResponseEntity.status(403)
                    .body(Map.of("message",
                            "Only the workspace owner can delete this workspace"));
        }
        Workspace existing = workspaceService.getById(id);
        if (!existing.getOwnerEmail().equals(auth.getName())) {
            return ResponseEntity.status(403)
                    .body(Map.of("message",
                            "Only the workspace owner can delete this workspace"));
        }
        workspaceService.delete(id);
        return ResponseEntity.ok(Map.of("message", "Workspace deleted"));
    }

    // NOTE: the old PATCH/GET /{id}/branding endpoints that used to live here
    // were removed. They were superseded by BrandingController's
    // /api/workspaces/branding (fuller field set, no {id} segment needed
    // since it always operates on the active workspace) and nothing in the
    // frontend called them anymore. Keeping both around meant PlanGuardFilter
    // only gated one of two ways to write branding data — a real bypass.
    // Now there is exactly one branding endpoint, and it's gated (see
    // PlanGuardFilter and BrandingController).

}
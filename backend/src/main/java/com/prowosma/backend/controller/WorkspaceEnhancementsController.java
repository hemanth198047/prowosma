package com.prowosma.backend.controller;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.*;
import com.prowosma.backend.repository.*;
import com.prowosma.backend.util.PagedResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Workspace enhancements:
 * - Parent/child orgs, templates, cloning, cross-workspace access
 * - Business calendar (working days, holidays, fiscal year)
 * - User groups and fine-grained permissions
 * - Guest/external access management
 */
@RestController
@RequestMapping("/api/workspace")
@RequiredArgsConstructor
public class WorkspaceEnhancementsController {

    private final WorkspaceRepository  workspaceRepo;
    private final UserGroupRepository  groupRepo;
    private final UserRepository       userRepo;
    private final ProjectRepository    projectRepo;
    private final TaskRepository       taskRepo;
    private final WorkspaceContext     ws;

    // ── Workspace templates ──────────────────────────────────────
    @GetMapping("/templates")
    public List<Workspace> listTemplates() {
        // Safety cap: only fetch first 500 workspaces for template listing
        return workspaceRepo.findAll(
            org.springframework.data.domain.PageRequest.of(0, 500)).stream()
            .filter(Workspace::isTemplate).collect(Collectors.toList());
    }

    @PostMapping("/templates")
    public Workspace createTemplate(@RequestBody Workspace w, Authentication auth) {
        w.setTemplate(true);
        w.setOwnerEmail(auth.getName());
        w.setCreatedAt(LocalDateTime.now());
        w.setUpdatedAt(LocalDateTime.now());
        return workspaceRepo.save(w);
    }

    // ── Workspace cloning ────────────────────────────────────────
    @PostMapping("/{id}/clone")
    public Workspace clone(@PathVariable String id,
                           @RequestBody Map<String, String> body, Authentication auth) {
        Workspace source = workspaceRepo.findById(id).orElseThrow();
        Workspace copy   = new Workspace();
        copy.setName(body.getOrDefault("name", source.getName() + " (Copy)"));
        copy.setOrganizationId(ws.getWorkspaceId());
        copy.setOwnerEmail(auth.getName());
        copy.setTimezone(source.getTimezone());
        copy.setDateFormat(source.getDateFormat());
        copy.setLanguage(source.getLanguage());
        copy.setLocale(source.getLocale());
        copy.setWorkingDays(source.getWorkingDays());
        copy.setHolidays(source.getHolidays());
        copy.setFiscalYearStart(source.getFiscalYearStart());
        copy.setTemplateId(source.isTemplate() ? source.getId() : source.getTemplateId());
        copy.setCreatedAt(LocalDateTime.now());
        copy.setUpdatedAt(LocalDateTime.now());

        // Clone projects if requested
        if ("true".equals(body.get("includeProjects"))) {
            projectRepo.findByOrganizationId(source.getOrganizationId(), org.springframework.data.domain.PageRequest.of(0, 500)).getContent().forEach(p -> {
                Project np = new Project();
                np.setName(p.getName()); np.setDescription(p.getDescription());
                np.setOrganizationId(ws.getWorkspaceId());
                np.setStatus("ACTIVE"); np.setColor(p.getColor());
                np.setCreatedAt(LocalDateTime.now()); np.setUpdatedAt(LocalDateTime.now());
                projectRepo.save(np);
            });
        }
        return workspaceRepo.save(copy);
    }

    // ── Parent-child org hierarchy ───────────────────────────────
    @GetMapping("/hierarchy")
    public Map<String, Object> getOrgHierarchy() {
        String orgId    = ws.getWorkspaceId();
        List<Workspace> all = workspaceRepo.findAll(org.springframework.data.domain.PageRequest.of(0, 500)).stream()
            .filter(w -> orgId.equals(w.getOrganizationId())
                || orgId.equals(w.getParentOrganizationId()))
            .collect(Collectors.toList());

        List<Map<String, Object>> roots = new ArrayList<>();
        all.forEach(w -> {
            if (w.getParentOrganizationId() == null) {
                Map<String, Object> node = new LinkedHashMap<>();
                node.put("id", w.getId()); node.put("name", w.getName());
                node.put("tenantType", w.getTenantType());
                List<Map<String, Object>> children = all.stream()
                    .filter(c -> w.getId().equals(c.getParentOrganizationId()))
                    .map(c -> Map.<String,Object>of("id",c.getId(),"name",c.getName()))
                    .collect(Collectors.toList());
                node.put("children", children);
                roots.add(node);
            }
        });
        return Map.of("hierarchy", roots, "totalWorkspaces", all.size());
    }

    @PatchMapping("/{id}/parent")
    public Workspace setParent(@PathVariable String id, @RequestBody Map<String,String> body) {
        return workspaceRepo.findById(id).map(w -> {
            w.setParentOrganizationId(body.get("parentOrganizationId"));
            w.setTenantType(body.getOrDefault("tenantType", w.getTenantType()));
            w.setUpdatedAt(LocalDateTime.now());
            return workspaceRepo.save(w);
        }).orElseThrow();
    }

    // ── Business calendar ────────────────────────────────────────
    @GetMapping("/{id}/calendar")
    public Map<String, Object> getCalendar(@PathVariable String id) {
        Workspace w = workspaceRepo.findById(id).orElseThrow();
        return Map.of("workingDays", w.getWorkingDays() != null ? w.getWorkingDays() : List.of("MON","TUE","WED","THU","FRI"),
            "holidays", w.getHolidays() != null ? w.getHolidays() : List.of(),
            "fiscalYearStart", w.getFiscalYearStart() != null ? w.getFiscalYearStart() : "01-01");
    }

    @PatchMapping("/{id}/calendar")
    public Workspace updateCalendar(@PathVariable String id, @RequestBody Map<String, Object> body) {
        return workspaceRepo.findById(id).map(w -> {
            if (body.containsKey("workingDays"))    w.setWorkingDays(castList(body.get("workingDays")));
            if (body.containsKey("fiscalYearStart"))w.setFiscalYearStart((String)body.get("fiscalYearStart"));
            w.setUpdatedAt(LocalDateTime.now());
            return workspaceRepo.save(w);
        }).orElseThrow();
    }

    @PostMapping("/{id}/holidays")
    public Workspace addHoliday(@PathVariable String id, @RequestBody Workspace.HolidayEntry holiday) {
        return workspaceRepo.findById(id).map(w -> {
            if (w.getHolidays() == null) w.setHolidays(new ArrayList<>());
            w.getHolidays().add(holiday);
            w.setUpdatedAt(LocalDateTime.now());
            return workspaceRepo.save(w);
        }).orElseThrow();
    }

    @DeleteMapping("/{id}/holidays/{hid}")
    public Workspace removeHoliday(@PathVariable String id, @PathVariable String hid) {
        return workspaceRepo.findById(id).map(w -> {
            if (w.getHolidays() != null)
                w.setHolidays(w.getHolidays().stream().filter(h -> !hid.equals(h.getId())).collect(Collectors.toList()));
            w.setUpdatedAt(LocalDateTime.now());
            return workspaceRepo.save(w);
        }).orElseThrow();
    }

    // ── Cross-workspace access ───────────────────────────────────
    @GetMapping("/{id}/cross-access")
    public List<String> getCrossAccess(@PathVariable String id) {
        java.util.Optional<Workspace> opt = workspaceRepo.findById(id);
        if (opt.isEmpty()) return new ArrayList<>();
        List<String> ids = opt.get().getAllowedCrossWorkspaceIds();
        return ids != null ? ids : new ArrayList<>();
    }

    @PostMapping("/{id}/cross-access")
    public Workspace addCrossAccess(@PathVariable String id, @RequestBody Map<String, String> body) {
        return workspaceRepo.findById(id).map(w -> {
            String targetId = body.get("workspaceId");
            if (w.getAllowedCrossWorkspaceIds() == null) w.setAllowedCrossWorkspaceIds(new ArrayList<>());
            if (!w.getAllowedCrossWorkspaceIds().contains(targetId))
                w.getAllowedCrossWorkspaceIds().add(targetId);
            w.setUpdatedAt(LocalDateTime.now());
            return workspaceRepo.save(w);
        }).orElseThrow();
    }

    // ── User groups ──────────────────────────────────────────────
    @GetMapping("/groups")
    public PagedResponse<UserGroup> getGroups(
            @RequestParam(defaultValue = "0")  int page,
            @RequestParam(defaultValue = "100") int size) {
        return PagedResponse.ofList(groupRepo.findByOrganizationId(ws.getWorkspaceId()), page, Math.min(size, 500));
    }

    @PostMapping("/groups")
    public UserGroup createGroup(@RequestBody UserGroup g, Authentication auth) {
        g.setOrganizationId(ws.getWorkspaceId());
        g.setCreatedBy(auth.getName());
        g.setCreatedAt(LocalDateTime.now()); g.setUpdatedAt(LocalDateTime.now());
        return groupRepo.save(g);
    }

    @PutMapping("/groups/{id}")
    public UserGroup updateGroup(@PathVariable String id, @RequestBody UserGroup patch) {
        return groupRepo.findById(id).map(g -> {
            if (patch.getName()         != null) g.setName(patch.getName());
            if (patch.getDescription()  != null) g.setDescription(patch.getDescription());
            if (patch.getMemberEmails() != null) g.setMemberEmails(patch.getMemberEmails());
            if (patch.getPermissions()  != null) g.setPermissions(patch.getPermissions());
            g.setUpdatedAt(LocalDateTime.now());
            return groupRepo.save(g);
        }).orElseThrow();
    }

    @PostMapping("/groups/{id}/members")
    public UserGroup addMember(@PathVariable String id, @RequestBody Map<String, String> body) {
        return groupRepo.findById(id).map(g -> {
            String email = body.get("email");
            if (!g.getMemberEmails().contains(email)) g.getMemberEmails().add(email);
            // Also add group to user
            userRepo.findByEmail(email).ifPresent(u -> {
                if (!u.getGroupIds().contains(id)) { u.getGroupIds().add(id); userRepo.save(u); }
            });
            return groupRepo.save(g);
        }).orElseThrow();
    }

    @DeleteMapping("/groups/{id}")
    public ResponseEntity<Map<String,String>> deleteGroup(@PathVariable String id) {
        groupRepo.deleteById(id);
        return ResponseEntity.ok(Map.of("message","Deleted"));
    }

    // ── Guest / external access ──────────────────────────────────
    @PostMapping("/guest-invite")
    public Map<String, Object> inviteGuest(@RequestBody Map<String, String> body, Authentication auth) {
        String email = body.get("email");
        String token = java.util.UUID.randomUUID().toString().replace("-","");
        userRepo.findByEmail(email).ifPresentOrElse(u -> {
            u.setGuest(true);
            u.setGuestToken(token);
            u.setGuestTokenExpiry(LocalDateTime.now().plusDays(30));
            userRepo.save(u);
        }, () -> {
            User guest = new User();
            guest.setEmail(email);
            guest.setName(body.getOrDefault("name", email));
            guest.setOrganizationId(ws.getWorkspaceId());
            guest.setGuest(true);
            guest.setGuestToken(token);
            guest.setGuestTokenExpiry(LocalDateTime.now().plusDays(30));
            guest.setRole("VIEWER");
            userRepo.save(guest);
        });
        return Map.of("token", token, "email", email, "expiresIn", "30 days",
            "accessUrl", "/guest-access?token=" + token);
    }

    // ── Fine-grained permissions ─────────────────────────────────
    @GetMapping("/permissions/matrix")
    public Map<String, Object> getPermissionMatrix() {
        return Map.of("roles", Map.of(
            "OWNER",  List.of("ALL"),
            "ADMIN",  List.of("CREATE_PROJECT","DELETE_PROJECT","INVITE_MEMBER","MANAGE_TEAM","VIEW_ALL","EDIT_ALL","CREATE_TASK","DELETE_TASK","MANAGE_GOALS"),
            "MEMBER", List.of("VIEW_ALL","CREATE_TASK","EDIT_OWN","COMMENT","CREATE_DOC"),
            "VIEWER", List.of("VIEW_ALL","COMMENT"),
            "GUEST",  List.of("VIEW_ASSIGNED")
        ), "customPermissions", List.of(
            "VIEW_ALL","VIEW_ASSIGNED","CREATE_PROJECT","DELETE_PROJECT","EDIT_ALL",
            "EDIT_OWN","CREATE_TASK","DELETE_TASK","INVITE_MEMBER","MANAGE_TEAM",
            "MANAGE_GOALS","CREATE_DOC","DELETE_DOC","MANAGE_AUTOMATION","VIEW_ANALYTICS"
        ));
    }

    @PatchMapping("/members/{email}/permissions")
    public ResponseEntity<?> updateUserPermissions(@PathVariable String email,
                                                    @RequestBody Map<String, Object> body) {
        return userRepo.findByEmail(email).map(u -> {
            if (body.containsKey("permissions")) u.setPermissions(castList(body.get("permissions")));
            if (body.containsKey("entityPermissions"))
                u.setEntityPermissions((Map<String,String>)body.get("entityPermissions"));
            userRepo.save(u);
            return ResponseEntity.ok(Map.of("email", email, "updated", true));
        }).orElse(ResponseEntity.notFound().build());
    }

    @SuppressWarnings("unchecked")
    private List<String> castList(Object o) {
        return o instanceof List ? (List<String>) o : new ArrayList<>();
    }
}

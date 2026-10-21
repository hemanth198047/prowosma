package com.prowosma.backend.controller;

import com.prowosma.backend.model.AccessProfile;
import com.prowosma.backend.model.UserGroup;
import com.prowosma.backend.service.AccessAdminService;
import com.prowosma.backend.service.VisibilityService;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * Department / project access control.
 *
 *  GET /api/access/me             — any member: what the signed-in person may see and do.
 *  /api/admin/access/**           — workspace owner / admin only (RoleGuardFilter protects every /api/admin/ path,
 *                                   reads included): settings, profiles, departments, member assignment, org setup.
 */
@RestController
@Tag(name = "Access control", description = "Departments, access profiles and project visibility")
@RequiredArgsConstructor
public class AccessController {

    private final VisibilityService visibility;
    private final AccessAdminService admin;

    @GetMapping("/api/access/me")
    public Map<String, Object> me() { return visibility.describeCurrent(); }

    /** Department names and project roles, for the project access dialog (any member). */
    @GetMapping("/api/access/options")
    public Map<String, Object> options() { return visibility.options(); }

    // ── settings ──
    @GetMapping("/api/admin/access/settings")
    public Map<String, Object> getSettings() { return admin.getSettings(); }

    @PutMapping("/api/admin/access/settings")
    public Map<String, Object> updateSettings(@RequestBody Map<String, Object> body) { return admin.updateSettings(body); }

    // ── profiles ──
    @GetMapping("/api/admin/access/profiles")
    public List<AccessProfile> profiles() { return admin.listProfiles(); }

    @PostMapping("/api/admin/access/profiles")
    public AccessProfile createProfile(@RequestBody Map<String, Object> body, Authentication auth) { return admin.createProfile(body, auth.getName()); }

    @PutMapping("/api/admin/access/profiles/{id}")
    public AccessProfile updateProfile(@PathVariable String id, @RequestBody Map<String, Object> body) { return admin.updateProfile(id, body); }

    @DeleteMapping("/api/admin/access/profiles/{id}")
    public ResponseEntity<Map<String, String>> deleteProfile(@PathVariable String id) {
        admin.deleteProfile(id);
        return ResponseEntity.ok(Map.of("message", "Access profile deleted"));
    }

    // ── departments ──
    @GetMapping("/api/admin/access/departments")
    public List<UserGroup> departments() { return admin.listDepartments(); }

    @PostMapping("/api/admin/access/departments")
    public UserGroup createDepartment(@RequestBody Map<String, Object> body, Authentication auth) { return admin.createDepartment(body, auth.getName()); }

    @PutMapping("/api/admin/access/departments/{id}")
    public UserGroup updateDepartment(@PathVariable String id, @RequestBody Map<String, Object> body) { return admin.updateDepartment(id, body); }

    @PutMapping("/api/admin/access/departments/{id}/members")
    @SuppressWarnings("unchecked")
    public UserGroup setDepartmentMembers(@PathVariable String id, @RequestBody Map<String, Object> body) {
        return admin.setDepartmentMembers(id, (List<String>) body.get("emails"));
    }

    @DeleteMapping("/api/admin/access/departments/{id}")
    public ResponseEntity<Map<String, String>> deleteDepartment(@PathVariable String id) {
        admin.deleteDepartment(id);
        return ResponseEntity.ok(Map.of("message", "Department deleted"));
    }

    // ── who has which profile ──
    @GetMapping("/api/admin/access/members")
    public List<Map<String, Object>> members() { return admin.listMembers(); }

    @PutMapping("/api/admin/access/members/{id}")
    public Map<String, Object> updateMember(@PathVariable String id, @RequestBody Map<String, Object> body) { return admin.updateMember(id, body); }

    // ── organisation setup ──
    @PostMapping("/api/admin/access/org-setup")
    public Map<String, Object> orgSetup(@RequestBody Map<String, Object> plan,
                                        @RequestParam(defaultValue = "true") boolean dryRun,
                                        @RequestParam(defaultValue = "false") boolean sendInvitations,
                                        Authentication auth) {
        return admin.orgSetup(plan, dryRun, sendInvitations, auth.getName());
    }
}

package com.prowosma.backend.controller;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.UserGroup;
import com.prowosma.backend.repository.UserGroupRepository;
import io.swagger.v3.oas.annotations.tags.Tag;
import com.prowosma.backend.util.PagedResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.*;

@RestController
@RequestMapping("/api/user-groups")
@Tag(name = "User Groups", description = "Manage user groups for bulk permissions")
@RequiredArgsConstructor
public class UserGroupController {

    private final UserGroupRepository userGroupRepository;
    private final WorkspaceContext    workspaceContext;

    @GetMapping
    public PagedResponse<UserGroup> getAll(
            @RequestParam(defaultValue = "0")   int page,
            @RequestParam(defaultValue = "100") int size) {
        var items = userGroupRepository.findByOrganizationId(workspaceContext.getWorkspaceId());
        return PagedResponse.ofList(items, page, Math.min(size, 500));
    }

    @GetMapping("/{id}")
    public UserGroup getById(@PathVariable String id) {
        return userGroupRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("User group not found: " + id));
    }

    @PostMapping
    public UserGroup create(@RequestBody UserGroup group, Authentication auth) {
        group.setOrganizationId(workspaceContext.getWorkspaceId());
        group.setCreatedBy(auth.getName());
        group.setCreatedAt(LocalDateTime.now());
        group.setUpdatedAt(LocalDateTime.now());
        if (group.getMemberEmails()  == null) group.setMemberEmails(new ArrayList<>());
        if (group.getPermissions()   == null) group.setPermissions(new ArrayList<>());
        return userGroupRepository.save(group);
    }

    @PutMapping("/{id}")
    public UserGroup update(@PathVariable String id, @RequestBody Map<String, Object> patch) {
        return userGroupRepository.findById(id).map(g -> {
            if (patch.containsKey("name"))        g.setName((String) patch.get("name"));
            if (patch.containsKey("description")) g.setDescription((String) patch.get("description"));
            if (patch.containsKey("color"))       g.setColor((String) patch.get("color"));
            @SuppressWarnings("unchecked")
            List<String> perms = (List<String>) patch.get("permissions");
            if (perms != null) g.setPermissions(perms);
            g.setUpdatedAt(LocalDateTime.now());
            return userGroupRepository.save(g);
        }).orElseThrow(() -> new RuntimeException("User group not found: " + id));
    }

    @PostMapping("/{id}/members")
    public UserGroup addMember(@PathVariable String id, @RequestBody Map<String, String> body) {
        return userGroupRepository.findById(id).map(g -> {
            String email = body.getOrDefault("email", body.get("memberId"));
            if (g.getMemberEmails() == null) g.setMemberEmails(new ArrayList<>());
            if (email != null && !g.getMemberEmails().contains(email)) g.getMemberEmails().add(email);
            g.setUpdatedAt(LocalDateTime.now());
            return userGroupRepository.save(g);
        }).orElseThrow(() -> new RuntimeException("User group not found: " + id));
    }

    @DeleteMapping("/{id}/members/{email}")
    public UserGroup removeMember(@PathVariable String id, @PathVariable String email) {
        return userGroupRepository.findById(id).map(g -> {
            if (g.getMemberEmails() != null) g.getMemberEmails().remove(email);
            g.setUpdatedAt(LocalDateTime.now());
            return userGroupRepository.save(g);
        }).orElseThrow(() -> new RuntimeException("User group not found: " + id));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, String>> delete(@PathVariable String id) {
        userGroupRepository.deleteById(id);
        return ResponseEntity.ok(Map.of("message", "User group deleted"));
    }
}

package com.prowosma.backend.controller;

import com.prowosma.backend.model.TeamMember;
import com.prowosma.backend.repository.TeamMemberRepository;
import com.prowosma.backend.service.TeamMemberService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/team")
@RequiredArgsConstructor
public class TeamMemberController {

    private final TeamMemberService    teamMemberService;
    private final TeamMemberRepository teamMemberRepository;

    @GetMapping
    public List<TeamMember> getAll() {
        return teamMemberService.getAll();
    }

    // F04 — resolve current user's role by email, scoped to active workspace
    @GetMapping("/by-email")
    public ResponseEntity<?> getByEmail(
            @RequestParam String email,
            @RequestParam(required = false) String workspaceId) {
        // workspaceId passed explicitly → bypass WorkspaceContext (handles initial load race)
        if (workspaceId != null && !workspaceId.isBlank()) {
            return teamMemberRepository.findByEmailAndOrganizationId(email, workspaceId)
                    .map(ResponseEntity::ok)
                    .orElse(ResponseEntity.notFound().build());
        }
        return teamMemberService.getByEmail(email)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping
    public ResponseEntity<?> create(@RequestBody TeamMember member, Authentication auth) {
        try {
            String requester = auth != null ? auth.getName() : null;
            return ResponseEntity.ok(teamMemberService.create(member, requester));
        } catch (RuntimeException e) {
            // Seat-limit rejections (and the existing "email already exists"
            // check) both land here — 402 for the former reads correctly in
            // the UI, and message text still distinguishes the two cases.
            // Role-escalation rejections (see TeamMemberService.assertCanAssignRole)
            // land here too and read correctly as 403.
            String msg = e.getMessage() != null ? e.getMessage() : "";
            org.springframework.http.HttpStatus status = msg.toLowerCase().contains("seat limit")
                    ? org.springframework.http.HttpStatus.PAYMENT_REQUIRED
                    : msg.contains("Only the workspace Manager")
                    ? org.springframework.http.HttpStatus.FORBIDDEN
                    : org.springframework.http.HttpStatus.BAD_REQUEST;
            return ResponseEntity.status(status).body(Map.of("error", e.getMessage()));
        }
    }

    @PutMapping("/{id}")
    public ResponseEntity<?> update(@PathVariable String id, @RequestBody TeamMember member, Authentication auth) {
        try {
            String requester = auth != null ? auth.getName() : null;
            return ResponseEntity.ok(teamMemberService.update(id, member, requester));
        } catch (RuntimeException e) {
            String msg = e.getMessage() != null ? e.getMessage() : "";
            org.springframework.http.HttpStatus status = msg.contains("Only the workspace Manager")
                    ? org.springframework.http.HttpStatus.FORBIDDEN
                    : org.springframework.http.HttpStatus.BAD_REQUEST;
            return ResponseEntity.status(status).body(Map.of("error", e.getMessage()));
        }
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> delete(@PathVariable String id) {
        teamMemberService.delete(id);
        return ResponseEntity.ok(Map.of("message", "Member removed"));
    }

    // ── Presence tracking ─────────────────────────────────────────
    private static final java.util.concurrent.ConcurrentHashMap<String, Long>
        lastSeen = new java.util.concurrent.ConcurrentHashMap<>();

    @PostMapping("/presence/ping")
    public ResponseEntity<?> ping(org.springframework.security.core.Authentication auth) {
        if (auth != null) lastSeen.put(auth.getName(), System.currentTimeMillis());
        return ResponseEntity.ok(Map.of("ok", true));
    }

    @GetMapping("/presence")
    public Map<String, Object> getPresence() {
        long threshold = System.currentTimeMillis() - (5 * 60 * 1000);
        List<String> online = lastSeen.entrySet().stream()
            .filter(e -> e.getValue() > threshold)
            .map(java.util.Map.Entry::getKey)
            .collect(java.util.stream.Collectors.toList());
        return Map.of("online", online);
    }
}

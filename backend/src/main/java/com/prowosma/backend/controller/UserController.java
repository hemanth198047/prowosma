package com.prowosma.backend.controller;

import com.prowosma.backend.repository.UserRepository;
import com.prowosma.backend.service.ActivityLogService;
import com.prowosma.backend.service.AuthService;
import com.prowosma.backend.service.UserDeletionService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api/users")
@RequiredArgsConstructor
public class UserController {

    private final AuthService authService;
    private final UserDeletionService userDeletionService;
    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final ActivityLogService activityLogService;

    // Get current user profile
    @GetMapping("/me")
    public ResponseEntity<?> getProfile(Authentication auth) {
        return ResponseEntity.ok(authService.getProfile(auth.getName()));
    }

    /**
     * Delete the currently logged-in user and ALL their data.
     * Requires password confirmation for safety.
     *
     * Body: { "password": "current-password", "confirmation": "DELETE MY ACCOUNT" }
     *
     * SECURITY FIX: the doc comment above and the request body's own
     * documented shape always said "password" was required, but the
     * implementation never actually checked it — only the literal
     * confirmation string. That meant anyone holding a valid JWT (e.g. a
     * leaked/stolen token, or a session left open on a shared machine)
     * could permanently delete the account and every workspace it owns
     * without knowing the account's password at all. Now actually
     * verified, matching the documented and expected behavior, using the
     * same passwordEncoder.matches(...) pattern already used for
     * change-password elsewhere in this codebase (see AuthService).
     */
    @DeleteMapping("/me")
    public ResponseEntity<?> deleteMyAccount(
            @RequestBody Map<String, String> body,
            Authentication auth) {

        String confirmation = body.get("confirmation");
        if (!"DELETE MY ACCOUNT".equals(confirmation)) {
            return ResponseEntity.badRequest()
                    .body(Map.of("message",
                            "Type 'DELETE MY ACCOUNT' exactly to confirm deletion"));
        }

        String password = body.get("password");
        var user = userRepository.findByEmail(auth.getName()).orElse(null);
        if (user == null || password == null || !passwordEncoder.matches(password, user.getPassword())) {
            activityLogService.log("USER", auth.getName(), auth.getName(),
                    "ACCOUNT_DELETION_FAILED_BAD_PASSWORD", null, null, auth.getName());
            return ResponseEntity.status(401).body(Map.of("message", "Incorrect password."));
        }

        try {
            var summary = userDeletionService.deleteUser(auth.getName());
            return ResponseEntity.ok(Map.of(
                    "success", true,
                    "message", summary.message()
            ));
        } catch (Exception e) {
            return ResponseEntity.internalServerError()
                    .body(Map.of("message", e.getMessage()));
        }
    }

    /**
     * Admin endpoint: delete any user by email.
     * Only accessible by workspace owners.
     * Body: { "email": "user@example.com" }
     */
    @DeleteMapping("/admin/delete")
    public ResponseEntity<?> deleteUserByAdmin(
            @RequestBody Map<String, String> body,
            Authentication auth) {

        String targetEmail = body.get("email");
        if (targetEmail == null || targetEmail.isBlank()) {
            return ResponseEntity.badRequest()
                    .body(Map.of("message", "Email is required"));
        }
        // Prevent self-deletion via admin route
        if (targetEmail.equals(auth.getName())) {
            return ResponseEntity.badRequest()
                    .body(Map.of("message",
                            "Use /api/users/me to delete your own account"));
        }
        try {
            var summary = userDeletionService.deleteUser(targetEmail);
            return ResponseEntity.ok(Map.of(
                    "success", true,
                    "message", summary.message()
            ));
        } catch (Exception e) {
            return ResponseEntity.internalServerError()
                    .body(Map.of("message", e.getMessage()));
        }
    }
}
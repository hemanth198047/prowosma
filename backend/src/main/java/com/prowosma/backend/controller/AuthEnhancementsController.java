package com.prowosma.backend.controller;

import com.prowosma.backend.model.User;
import com.prowosma.backend.repository.UserRepository;
import com.prowosma.backend.service.AuthService;
import com.prowosma.backend.config.JwtUtil;
import com.prowosma.backend.service.EmailService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.*;

/**
 * Auth enhancements:
 * - Magic links / passwordless
 * - Social login (Google, Microsoft, GitHub)
 * - Email OTP MFA
 * - Backup codes
 * - Refresh tokens
 */
@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthEnhancementsController {

    @org.springframework.beans.factory.annotation.Value("${app.frontend.url:http://localhost:5173}")
    private String frontendUrl;
    private final UserRepository userRepo;
    private final AuthService    authService;
    private final EmailService   emailService;
    private final JwtUtil        jwtUtil;
    private final SecurityController securityController;

    // ── Magic link / Passwordless ────────────────────────────────
    @PostMapping("/magic-link")
    public ResponseEntity<Map<String, Object>> sendMagicLink(@RequestBody Map<String, String> body) {
        String email = body.get("email");
        if (email == null || email.isBlank()) return ResponseEntity.badRequest().build();

        String token = UUID.randomUUID().toString().replace("-","");
        LocalDateTime expiry = LocalDateTime.now().plusMinutes(15);

        User user = userRepo.findByEmail(email).orElseGet(() -> {
            User u = new User(); u.setEmail(email); u.setName(email);
            u.setRole("USER"); u.setAuthProvider("LOCAL"); return u;
        });
        user.setMagicLinkToken(token);
        user.setMagicLinkExpiry(expiry);
        userRepo.save(user);

        String link = frontendUrl + "/auth/magic?token=" + token;
        emailService.sendHtmlEmail(email, user.getName(),
            "🔑 Your Prowosma login link",
            "<p>Click below to log in — link expires in 15 minutes:</p>"
            + "<a href='" + link + "' style='background:#6366f1;color:#fff;padding:12px 24px;"
            + "border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;"
            + "margin:12px 0'>Log in to Prowosma →</a>"
            + "<p style='color:#9ca3af;font-size:12px;'>If you didn't request this, ignore this email.</p>");

        return ResponseEntity.ok(Map.of("sent", true, "email", email, "expiresIn", "15 minutes"));
    }

    @PostMapping("/magic-link/verify")
    public ResponseEntity<Map<String, Object>> verifyMagicLink(@RequestBody Map<String, String> body) {
        String token = body.get("token");
        java.util.Optional<User> found = userRepo.findByMagicLinkToken(token)
            .filter(u -> u.getMagicLinkExpiry() != null
                && u.getMagicLinkExpiry().isAfter(LocalDateTime.now()));
        if (found.isEmpty()) {
            return ResponseEntity.status(401).body(buildErr("Invalid or expired magic link"));
        }
        User u = found.get();
        u.setMagicLinkToken(null); u.setMagicLinkExpiry(null);
        userRepo.save(u);
        String sessionId = null;
        try { sessionId = securityController.recordSessionForUser(u, null, null, true); } catch (Exception ignored) {}
        Map<String, Object> result = new java.util.LinkedHashMap<>();
        result.put("token", sessionId != null ? jwtUtil.generateToken(u.getEmail(), sessionId) : jwtUtil.generateToken(u.getEmail()));
        result.put("email", u.getEmail());
        result.put("name",  u.getName());
        return ResponseEntity.ok(result);
    }

    // NOTE: the old /social-login endpoint (Google/Microsoft/GitHub) was
    // removed. It trusted a client-supplied email/socialId with zero
    // server-side verification - and on inspection, the frontend "buttons"
    // behind it were literally a prompt() dialog asking the user to type an
    // email, with no real OAuth SDK integration for any of the three
    // providers. There was no legitimate client using this endpoint to
    // preserve. Real Google/Microsoft/GitHub login now goes through Auth0
    // (see AuthController.ssoLogin), which Auth0 is configured to federate
    // to those same providers as upstream connections, and which is now
    // cryptographically verified server-side via Auth0TokenVerifier.

    // ── Refresh tokens ───────────────────────────────────────────
    @PostMapping("/refresh")
    public ResponseEntity<Map<String, Object>> refreshToken(@RequestBody Map<String, String> body) {
        String refreshToken = body.get("refreshToken");
        java.util.Optional<User> rfound = userRepo.findByRefreshToken(refreshToken)
            .filter(u -> u.getRefreshTokenExpiry() != null
                && u.getRefreshTokenExpiry().isAfter(LocalDateTime.now()));
        if (rfound.isEmpty()) {
            return ResponseEntity.status(401).body(buildErr("Invalid or expired refresh token"));
        }
        User ru = rfound.get();
        String sessionId = null;
        try { sessionId = securityController.recordSessionForUser(ru, null, null, true); } catch (Exception ignored) {}
        String newJwt     = sessionId != null ? jwtUtil.generateToken(ru.getEmail(), sessionId) : jwtUtil.generateToken(ru.getEmail());
        String newRefresh = UUID.randomUUID().toString().replace("-","");
        ru.setRefreshToken(newRefresh);
        ru.setRefreshTokenExpiry(LocalDateTime.now().plusDays(30));
        userRepo.save(ru);
        Map<String, Object> rtok = new java.util.LinkedHashMap<>();
        rtok.put("token", newJwt); rtok.put("refreshToken", newRefresh);
        return ResponseEntity.ok(rtok);
    }

    // ── Email OTP MFA ────────────────────────────────────────────
    @PostMapping("/mfa/email-otp/send")
    public ResponseEntity<Map<String, Object>> sendEmailOtp(@RequestBody Map<String, String> body) {
        String email = body.get("email");
        String otp   = String.format("%06d", new SecureRandom().nextInt(1_000_000));
        java.util.Optional<User> otp_user = userRepo.findByEmail(email);
        if (otp_user.isEmpty()) return ResponseEntity.<Map<String,Object>>notFound().build();
        User ou = otp_user.get();
        ou.setEmailOtpCode(otp);
        ou.setEmailOtpExpiry(LocalDateTime.now().plusMinutes(10));
        userRepo.save(ou);
        emailService.sendHtmlEmail(email, ou.getName(), "🔐 Prowosma verification code",
            "<p>Your verification code is:</p>"
            + "<div style='font-size:32px;font-weight:900;letter-spacing:8px;color:#6366f1;"
            + "padding:16px;background:#eef2ff;border-radius:8px;display:inline-block'>"
            + otp + "</div><p style='color:#9ca3af;font-size:12px;'>Expires in 10 minutes.</p>");
        Map<String, Object> otpR = new java.util.LinkedHashMap<>();
        otpR.put("sent", true); otpR.put("email", email);
        return ResponseEntity.ok(otpR);
    }

    @PostMapping("/mfa/email-otp/verify")
    public ResponseEntity<Map<String, Object>> verifyEmailOtp(@RequestBody Map<String, String> body) {
        String email = body.get("email");
        String otp   = body.get("otp");
        return userRepo.findByEmail(email)
            .filter(u -> otp.equals(u.getEmailOtpCode())
                && u.getEmailOtpExpiry() != null
                && u.getEmailOtpExpiry().isAfter(LocalDateTime.now()))
            .map(u -> {
                u.setEmailOtpCode(null); u.setEmailOtpExpiry(null); userRepo.save(u);
                Map<String, Object> ok = new java.util.LinkedHashMap<>();
                ok.put("verified", true);
                return ResponseEntity.<Map<String,Object>>ok(ok);
            })
            .orElse(ResponseEntity.status(401).body(buildErr("Invalid or expired OTP")));
    }

    // ── Backup codes ─────────────────────────────────────────────
    @PostMapping("/mfa/backup-codes/generate")
    public ResponseEntity<Map<String, Object>> generateBackupCodes(@RequestBody Map<String, String> body) {
        String email = body.get("email");
        return userRepo.findByEmail(email).map(u -> {
            List<String> codes = new ArrayList<>();
            SecureRandom rng   = new SecureRandom();
            for (int i = 0; i < 8; i++) {
                String code = String.format("%04d-%04d", rng.nextInt(10000), rng.nextInt(10000));
                codes.add(code);
            }
            // In production: store hashed. For now, store plaintext.
            u.setBackupCodes(new ArrayList<>(codes));
            userRepo.save(u);
            return ResponseEntity.ok(Map.of("codes", codes,
                "warning", "Store these codes securely — they won't be shown again."));
        }).orElse(ResponseEntity.<Map<String,Object>>notFound().build());
    }

    @PostMapping("/mfa/backup-codes/verify")
    public ResponseEntity<Map<String, Object>> useBackupCode(@RequestBody Map<String, String> body) {
        String email = body.get("email");
        String code  = body.get("code");
        return userRepo.findByEmail(email)
            .filter(u -> u.getBackupCodes() != null && u.getBackupCodes().contains(code))
            .map(u -> {
                u.getBackupCodes().remove(code); // each code used once
                userRepo.save(u);
                Map<String, Object> r = new java.util.LinkedHashMap<>();
                r.put("verified", true); r.put("remainingCodes", u.getBackupCodes().size());
                return ResponseEntity.<Map<String,Object>>ok(r);
            })
            .orElse(ResponseEntity.status(401).body(buildErr("Invalid backup code")));
    }

    // ── SCIM Group sync (enhancement) ────────────────────────────
    @PostMapping("/scim/sync-groups")
    public ResponseEntity<Map<String, Object>> syncGroups(@RequestBody Map<String, Object> body) {
        // Accept group sync payload from identity provider
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> groups = (List<Map<String, Object>>) body.getOrDefault("groups", List.of());
        int synced = 0;
        for (Map<String, Object> g : groups) {
            // Sync user role based on group membership
            String groupName = (String) g.get("displayName");
            @SuppressWarnings("unchecked")
            List<Map<String, String>> members = (List<Map<String, String>>) g.getOrDefault("members", List.of());
            String role = "MEMBER";
            if (groupName != null && groupName.toLowerCase().contains("admin")) role = "ADMIN";
            else if (groupName != null && groupName.toLowerCase().contains("viewer")) role = "VIEWER";
            final String finalRole = role;
            for (Map<String, String> m : members) {
                String email = m.get("value");
                if (email != null) {
                    userRepo.findByEmail(email).ifPresent(u -> {
                        u.setRole(finalRole);
                        userRepo.save(u);
                    });
                    synced++;
                }
            }
        }
        return ResponseEntity.ok(Map.of("synced", synced, "groups", groups.size()));
    }

    private Map<String, Object> buildErr(String msg) {
        Map<String, Object> m = new java.util.LinkedHashMap<>();
        m.put("error", msg);
        return m;
    }

}

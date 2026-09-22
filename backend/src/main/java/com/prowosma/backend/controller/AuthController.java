package com.prowosma.backend.controller;

import com.prowosma.backend.model.User;
import com.prowosma.backend.service.AuthService;
import com.prowosma.backend.service.Auth0TokenVerifier;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;
    private final Auth0TokenVerifier auth0TokenVerifier;

    @PostMapping("/register")
    public Map<String, Object> register(@RequestBody Map<String, String> body,
                                         HttpServletRequest request) {
        return authService.register(
                body.get("name"), body.get("email"), body.get("password"),
                extractIp(request), request.getHeader("User-Agent"));
    }

    @PostMapping("/login")
    public Map<String, Object> login(@RequestBody Map<String, String> body,
                                      HttpServletRequest request) {
        return authService.login(
                body.get("email"), body.get("password"),
                extractIp(request), request.getHeader("User-Agent"));
    }

    // Step 2 of login for a 2FA-enabled account. Called after /login
    // returns {"twoFactorRequired": true} for this email, with the
    // 6-digit code from the person's authenticator app. See
    // AuthService.login / AuthService.completeTwoFactorLogin for how the
    // password-verified "pending" window this relies on is set and
    // consumed.
    @PostMapping("/login/2fa")
    public Map<String, Object> completeTwoFactorLogin(@RequestBody Map<String, String> body,
                                                        HttpServletRequest request) {
        return authService.completeTwoFactorLogin(
                body.get("email"), body.get("code"),
                extractIp(request), request.getHeader("User-Agent"));
    }

    @GetMapping("/profile")
    public User getProfile(Authentication authentication) {
        return authService.getProfile(authentication.getName());
    }

    @PostMapping("/change-password")
    public Map<String, Object> changePassword(@RequestBody Map<String, String> body,
                                               Authentication authentication,
                                               HttpServletRequest request) {
        return authService.changePassword(
                authentication.getName(),
                body.get("oldPassword"), body.get("newPassword"),
                extractIp(request), request.getHeader("User-Agent"));
    }

    // No @Authentication required - this is specifically for a user who
    // CAN'T get a session because their password is expired (that's the
    // whole reason login blocked them). Identity is proven by the old
    // password matching, same trust level as a normal login attempt.
    @PostMapping("/reset-expired-password")
    public Map<String, Object> resetExpiredPassword(@RequestBody Map<String, String> body,
                                                      HttpServletRequest request) {
        return authService.resetExpiredPassword(
                body.get("email"), body.get("oldPassword"), body.get("newPassword"),
                extractIp(request), request.getHeader("User-Agent"));
    }

    @PostMapping("/logout")
    public Map<String, String> logout() {
        return Map.of("message", "Logged out successfully");
    }

    /** Resolve real IP even behind a proxy */
    private String extractIp(HttpServletRequest request) {
        String xff = request.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) return xff.split(",")[0].trim();
        String realIp = request.getHeader("X-Real-IP");
        if (realIp != null && !realIp.isBlank()) return realIp;
        return request.getRemoteAddr();
    }

    // ── Auth0 / OIDC SSO login ────────────────────────────────────
    // Called after Auth0 redirects to /auth0/callback in the frontend.
    // The frontend must send the real Auth0 ID token ({idToken}) - this is
    // cryptographically verified against Auth0's public keys (JWKS) before
    // anything in it is trusted. Previously this endpoint took a plain
    // {email, name} body with no proof either came from a real Auth0
    // session, so anyone could POST any email here directly and get a
    // real JWT for that account.
    @PostMapping("/sso-login")
    public ResponseEntity<?> ssoLogin(@RequestBody Map<String, String> body) {
        String idToken = body.get("idToken");
        if (idToken == null || idToken.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error",
                    "Missing ID token - this endpoint no longer accepts a bare email/name, it must be called with a real Auth0 idToken"));
        }

        String email;
        String name;
        try {
            var claims = auth0TokenVerifier.verify(idToken);
            email = claims.get("email", String.class);
            name = claims.get("name", String.class);
            if (email == null || email.isBlank()) {
                return ResponseEntity.status(401).body(Map.of("error", "Verified token has no email claim"));
            }
        } catch (Auth0TokenVerifier.TokenVerificationException e) {
            return ResponseEntity.status(401).body(Map.of("error", "Token verification failed: " + e.getMessage()));
        }

        try {
            Map<String, Object> result = authService.loginOrCreateSsoUser(email, name);
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

}

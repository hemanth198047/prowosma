package com.prowosma.backend.controller;

import com.prowosma.backend.service.AuthService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.saml2.provider.service.authentication.Saml2AuthenticatedPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * SSO controller — handles post-SAML-authentication JWT issuance.
 *
 * Flow:
 * 1. User clicks "Sign in with Okta/Azure" → browser goes to /saml2/authenticate/{registrationId}
 * 2. Spring Security handles SAML handshake automatically
 * 3. On success, user is redirected to /api/sso/callback
 * 4. This controller extracts the SAML principal, finds/creates the user, and returns a JWT
 */
@Slf4j
@RestController
@RequestMapping("/api/sso")
@Tag(name = "SSO APIs", description = "SAML 2.0 / OIDC Single Sign-On")
@RequiredArgsConstructor
public class SsoController {

    private final AuthService authService;

    @GetMapping("/callback")
    @Operation(summary = "SAML SSO callback — issues JWT after successful SAML authentication")
    public ResponseEntity<Map<String, Object>> samlCallback(
            @AuthenticationPrincipal Saml2AuthenticatedPrincipal principal) {
        if (principal == null)
            return ResponseEntity.status(401).body(Map.of("error", "SAML authentication failed"));

        String email = principal.getFirstAttribute("email");
        if (email == null) email = principal.getName(); // fallback to NameID

        String name = principal.getFirstAttribute("displayName");
        if (name == null) name = principal.getFirstAttribute("cn");
        if (name == null) name = email;

        try {
            Map<String, Object> result = authService.loginOrCreateSsoUser(email, name);
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            log.error("SSO login failed for {}: {}", email, e.getMessage());
            return ResponseEntity.status(500).body(Map.of("error", "SSO login failed"));
        }
    }

    @GetMapping("/providers")
    @Operation(summary = "Get list of configured SSO providers")
    public ResponseEntity<Map<String, Object>> getProviders() {
        // Returns which providers are configured so the frontend can show SSO buttons
        return ResponseEntity.ok(Map.of(
            "saml", authService.getConfiguredSsoProviders()
        ));
    }

    @GetMapping("/metadata/{registrationId}")
    @Operation(summary = "SP metadata URL for this registration (for IdP configuration)")
    public ResponseEntity<Map<String, String>> getMetadataUrl(
            @PathVariable String registrationId) {
        return ResponseEntity.ok(Map.of(
            "metadataUrl",
            "/saml2/service-provider-metadata/" + registrationId,
            "acsUrl",
            "/login/saml2/sso/" + registrationId
        ));
    }
}

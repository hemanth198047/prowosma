package com.prowosma.backend.config;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.saml2.provider.service.registration.InMemoryRelyingPartyRegistrationRepository;
import org.springframework.security.saml2.provider.service.registration.RelyingPartyRegistration;
import org.springframework.security.saml2.provider.service.registration.RelyingPartyRegistrationRepository;
import org.springframework.security.saml2.provider.service.registration.RelyingPartyRegistrations;

import java.util.ArrayList;
import java.util.List;

/**
 * SAML 2.0 SSO configuration.
 *
 * To enable SSO, add real IdP metadata URLs to application.properties:
 *
 *   saml.idp.okta.metadata-url=https://dev-REAL.okta.com/app/REAL/sso/saml/metadata
 *   saml.idp.azure.metadata-url=https://login.microsoftonline.com/TENANT/federationmetadata/2007-06/federationmetadata.xml
 *
 * Leave the properties empty (or don't set them) and the app boots normally
 * with no SSO providers — the standard email/password login still works.
 *
 * SP ACS URL:      {baseUrl}/login/saml2/sso/{registrationId}
 * SP Metadata URL: {baseUrl}/saml2/service-provider-metadata/{registrationId}
 *
 * Every value below is externally configurable (env var -> property, see
 * application.properties and .env.example) — enabling, disabling, or
 * repointing any IdP is purely a configuration change, never a code
 * change or a rebuild. See docs/SSO_SETUP.md for the exact per-IdP steps.
 */
@Slf4j
@Configuration
public class SamlConfig {

    @Value("${saml.idp.okta.metadata-url:}")
    private String oktaMetadataUrl;

    @Value("${saml.idp.azure.metadata-url:}")
    private String azureMetadataUrl;

    @Value("${saml.idp.google.metadata-url:}")
    private String googleMetadataUrl;

    @Value("${saml.idp.custom.metadata-url:}")
    private String customMetadataUrl;

    @Value("${saml.idp.custom.registration-id:custom}")
    private String customRegistrationId;

    @Bean
    public RelyingPartyRegistrationRepository relyingPartyRegistrationRepository() {
        List<RelyingPartyRegistration> registrations = new ArrayList<>();

        tryRegister(registrations, oktaMetadataUrl,   "okta");
        tryRegister(registrations, azureMetadataUrl,  "azure");
        tryRegister(registrations, googleMetadataUrl, "google");
        tryRegister(registrations, customMetadataUrl,  customRegistrationId);

        if (registrations.isEmpty()) {
            // No providers configured — return an empty repository so the app boots normally.
            // Standard email/password authentication still works.
            log.info("[SamlConfig] No SAML IdPs configured — SSO login disabled, " +
                "email/password and Auth0 login remain available. Set SAML_*_METADATA_URL " +
                "env vars to enable (see docs/SSO_SETUP.md).");
            return registrationId -> null;
        }

        log.info("[SamlConfig] SAML SSO active for {} provider(s): {}",
            registrations.size(),
            registrations.stream().map(RelyingPartyRegistration::getRegistrationId).toList());

        return new InMemoryRelyingPartyRegistrationRepository(
            registrations.toArray(new RelyingPartyRegistration[0])
        );
    }

    /**
     * Attempts to register a SAML IdP. Skips silently if:
     *   - the URL is blank
     *   - the URL still contains placeholder text (dev-xxxx, TENANT, etc.)
     *   - the metadata endpoint is unreachable at startup
     */
    private void tryRegister(List<RelyingPartyRegistration> list, String url, String id) {
        if (url == null || url.isBlank()) return;
        // Skip obvious placeholder values
        if (url.contains("xxxx") || url.contains("TENANT") ||
            url.contains("REAL")  || url.contains("example")) return;

        try {
            list.add(
                RelyingPartyRegistrations
                    .fromMetadataLocation(url)
                    .registrationId(id)
                    .build()
            );
        } catch (Exception e) {
            // Log warning but don't crash the app — metadata may be temporarily
            // unavailable (IdP outage, transient DNS/network issue at boot). The
            // app still starts; this provider just won't appear in
            // AuthService.getConfiguredSsoProviders() / the SSO login screen
            // until metadata is reachable on a later restart.
            log.warn("[SamlConfig] Could not load IdP metadata for '{}' from {} — {}. " +
                "This SSO provider will be unavailable until metadata is reachable.",
                id, url, e.getMessage());
        }
    }
}

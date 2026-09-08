package com.prowosma.backend.config.region;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * Reads which physical MongoDB clusters are actually configured, one per
 * data-residency region — MONGODB_URI_US / MONGODB_URI_EU / MONGODB_URI_UK
 * / MONGODB_URI_APAC. This is the single source of truth for "which
 * regions can this deployment honestly promise residency in right now",
 * used by both WorkspaceService (to reject an unenforceable region
 * selection at the point a customer picks one — see its own comments) and
 * RegionRoutingMongoDatabaseFactory (to actually route data once adopted
 * by a repository — see docs/DATA_RESIDENCY.md for that adoption path).
 *
 * Entirely opt-in: with none of these set, this deployment has zero
 * configured regions, which is the exact pre-existing "UNSET" behavior —
 * no change for anyone not opting in to multi-region infrastructure.
 */
@Slf4j
@Component
public class RegionConfig {

    @Value("${data-region.mongodb-uri.us:}")   private String usUri;
    @Value("${data-region.mongodb-uri.eu:}")   private String euUri;
    @Value("${data-region.mongodb-uri.uk:}")   private String ukUri;
    @Value("${data-region.mongodb-uri.apac:}") private String apacUri;

    private Map<String, String> configuredRegions;

    /** Region codes with a real, distinct MongoDB URI configured for them. */
    public synchronized Set<String> configuredRegionCodes() {
        if (configuredRegions == null) {
            configuredRegions = new LinkedHashMap<>();
            putIfSet("US", usUri);
            putIfSet("EU", euUri);
            putIfSet("UK", ukUri);
            putIfSet("APAC", apacUri);
            if (configuredRegions.isEmpty()) {
                log.info("[RegionConfig] No region-specific MongoDB URIs configured — this deployment " +
                    "cannot honestly promise physical data residency in any specific region today. " +
                    "See docs/DATA_RESIDENCY.md.");
            } else {
                log.info("[RegionConfig] Region-routed storage configured for: {}", configuredRegions.keySet());
            }
        }
        return configuredRegions.keySet();
    }

    public String uriFor(String region) {
        configuredRegionCodes(); // ensure initialized
        return configuredRegions.get(region);
    }

    /** True only if this deployment has a real, distinct database connection for this region. */
    public boolean canEnforce(String region) {
        return region != null && configuredRegionCodes().contains(region.toUpperCase());
    }

    private void putIfSet(String code, String uri) {
        if (uri != null && !uri.isBlank()) configuredRegions.put(code, uri);
    }
}

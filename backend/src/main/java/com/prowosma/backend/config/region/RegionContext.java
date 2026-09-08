package com.prowosma.backend.config.region;

/**
 * ThreadLocal holder for "which data region does the current request's
 * workspace belong to" — set by DataRegionRoutingFilter early in the
 * filter chain (after WorkspaceContext resolves the workspace, before any
 * repository call happens), read by RegionRoutingMongoDatabaseFactory.
 *
 * Same pattern Spring's own AbstractRoutingDataSource uses for JDBC
 * multi-tenancy, applied to Mongo's MongoDatabaseFactory instead — there's
 * no Spring Data Mongo equivalent shipped out of the box, so this is that
 * missing piece, purpose-built for region routing specifically (not a
 * general-purpose multi-tenancy mechanism — WorkspaceContext already
 * handles workspace-level scoping within a single database; this is only
 * about WHICH physical database).
 */
public final class RegionContext {

    private static final ThreadLocal<String> CURRENT_REGION = new ThreadLocal<>();

    private RegionContext() {}

    public static void set(String region) {
        CURRENT_REGION.set(region);
    }

    /** Null means "use the default/home database" — the pre-existing, unrouted behavior. */
    public static String get() {
        return CURRENT_REGION.get();
    }

    public static void clear() {
        CURRENT_REGION.remove();
    }
}

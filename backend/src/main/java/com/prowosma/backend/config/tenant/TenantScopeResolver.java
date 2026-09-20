package com.prowosma.backend.config.tenant;

/** Supplies the {@link TenantScope} for the call being made right now. */
@FunctionalInterface
public interface TenantScopeResolver {
    TenantScope current();
}

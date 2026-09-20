package com.prowosma.backend.config.tenant;

/**
 * Thrown when a write would overwrite a record that belongs to another
 * workspace. Mapped to 404 by GlobalExceptionHandler, the same response as a
 * record that does not exist, so it cannot be used to probe for other tenants'
 * ids.
 */
public class TenantViolationException extends RuntimeException {
    private static final long serialVersionUID = 1L;

    public TenantViolationException(String message) {
        super(message);
    }
}

package com.prowosma.backend.config;

import com.prowosma.backend.config.tenant.TenantViolationException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Global exception handler — converts exceptions to consistent JSON error responses.
 *
 * Error shape:
 *   { "error": "ERROR_CODE", "message": "Human readable", "timestamp": "...", "details": [...] }
 *
 * Previously: only handled RuntimeException → 400 with raw message.
 * Fixed: proper HTTP status codes for all common exception types.
 */
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    /** @Valid validation failures → 400 with field-level error details */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Map<String, Object>> handleValidation(MethodArgumentNotValidException ex) {
        List<Map<String, String>> fieldErrors = ex.getBindingResult().getFieldErrors().stream()
            .map(fe -> Map.of(
                "field",   fe.getField(),
                "message", fe.getDefaultMessage() != null ? fe.getDefaultMessage() : "Invalid value",
                "rejected", fe.getRejectedValue() != null ? fe.getRejectedValue().toString() : "null"
            ))
            .collect(Collectors.toList());

        return ResponseEntity.badRequest().body(errorBody(
            "VALIDATION_ERROR",
            "Request validation failed — " + fieldErrors.size() + " field(s) invalid",
            fieldErrors
        ));
    }

    /** ResponseStatusException → correct HTTP status */
    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String, Object>> handleResponseStatus(ResponseStatusException ex) {
        return ResponseEntity.status(ex.getStatusCode()).body(errorBody(
            ex.getStatusCode().toString(),
            ex.getReason() != null ? ex.getReason() : ex.getMessage(),
            null
        ));
    }

    /** Missing required query parameters → 400 */
    @ExceptionHandler(MissingServletRequestParameterException.class)
    public ResponseEntity<Map<String, Object>> handleMissingParam(MissingServletRequestParameterException ex) {
        return ResponseEntity.badRequest().body(errorBody(
            "MISSING_PARAMETER",
            "Required parameter '" + ex.getParameterName() + "' is missing",
            null
        ));
    }

    /** IllegalArgumentException → 400 */
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, Object>> handleIllegalArgument(IllegalArgumentException ex) {
        return ResponseEntity.badRequest().body(errorBody(
            "INVALID_ARGUMENT",
            ex.getMessage(),
            null
        ));
    }

    /** A save() hit a unique index (e.g. team_members' one-role-per-workspace
     *  constraint) - a real conflict, not a server fault, so 409 rather than
     *  the generic RuntimeException handler's 500. Applies to any collection
     *  with a unique index, not just team_members. */
    @ExceptionHandler(DuplicateKeyException.class)
    public ResponseEntity<Map<String, Object>> handleDuplicateKey(DuplicateKeyException ex) {
        log.warn("Duplicate key on save: {}", ex.getMessage());
        return ResponseEntity.status(HttpStatus.CONFLICT).body(errorBody(
            "DUPLICATE",
            "This record already exists.",
            null
        ));
    }

    /** Password expired at login - distinct code so the frontend can route to a forced-reset flow, not just show "login failed". */
    @ExceptionHandler(com.prowosma.backend.service.AuthService.PasswordExpiredException.class)
    public ResponseEntity<Map<String, Object>> handlePasswordExpired(com.prowosma.backend.service.AuthService.PasswordExpiredException ex) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(errorBody(
            "PASSWORD_EXPIRED",
            ex.getMessage(),
            null
        ));
    }

    /** Invite link points at someone who has genuinely already completed joining — distinct code so the frontend shows "log in instead" rather than a dead-end error. See InvitationService.isGenuinelyAlreadyMember. */
    @ExceptionHandler(com.prowosma.backend.service.InvitationService.AlreadyMemberException.class)
    public ResponseEntity<Map<String, Object>> handleAlreadyMember(com.prowosma.backend.service.InvitationService.AlreadyMemberException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(errorBody(
            "ALREADY_MEMBER",
            ex.getMessage(),
            null
        ));
    }

    /** Password doesn't meet the workspace's complexity policy - real message listing exactly what's missing. */
    @ExceptionHandler(com.prowosma.backend.service.PasswordPolicyService.PasswordPolicyException.class)
    public ResponseEntity<Map<String, Object>> handlePasswordPolicy(com.prowosma.backend.service.PasswordPolicyService.PasswordPolicyException ex) {
        return ResponseEntity.badRequest().body(errorBody(
            "PASSWORD_POLICY_VIOLATION",
            ex.getMessage(),
            null
        ));
    }

    /** Wrong email/password at login (or during an expired-password reset) - 401, not the generic 500 the bare RuntimeException handler below would otherwise give it. */
    @ExceptionHandler(com.prowosma.backend.service.AuthService.InvalidCredentialsException.class)
    public ResponseEntity<Map<String, Object>> handleInvalidCredentials(com.prowosma.backend.service.AuthService.InvalidCredentialsException ex) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(errorBody(
            "INVALID_CREDENTIALS",
            ex.getMessage(),
            null
        ));
    }

    /**
     * A write that would have overwritten another workspace's record (blocked by the
     * tenant guard). Answered exactly like a record that does not exist, so it can't be
     * used to find out which ids belong to other workspaces.
     */
    @ExceptionHandler(TenantViolationException.class)
    public ResponseEntity<Map<String, Object>> handleTenantViolation(TenantViolationException ex) {
        log.warn("Blocked cross-workspace write: {}", ex.getMessage());
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(errorBody(
            "NOT_FOUND",
            "Resource not found",
            null
        ));
    }

    /** Generic RuntimeException → 500 with logging (avoid leaking stack traces) */
    @ExceptionHandler(RuntimeException.class)
    public ResponseEntity<Map<String, Object>> handleRuntimeException(RuntimeException ex) {
        // Log full trace for debugging; return sanitised message to client
        log.error("Unhandled RuntimeException: {}", ex.getMessage(), ex);

        // Check if it's a "not found" pattern from services that still throw raw RuntimeException
        String msg = ex.getMessage() != null ? ex.getMessage().toLowerCase() : "";
        if (msg.contains("not found")) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(errorBody(
                "NOT_FOUND",
                ex.getMessage(),
                null
            ));
        }

        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(errorBody(
            "INTERNAL_ERROR",
            "An unexpected error occurred. Please try again.",
            null
        ));
    }

    /** Catch-all for any unhandled exception */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleGeneric(Exception ex) {
        log.error("Unhandled exception: {}", ex.getMessage(), ex);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(errorBody(
            "SERVER_ERROR",
            "Internal server error",
            null
        ));
    }

    private Map<String, Object> errorBody(String code, String message, Object details) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("error",     code);
        body.put("message",   message);
        body.put("timestamp", LocalDateTime.now().toString());
        if (details != null) body.put("details", details);
        return body;
    }
}

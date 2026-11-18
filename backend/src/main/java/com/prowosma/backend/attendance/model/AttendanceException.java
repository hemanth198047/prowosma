package com.prowosma.backend.attendance.model;

import lombok.Getter;
import org.springframework.http.HttpStatus;

/** A refusal with a plain-English message the screen can show as it is. */
@Getter
public class AttendanceException extends RuntimeException {
    private final HttpStatus status;
    private final String code;

    public AttendanceException(HttpStatus status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public static AttendanceException bad(String code, String message) { return new AttendanceException(HttpStatus.BAD_REQUEST, code, message); }
    public static AttendanceException conflict(String code, String message) { return new AttendanceException(HttpStatus.CONFLICT, code, message); }
    public static AttendanceException forbidden(String message) { return new AttendanceException(HttpStatus.FORBIDDEN, "NOT_ALLOWED", message); }
    public static AttendanceException notFound() { return new AttendanceException(HttpStatus.NOT_FOUND, "NOT_FOUND", "That record doesn't exist."); }
}

package com.prowosma.backend.attendance.app;

import com.prowosma.backend.attendance.model.AttendanceException;
import com.prowosma.backend.repository.WorkspaceConfigRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/**
 * Attendance is part of the product for every workspace and every person: there is no switch to turn on any more. {@code FLAG} is kept only so that
 * an old "attendance" entry in a workspace's saved feature flags is recognised and ignored.
 */
@Component
public class AttendanceFeature {
    public static final String FLAG = "attendance";

    public AttendanceFeature(WorkspaceConfigRepository configs) { }

    /** On for every workspace; false only when there is no workspace to speak of. */
    public boolean isOn(String workspaceId) {
        return workspaceId != null && !workspaceId.isBlank();
    }

    public void require(String workspaceId) {
        if (!isOn(workspaceId))
            throw new AttendanceException(HttpStatus.NOT_FOUND, "NO_WORKSPACE", "Choose a workspace first.");
    }
}

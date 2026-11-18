package com.prowosma.backend.attendance.app;

import com.prowosma.backend.attendance.model.AttendanceException;
import com.prowosma.backend.repository.WorkspaceConfigRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/** The {@code attendance} feature flag: off until an admin turns it on (Admin Centre → Feature flags). */
@Component
public class AttendanceFeature {
    public static final String FLAG = "attendance";

    private final WorkspaceConfigRepository configs;

    public AttendanceFeature(WorkspaceConfigRepository configs) { this.configs = configs; }

    public boolean isOn(String workspaceId) {
        if (workspaceId == null) return false;
        return configs.findByWorkspaceId(workspaceId)
                .map(c -> c.getFeatureFlags() != null && Boolean.TRUE.equals(c.getFeatureFlags().get(FLAG)))
                .orElse(false);
    }

    public void require(String workspaceId) {
        if (!isOn(workspaceId))
            throw new AttendanceException(HttpStatus.NOT_FOUND, "FEATURE_DISABLED",
                    "Attendance isn't turned on for this workspace. An admin can turn it on under Admin Centre → Feature flags.");
    }
}

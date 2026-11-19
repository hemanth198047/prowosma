package com.prowosma.backend.uma.core;

import com.prowosma.backend.repository.WorkspaceConfigRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/**
 * The {@code universalMeetingAssistant} feature flag. Since the AI Meeting Assistant became the app's one Meetings feature (it took
 * over Meetings notes and the first Meeting Assistant) it is ON unless an admin turns it off for the workspace (Admin Centre →
 * Feature flags), and the server-wide switch {@code app.uma.enabled} (default true) can still turn it off everywhere at once.
 */
@Component
public class UmaFeature {
    public static final String FLAG = "universalMeetingAssistant";

    private final WorkspaceConfigRepository configs;

    @Value("${app.uma.enabled:true}")
    private boolean serverEnabled = true;

    public UmaFeature(WorkspaceConfigRepository configs) { this.configs = configs; }

    public boolean isOn(String workspaceId) {
        if (!serverEnabled || workspaceId == null) return false;
        return configs.findByWorkspaceId(workspaceId)
                .map(c -> c.getFeatureFlags() == null || !Boolean.FALSE.equals(c.getFeatureFlags().get(FLAG)))
                .orElse(true);
    }

    public void require(String workspaceId) {
        if (!isOn(workspaceId))
            throw new UmaException(HttpStatus.NOT_FOUND, "FEATURE_DISABLED",
                    "The AI Meeting Assistant isn't turned on for this workspace.",
                    "An admin can turn it on under Admin Centre → Feature flags (" + FLAG + ").");
    }
}

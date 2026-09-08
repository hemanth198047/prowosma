package com.prowosma.backend.config;

import org.springframework.stereotype.Component;
import org.springframework.web.context.annotation.RequestScope;

/**
 * Request-scoped bean that holds the current workspace ID.
 * Populated by WorkspaceFilter from the X-Workspace-Id header.
 * Inject this into any service that needs workspace isolation.
 */
@Component
@RequestScope
public class WorkspaceContext {

    private String workspaceId;

    public String getWorkspaceId() {
        return workspaceId;
    }

    public void setWorkspaceId(String workspaceId) {
        this.workspaceId = workspaceId;
    }
}

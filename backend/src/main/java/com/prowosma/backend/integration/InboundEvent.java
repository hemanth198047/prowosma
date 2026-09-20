package com.prowosma.backend.integration;

import java.util.List;

/**
 * A monitoring/CI event reduced to what matters for task tracking.
 *
 * {@code externalId} is stable across the events of one problem (a monitor, an issue, a
 * failing job) so that repeated alerts update one task instead of creating a new one each
 * time, and a recovery closes the task the alert opened.
 */
public record InboundEvent(InboundSource source, String externalId, Action action, String title,
                           String description, String priority, String severity, String type,
                           List<String> tags) {

    public enum Action { OPEN, RESOLVE, IGNORE }

    /** Key stored on the task and used to find it again. */
    public String externalRef() {
        return "inbound:" + source.pathName() + ":" + externalId;
    }
}

package com.prowosma.backend.integration;

import java.util.Optional;

/** Monitoring/CI systems that can post events to a workspace's inbound URL. */
public enum InboundSource {
    DATADOG("datadog", "DATADOG", "Datadog"),
    SENTRY("sentry", "SENTRY", "Sentry"),
    JENKINS("jenkins", "JENKINS", "Jenkins");

    private final String pathName;
    private final String integrationType;
    private final String displayName;

    InboundSource(String pathName, String integrationType, String displayName) {
        this.pathName = pathName;
        this.integrationType = integrationType;
        this.displayName = displayName;
    }

    public String pathName() { return pathName; }
    public String integrationType() { return integrationType; }
    public String displayName() { return displayName; }

    public static Optional<InboundSource> fromPath(String path) {
        if (path == null) return Optional.empty();
        for (InboundSource s : values()) if (s.pathName.equalsIgnoreCase(path)) return Optional.of(s);
        return Optional.empty();
    }

    public static Optional<InboundSource> fromIntegrationType(String type) {
        if (type == null) return Optional.empty();
        for (InboundSource s : values()) if (s.integrationType.equalsIgnoreCase(type)) return Optional.of(s);
        return Optional.empty();
    }
}

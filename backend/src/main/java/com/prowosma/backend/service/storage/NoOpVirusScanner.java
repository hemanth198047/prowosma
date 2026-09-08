package com.prowosma.backend.service.storage;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.io.InputStream;

/** Default scanner when CLAMAV_ENABLED is not set — every upload is treated as clean. */
@Component
@ConditionalOnProperty(name = "virus-scan.provider", havingValue = "none", matchIfMissing = true)
public class NoOpVirusScanner implements VirusScanner {
    @Override
    public boolean isClean(InputStream content, long contentLength) {
        return true;
    }

    @Override
    public String name() {
        return "disabled";
    }
}

package com.prowosma.backend.service.storage;

import java.io.InputStream;

/**
 * Malware scanning hook for uploaded attachments. Deliberately an
 * interface with a no-op default (see NoOpVirusScanner) — scanning every
 * upload is a real security control worth having, but shouldn't be a hard
 * requirement to run this app locally/in dev, where clamd usually isn't
 * running.
 */
public interface VirusScanner {

    /**
     * @return true if the content is clean (or scanning is disabled),
     *         false if a signature match was found. Throws only on a
     *         genuine scanner failure (e.g. clamd unreachable) — callers
     *         decide whether "scanner unavailable" should block the
     *         upload or just log a warning (see CLAMAV_FAIL_CLOSED).
     */
    boolean isClean(InputStream content, long contentLength) throws Exception;

    /** Human-readable name for logging — "disabled", "clamav", etc. */
    String name();
}

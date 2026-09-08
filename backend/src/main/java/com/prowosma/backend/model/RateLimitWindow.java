package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.LocalDateTime;

/**
 * RateLimitWindow — one document per (client, 1-minute window).
 *
 * Backs the rate limiter with MongoDB instead of an in-memory map, so the
 * limit is actually shared and correctly enforced across multiple backend
 * instances behind a load balancer — an in-memory counter gives every
 * instance its own separate 300/minute allowance instead of one real
 * shared limit.
 *
 * The TTL index auto-deletes windows 2 minutes after creation, so old
 * counters never need a manual cleanup job.
 */
@Data
@Document(collection = "rate_limit_windows")
public class RateLimitWindow {
    /** Composite key: "{clientKey}|{epochMinute}" - makes the per-window counter atomic and unique without a separate lookup. */
    @Id
    private String id;

    private String clientKey;
    private long epochMinute;
    private int count;

    @Indexed(expireAfterSeconds = 120)
    private LocalDateTime createdAt = LocalDateTime.now();
}

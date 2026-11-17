package com.prowosma.backend.uma.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

/** One timed line of a meeting transcript. Collection {@code uma_segments}. */
@Data
@Document(collection = "uma_segments")
public class UmaSegment {
    @Id private String id;
    private String organizationId;
    private String meetingId;
    private int seq;                  // 1-based, stable: evidence refers to it
    private Long startMs;
    private Long endMs;
    /** As the source named the speaker. null = unknown (we never guess names). */
    private String speaker;
    private String text;
    private boolean edited;
    private String editedBy;
}

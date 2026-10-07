package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;

/**
 * One spoken line. Speakers are exactly what the source stated (a label or a platform participant name);
 * {@code speakerUserId} stays null until someone resolves it — it is never inferred from a voice or a name.
 * Text is untrusted input: it is stored and displayed as data and never interpreted as instructions.
 */
@Data
@Document(collection = "transcript_segments")
public class TranscriptSegment {
    @Id private String id;
    private String organizationId;
    private String sessionId;
    private int generation;         // matches MeetingSession.transcriptGeneration while current
    private int seq;                // order within the generation, from 1

    private Long startMs;           // relative to the meeting start, when the source provides it
    private Long endMs;
    private Instant startTime;      // absolute time, when the source provides it

    private String speakerLabel;    // null = unknown speaker
    private String speakerRef;      // platform participant id, when provided
    private String speakerUserId;   // resolved organization user — unresolved (null) in this release
    private String text;
    private String languageCode;
    private Double confidence;      // null when the source gives none
    private String source;
}

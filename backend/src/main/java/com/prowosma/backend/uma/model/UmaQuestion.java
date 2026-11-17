package com.prowosma.backend.uma.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/** An "Ask AI about this meeting" exchange (collection {@code uma_questions}); deleted with the meeting. */
@Data
@Document(collection = "uma_questions")
public class UmaQuestion {
    @Id private String id;
    private String organizationId;
    private String meetingId;
    private String askedBy;
    private String question;
    private String answer;
    private List<Integer> evidence = new ArrayList<>();
    private boolean grounded;            // false: the meeting doesn't contain the answer (said so plainly)
    private String provider;
    private String model;
    private int inputTokens;
    private int outputTokens;
    private Instant at = Instant.now();
}

package com.prowosma.backend.model;

import lombok.Data;
import java.time.LocalDateTime;
import java.util.*;

@Data
public class Comment {
    private String id = UUID.randomUUID().toString();
    private String text;
    private String author = "Me";
    private LocalDateTime createdAt = LocalDateTime.now();

    // A-10: Emoji reactions — emoji → list of user emails who reacted
    private Map<String, List<String>> reactions = new LinkedHashMap<>();

    // A-10: Mentions — list of @mentioned user emails
    private List<String> mentions = new ArrayList<>();
}

package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;

import java.util.ArrayList;
import java.util.List;

@Data
public class Step {
    @Id
    private String id;
    private String title;
    private boolean completed = false;
    private List<Comment>    comments    = new ArrayList<>();
    private List<Attachment> attachments = new ArrayList<>();
    private List<String>     blockedByStepIds = new ArrayList<>(); // step IDs within same subGoal

    // Ensure ID is always set before saving
    public String getId() {
        if (id == null) id = java.util.UUID.randomUUID().toString();
        return id;
    }
}

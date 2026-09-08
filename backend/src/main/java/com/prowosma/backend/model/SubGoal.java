package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;

import java.util.ArrayList;
import java.util.List;

@Data
public class SubGoal {
    @Id
    private String id;
    private String title;
    private String description;
    private String status = "ACTIVE";
    private List<Step> steps = new ArrayList<>();

    // Ensure ID is always set before saving
    public String getId() {
        if (id == null) id = java.util.UUID.randomUUID().toString();
        return id;
    }

    public int getProgress() {
        if (steps == null || steps.isEmpty()) return 0;
        long done = steps.stream().filter(Step::isCompleted).count();
        return (int) ((done * 100) / steps.size());
    }
}

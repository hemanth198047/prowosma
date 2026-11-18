package com.prowosma.backend.uma.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;

/** Workspace connections for the AI Meeting Assistant (collection {@code uma_settings}, id = workspace id). Secrets are stored encrypted. */
@Data
@Document(collection = "uma_settings")
public class UmaSettings {
    @Id private String id;
    private String firefliesKeyEnc;            // never sent to the browser
    private String firefliesAccountName;       // shown so admins see which account is connected
    private String firefliesAccountEmail;
    private String firefliesSavedBy;
    private Instant firefliesSavedAt;

    // What the assistant may do on its own after a meeting (admins). People can switch tasks off for their own meetings.
    private Boolean autoCreateTasks;           // null = on: create tasks that were clearly agreed
    private Boolean autoAssign;                // null = on: assign them when the owner's identity is verified
    private Boolean autoCreateProjects;        // null = on: create a project when someone clearly asked for one by name
    private Integer maxAutoTasksPerMeeting;    // null = 25

    public boolean tasksOn() { return autoCreateTasks == null || autoCreateTasks; }
    public boolean assignOn() { return autoAssign == null || autoAssign; }
    public boolean projectsOn() { return autoCreateProjects == null || autoCreateProjects; }
    public int maxTasks() { return maxAutoTasksPerMeeting == null ? 25 : Math.max(0, Math.min(100, maxAutoTasksPerMeeting)); }
}

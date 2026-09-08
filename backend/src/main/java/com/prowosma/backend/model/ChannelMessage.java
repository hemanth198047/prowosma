package com.prowosma.backend.model;
import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Data
@Document(collection = "channel_messages")
public class ChannelMessage {
    @Id private String id;
    private String channelId;
    private String organizationId;
    private String authorEmail;
    private String authorName;
    private String content;
    private String linkedTaskId;    // optional task reference
    private String linkedGoalId;    // optional goal reference
    private List<String> reactions = new ArrayList<>(); // emoji list
    private String threadOf;        // parent message id for threaded replies
    private boolean edited = false;
    private LocalDateTime createdAt = LocalDateTime.now();
    private LocalDateTime editedAt;
}

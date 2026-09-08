package com.prowosma.backend.repository;
import com.prowosma.backend.model.ChannelMessage;
import org.springframework.data.mongodb.repository.MongoRepository;
import java.util.List;
public interface ChannelMessageRepository extends MongoRepository<ChannelMessage, String> {
    List<ChannelMessage> findByChannelIdOrderByCreatedAtAsc(String channelId);
    List<ChannelMessage> findByOrganizationId(String orgId);
}

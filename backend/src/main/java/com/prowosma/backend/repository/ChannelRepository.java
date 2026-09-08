package com.prowosma.backend.repository;
import com.prowosma.backend.model.Channel;
import org.springframework.data.mongodb.repository.MongoRepository;
import java.util.List;
public interface ChannelRepository extends MongoRepository<Channel, String> {
    List<Channel> findByOrganizationId(String orgId);
    List<Channel> findByOrganizationIdAndType(String orgId, String type);
}

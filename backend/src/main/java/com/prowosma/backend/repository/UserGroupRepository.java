package com.prowosma.backend.repository;
import com.prowosma.backend.model.UserGroup;
import org.springframework.data.mongodb.repository.MongoRepository;
import java.util.List;
public interface UserGroupRepository extends MongoRepository<UserGroup, String> {
    List<UserGroup> findByOrganizationId(String orgId);
    List<UserGroup> findByOrganizationIdAndType(String orgId, String type);
}

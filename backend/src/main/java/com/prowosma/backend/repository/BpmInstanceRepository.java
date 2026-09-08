package com.prowosma.backend.repository;
import com.prowosma.backend.model.BpmInstance;
import org.springframework.data.mongodb.repository.MongoRepository;
import java.util.List;
public interface BpmInstanceRepository extends MongoRepository<BpmInstance, String> {
    List<BpmInstance> findByOrganizationId(String orgId);
    List<BpmInstance> findByOrganizationIdAndProcessId(String orgId, String processId);
    List<BpmInstance> findByOrganizationIdAndStatus(String orgId, String status);
}

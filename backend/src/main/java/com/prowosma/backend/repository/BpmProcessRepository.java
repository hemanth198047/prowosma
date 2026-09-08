package com.prowosma.backend.repository;
import com.prowosma.backend.model.BpmProcess;
import org.springframework.data.mongodb.repository.MongoRepository;
import java.util.List;
public interface BpmProcessRepository extends MongoRepository<BpmProcess, String> {
    List<BpmProcess> findByOrganizationId(String orgId);
    List<BpmProcess> findByOrganizationIdAndStatus(String orgId, String status);
}

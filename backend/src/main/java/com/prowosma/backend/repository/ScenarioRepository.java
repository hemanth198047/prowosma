package com.prowosma.backend.repository;
import com.prowosma.backend.model.Scenario;
import org.springframework.data.mongodb.repository.MongoRepository;
import java.util.List;
public interface ScenarioRepository extends MongoRepository<Scenario, String> {
    List<Scenario> findByOrganizationIdOrderByCreatedAtDesc(String orgId);
    List<Scenario> findByOrganizationIdAndType(String orgId, String type);
}

package com.prowosma.backend.repository;
import com.prowosma.backend.model.Programme;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.mongodb.repository.MongoRepository;
import java.util.List;
public interface ProgrammeRepository extends MongoRepository<Programme, String> {
    List<Programme> findByOrganizationId(String organizationId);
    Page<Programme> findByOrganizationId(String organizationId, Pageable pageable);
}

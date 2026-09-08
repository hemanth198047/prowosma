package com.prowosma.backend.repository;
import com.prowosma.backend.model.Release;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.mongodb.repository.MongoRepository;
import java.util.List;
public interface ReleaseRepository extends MongoRepository<Release, String> {
    List<Release> findByOrganizationId(String organizationId);
    Page<Release> findByOrganizationId(String organizationId, Pageable pageable);
}

package com.prowosma.backend.repository;


import com.prowosma.backend.model.Category;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.List;

public interface CategoryRepository extends MongoRepository<Category, String> {
    boolean existsByNameIgnoreCase(String name);
    boolean existsByNameIgnoreCaseAndOrganizationId(String name, String organizationId);
    List<Category> findByOrganizationId(String organizationId);

    Page<Category> findByOrganizationId(String organizationId, Pageable pageable);
}

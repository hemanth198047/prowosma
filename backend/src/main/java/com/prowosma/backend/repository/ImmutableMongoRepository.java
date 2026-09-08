package com.prowosma.backend.repository;

import org.springframework.data.repository.NoRepositoryBean;
import org.springframework.data.repository.Repository;

import java.util.List;
import java.util.Optional;

/**
 * A Spring Data repository base for collections that must be write-once:
 * new records can be inserted, existing records can be read, but nothing
 * can delete a record through this interface — because the delete methods
 * simply don't exist on it, not because of a convention someone has to
 * remember to follow.
 *
 * MongoRepository (via CrudRepository) brings delete()/deleteAll()/
 * deleteById() along for free, which is normally convenient but is exactly
 * the wrong default for an audit trail: it means any future code anywhere
 * in the app can quietly call activityLogRepository.deleteAll(...) as a
 * side effect of something unrelated (which is exactly what happened —
 * see UserDeletionService) with no compiler warning that this might be a
 * problem. Extending this instead of MongoRepository turns that into a
 * compile error.
 *
 * `save`/`saveAll` are intentionally still available — not because
 * "immutable" should mean "never touched again," but because a narrow,
 * deliberate exception exists: compliance-driven redaction of a specific
 * record's PII fields in place (see ActivityLogAnonymizationService) is a
 * legitimate, auditable operation, whereas bulk deletion by an unrelated
 * service is not. The one legitimate bulk removal this app needs —
 * policy-driven retention purging — deliberately does NOT go through this
 * interface either; see RetentionEnforcementService, which uses
 * MongoTemplate directly so that operation stays a single, intentional,
 * logged code path instead of being reachable from anywhere via a repository
 * method.
 */
@NoRepositoryBean
public interface ImmutableMongoRepository<T, ID> extends Repository<T, ID> {
    <S extends T> S save(S entity);
    <S extends T> List<S> saveAll(Iterable<S> entities);
    Optional<T> findById(ID id);
    boolean existsById(ID id);
    List<T> findAll();
    List<T> findAllById(Iterable<ID> ids);
    long count();
}

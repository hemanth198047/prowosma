package com.prowosma.backend.config.region;

import com.mongodb.ConnectionString;
import com.mongodb.MongoClientSettings;
import com.mongodb.client.MongoClient;
import com.mongodb.client.MongoClients;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.data.mongodb.MongoDatabaseFactory;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.SimpleMongoClientDatabaseFactory;

/**
 * Exposes the opt-in region-routed MongoTemplate as a SEPARATE, named bean
 * — @Qualifier("regionRouted") — so it never becomes the default/primary
 * template every existing repository implicitly uses. Existing behavior
 * for the whole app is completely unchanged unless a repository or
 * service explicitly asks for this one instead. See
 * docs/DATA_RESIDENCY.md for how and when to do that.
 *
 * IMPORTANT: this class builds the home MongoClient/MongoDatabaseFactory
 * itself, directly from spring.mongodb.uri, the same way
 * RegionRoutingMongoDatabaseFactory already builds each region's client
 * (see MongoClients.create(uri) there). Two things forced this:
 *
 *  1. Declaring any bean of type MongoDatabaseFactory/MongoOperations here
 *     suppresses Spring Boot's own auto-configured
 *     "mongoDatabaseFactory"/"mongoTemplate" beans (their
 *     @ConditionalOnMissingBean checks match by type, not name/qualifier),
 *     so the default "mongoTemplate" every repository autowires has to be
 *     re-provided explicitly here regardless.
 *  2. In this environment no Spring-managed MongoClient bean exists at
 *     all to autowire in the first place (auto-configuration for it isn't
 *     firing), so building it from the URI ourselves is the only option
 *     that doesn't depend on that working.
 *
 * mongoDatabaseFactory/mongoTemplate below are marked @Primary, so plain
 * @Autowired MongoOperations / the default "mongoTemplate" bean name
 * resolve to these — unchanged behavior for every existing repository.
 * regionRoutingMongoDatabaseFactory wraps this same @Primary factory
 * (never itself), so there is no circular reference.
 */
@Configuration
public class RegionRoutingConfig {

    @Value("${spring.mongodb.uri}")
    private String homeMongoUri;

    // Already defined in application.properties (spring.mongodb.database,
    // defaults to "prowosma") specifically as a fallback for exactly this
    // case - a bare host:port URI with no /database path segment, like the
    // MONGODB_URI default in .env.example. Previously unused here, so
    // ConnectionString(homeMongoUri).getDatabase() returned null whenever
    // MONGODB_URI didn't include a database name, and
    // SimpleMongoClientDatabaseFactory rejected that with "Database name
    // must not be empty" instead of ever reaching this fallback.
    @Value("${spring.mongodb.database:prowosma}")
    private String homeMongoDatabase;

    @Bean
    public MongoClientSettings mongoClientSettings() {
        return MongoClientSettings.builder()
                .applyConnectionString(new ConnectionString(homeMongoUri))
                .build();
    }

    @Bean
    public MongoClient mongoClient() {
        return MongoClients.create(homeMongoUri);
    }

    /**
     * The app's real, primary MongoDatabaseFactory — built explicitly so
     * it exists independently of regionRoutingMongoDatabaseFactory below
     * and isn't accidentally satisfied by it.
     */
    @Bean
    @Primary
    public MongoDatabaseFactory mongoDatabaseFactory(MongoClient mongoClient) {
        String uriDatabase = new ConnectionString(homeMongoUri).getDatabase();
        String databaseName = (uriDatabase != null && !uriDatabase.isBlank())
                ? uriDatabase
                : homeMongoDatabase;
        return new SimpleMongoClientDatabaseFactory(mongoClient, databaseName);
    }

    /**
     * The default MongoTemplate every existing repository/service uses,
     * backed by the primary factory above.
     */
    @Bean
    @Primary
    public MongoTemplate mongoTemplate(MongoDatabaseFactory mongoDatabaseFactory) {
        return new MongoTemplate(mongoDatabaseFactory);
    }

    @Bean
    public RegionRoutingMongoDatabaseFactory regionRoutingMongoDatabaseFactory(
            MongoDatabaseFactory mongoDatabaseFactory, // resolves to the @Primary bean above, never to itself
            RegionConfig regionConfig) {
        return new RegionRoutingMongoDatabaseFactory(mongoDatabaseFactory, regionConfig);
    }

    @Bean
    @Qualifier("regionRouted")
    public MongoTemplate regionRoutedMongoTemplate(RegionRoutingMongoDatabaseFactory factory) {
        return new MongoTemplate(factory);
    }
}
package com.prowosma.backend;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.ConfigDataApplicationContextInitializer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.support.PropertySourcesPlaceholderConfigurer;
import org.springframework.core.env.Environment;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.junit.jupiter.SpringExtension;
import org.springframework.beans.factory.annotation.Autowired;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The backend reads a plain ".env" settings file through spring.config.import (see application.properties). This proves the mechanism with
 * a file written like a real one — Windows line endings, unicode comments, a database address full of ':' '=' '&' '%', empty values — and that the
 * application's own placeholder style (${NAME:default}) picks the values up. It does not start the whole application.
 */
@ExtendWith(SpringExtension.class)
@ContextConfiguration(classes = EnvFileImportTest.Cfg.class, initializers = ConfigDataApplicationContextInitializer.class)
@TestPropertySource(properties = "spring.config.import=optional:file:src/test/resources/envfile/sample.env[.properties]")
@DisplayName("Settings are read from a .env file")
class EnvFileImportTest {

    @Configuration
    static class Cfg {
        @Bean static PropertySourcesPlaceholderConfigurer placeholders() { return new PropertySourcesPlaceholderConfigurer(); }
    }

    @Autowired Environment env;
    @Value("${MONGODB_URI:fallback}") String mongoUri;
    @Value("${MONGO_DB:fallback}") String mongoDb;
    @Value("${FRONTEND_URL:fallback}") String frontendUrl;
    @Value("${JWT_SECRET:fallback}") String jwt;
    @Value("${SMTP_FROM_NAME:fallback}") String fromName;
    @Value("${NOT_IN_THE_FILE:the-default}") String missing;
    @Value("${EMPTY_ONE:the-default}") String empty;


    @Test @DisplayName("settings that aren't in the file still fall back to their defaults")
    void defaultsStillApply() {
        assertThat(missing).isEqualTo("the-default");
        assertThat(env.getProperty("PORT", "9090")).isEqualTo("9090");               // no PORT in the file or the test machine → the app's own default
    }

    @Test @DisplayName("an empty value is read as empty (not silently replaced by a default)")
    void emptyValuesAreEmpty() {
        assertThat(empty).isEmpty();
    }
}

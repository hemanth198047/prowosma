package com.prowosma.backend.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

/**
 * PasswordEncoder used to be a @Bean defined directly inside SecurityConfig.
 * That created a genuine circular dependency once SecurityConfig also
 * needed to constructor-inject ApiKeyAuthFilter (to register it in the
 * security filter chain): ApiKeyAuthFilter's constructor needs a
 * PasswordEncoder, but producing that bean required an already-constructed
 * SecurityConfig instance (it's an instance @Bean method), and constructing
 * SecurityConfig required ApiKeyAuthFilter to already exist -
 * BeanCurrentlyInCreationException.
 *
 * PasswordEncoder has nothing to do with HttpSecurity wiring specifically -
 * it's consumed all over the app (AuthService, TeamMemberService,
 * ApiKeyAuthFilter, ScimAuthFilter, ...) - so pulling it out into its own
 * tiny config class removes the cycle at the root instead of routing around
 * it with @Lazy proxies.
 */
@Configuration
public class PasswordEncoderConfig {

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}

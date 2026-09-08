package com.prowosma.backend.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.web.socket.config.annotation.*;

/**
 * WebSocket / STOMP configuration — test profile only.
 *
 * The real (@Profile("!test")) WebSocketConfig now uses
 * enableStompBrokerRelay, which requires a running RabbitMQ instance with
 * its STOMP plugin enabled (see docker-compose.yml). Tests have no such
 * broker available, and — same reasoning as MigrationRunner's
 * @Profile("!test") from the database-operations work earlier in this
 * backlog — this sandbox has no way to actually run the existing test
 * suite to confirm a relay connection attempt (even one that's designed
 * to fail gracefully and retry in the background rather than block
 * startup) doesn't interact with it in some unexpected way.
 *
 * Keeping tests on the original SimpleBroker is the conservative,
 * verifiable choice: it's exactly what every test has already been
 * running against successfully, so this change introduces zero new
 * behavior for the test suite to be affected by, while still delivering
 * the real fix (the broker relay) for actual deployments.
 */
@Configuration
@Profile("test")
@EnableWebSocketMessageBroker
public class WebSocketTestConfig implements WebSocketMessageBrokerConfigurer {

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        registry.enableSimpleBroker("/topic");
        registry.setApplicationDestinationPrefixes("/app");
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.addEndpoint("/ws")
                .setAllowedOrigins("http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173")
                .withSockJS();
    }
}

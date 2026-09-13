package com.prowosma.backend.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.web.socket.config.annotation.*;

/**
 * WebSocket / STOMP configuration — real deployments (@Profile("!test")).
 * See WebSocketTestConfig for the separate, SimpleBroker-based config used
 * under the "test" profile, and that file's own comment for why the split
 * exists rather than one config used everywhere.
 *
 * Previously: allowed origins hardcoded to localhost:5173 and localhost:3000.
 * Fixed: reads allowed origins from ${app.websocket.allowed-origins} so production
 * deployments don't need a code change.
 *
 * Set in application.properties:
 *   app.websocket.allowed-origins=https://app.prowosma.io,https://staging.prowosma.io
 *
 * For local dev the default fallback keeps localhost working.
 *
 * ── Horizontal scaling: STOMP broker relay instead of SimpleBroker ──
 * Previously used registry.enableSimpleBroker("/topic") — Spring's
 * built-in, in-memory-only broker. That's correct for a single instance,
 * but a message published on instance A (e.g. a doc edit broadcast by
 * DocCollabController) would only ever reach WebSocket clients connected
 * TO instance A — a client connected to instance B behind the same load
 * balancer would never receive it at all, silently. This wasn't a data
 * consistency edge case, it was the real-time collaboration feature
 * simply not working across more than one instance.
 *
 * enableStompBrokerRelay routes /topic messages through an external
 * STOMP-capable broker (RabbitMQ, with its STOMP plugin enabled — see
 * docker-compose.yml's rabbitmq service) that every instance connects to,
 * so a message published on any instance reaches every instance's
 * subscribed clients, not just the publisher's own.
 *
 * The relay is opt-in via app.websocket.broker-relay-enabled (see that
 * property's own comment in application.properties): only docker-compose
 * turns it on, since it's the only setup here that actually runs RabbitMQ.
 * Plain `gradlew bootRun` / IDE local dev falls back to SimpleBroker
 * automatically, so it doesn't need RabbitMQ running to work at all.
 */
@Configuration
@Profile("!test")
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    private final StompAuthChannelInterceptor stompAuthChannelInterceptor;

    public WebSocketConfig(StompAuthChannelInterceptor stompAuthChannelInterceptor) {
        this.stompAuthChannelInterceptor = stompAuthChannelInterceptor;
    }

    @Override
    public void configureClientInboundChannel(org.springframework.messaging.simp.config.ChannelRegistration registration) {
        registration.interceptors(stompAuthChannelInterceptor);
    }

    // Deliberately the SAME property CorsConfig reads (app.cors.allowed-origins /
    // CORS_ORIGINS) rather than a separate app.websocket.allowed-origins —
    // this used to be its own property, defaulting to localhost-only when
    // unset. Spring's STOMP endpoint does its OWN origin check here,
    // completely independent of the main CorsConfigurationSource bean/CORS
    // filter, so a real deployment could have working CORS for every
    // ordinary API call while this separate, easy-to-miss property was
    // never set — exactly what happened: CORS_ORIGINS was correctly set on
    // Render, WS_ORIGINS never was, so this fell back to its localhost
    // default and rejected every production origin with a 403, even though
    // Spring Security's own auth layer (SecurityConfig's /ws/** PUBLIC_PATHS)
    // was already fixed and correctly letting the request through to this
    // point. One property for allowed origins, not two that can silently
    // drift apart, closes this permanently.
    @Value("${app.cors.allowed-origins:http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173}")
    private String allowedOriginsRaw;

    @Value("${app.websocket.relay-host:localhost}")
    private String relayHost;

    @Value("${app.websocket.relay-port:61613}")
    private int relayPort;

    @Value("${app.websocket.relay-login:guest}")
    private String relayLogin;

    @Value("${app.websocket.relay-passcode:guest}")
    private String relayPasscode;

    // Opt-in switch for the relay itself. Previously enableStompBrokerRelay
    // was called unconditionally, so any environment without a real STOMP
    // broker actually running on relayHost:relayPort (e.g. `gradlew bootRun`
    // outside docker-compose, where nothing starts RabbitMQ) logged a
    // "Connection refused" reconnect-storm every few seconds forever — noisy,
    // and it meant local single-instance dev had a hard, easy-to-miss
    // dependency on infra it doesn't actually need for correctness.
    //
    // Default false uses Spring's built-in in-memory SimpleBroker instead,
    // which is correct for exactly one backend instance (any local dev run
    // via gradlew/IDE). docker-compose.yml sets this true — it also runs the
    // rabbitmq service, so the relay is genuinely reachable there — restoring
    // real cross-instance delivery for that multi-instance-representative
    // setup. Set it true (with relay-host/port pointed at a real broker) for
    // any other multi-instance deployment too.
    @Value("${app.websocket.broker-relay-enabled:false}")
    private boolean brokerRelayEnabled;

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        if (brokerRelayEnabled) {
            registry.enableStompBrokerRelay("/topic")
                    .setRelayHost(relayHost)
                    .setRelayPort(relayPort)
                    // "System" login is used for the relay's own internal
                    // control connection (heartbeats etc.), separate from the
                    // per-client login below — same credentials is the
                    // standard default for a single-tenant broker instance
                    // like this one; split them if the broker is ever shared
                    // across more than this application.
                    .setSystemLogin(relayLogin)
                    .setSystemPasscode(relayPasscode)
                    .setClientLogin(relayLogin)
                    .setClientPasscode(relayPasscode);
        } else {
            registry.enableSimpleBroker("/topic");
        }
        registry.setApplicationDestinationPrefixes("/app");
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        String[] origins = allowedOriginsRaw.split(",");
        registry.addEndpoint("/ws")
                .setAllowedOrigins(origins)
                .withSockJS();
    }
}

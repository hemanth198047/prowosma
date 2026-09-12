package com.prowosma.backend.config;

import lombok.RequiredArgsConstructor;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Validates the JWT the frontend sends as a STOMP CONNECT header (see
 * useWebSocket.js's connectHeaders: {@code Authorization: Bearer <token>})
 * and attaches it as the WebSocket session's Principal.
 *
 * Why this exists: opening /ws/** at the Spring Security HTTP layer (see
 * SecurityConfig's PUBLIC_PATHS) was necessary because SockJS's own
 * info/xhr polling transport doesn't carry this app's custom Authorization
 * header the way the axios `client` instance does — but that also meant,
 * before this interceptor, NOTHING was checking who a WebSocket connection
 * actually belonged to. The frontend was faithfully sending a real JWT on
 * every STOMP CONNECT frame; the backend just never looked at it. Any
 * client could open a WebSocket connection with no credentials at all.
 *
 * This only validates identity on CONNECT — it does not re-validate on
 * every subsequent SEND/SUBSCRIBE frame. Topic-level authorization (e.g.
 * confirming a subscriber actually belongs to the workspace whose topic
 * they're subscribing to) is a separate concern this does not address; see
 * RealtimeService/DocCollabController for how topics are currently scoped.
 */
@Component
@RequiredArgsConstructor
public class StompAuthChannelInterceptor implements ChannelInterceptor {

    private final JwtUtil jwtUtil;

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor =
                MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);

        if (accessor != null && StompCommand.CONNECT.equals(accessor.getCommand())) {
            String authHeader = accessor.getFirstNativeHeader("Authorization");
            if (authHeader != null && authHeader.startsWith("Bearer ")) {
                String token = authHeader.substring(7);
                if (jwtUtil.isValid(token)) {
                    String email = jwtUtil.extractEmail(token);
                    var auth = new UsernamePasswordAuthenticationToken(email, null, List.of());
                    accessor.setUser(auth);
                }
                // Invalid/expired token: deliberately leave the session with
                // no Principal rather than rejecting the CONNECT outright —
                // matches JwtFilter's own "leave unauthenticated, let
                // downstream decide" behavior for the HTTP side, and avoids
                // hard-disconnecting a client over a token that's merely
                // stale (e.g. mid-refresh) rather than absent.
            }
        }
        return message;
    }
}

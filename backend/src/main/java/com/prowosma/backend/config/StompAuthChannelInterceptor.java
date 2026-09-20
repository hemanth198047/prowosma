package com.prowosma.backend.config;

import com.prowosma.backend.model.Doc;
import com.prowosma.backend.repository.DocRepository;
import com.prowosma.backend.repository.TeamMemberRepository;
import com.prowosma.backend.repository.WorkspaceRepository;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.MessagingException;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.stereotype.Component;

import java.security.Principal;
import java.util.List;
import java.util.Optional;

/**
 * Authenticates and authorises WebSocket (STOMP) traffic.
 *
 * <ul>
 *   <li><b>CONNECT</b> must carry a valid JWT ({@code Authorization: Bearer <token>}, see
 *       useWebSocket.js / useDocCollab.js), which becomes the session's Principal.
 *       A connection without one is refused.</li>
 *   <li><b>SUBSCRIBE</b> and <b>SEND</b> are checked against {@link StompAccessPolicy}:
 *       you may only listen to, or write to, a workspace or document you belong to.</li>
 * </ul>
 *
 * Why this exists: {@code /ws/**} has to be open at the Spring Security HTTP layer (see
 * SecurityConfig's PUBLIC_PATHS) because SockJS's own info/xhr transport doesn't carry
 * this app's Authorization header, so nothing else stands between a WebSocket client and
 * the broker. This used to validate a JWT on CONNECT only if one happened to be present:
 * anonymous connections were let through, and nothing ever asked whether a subscriber had
 * any right to the topic. Anyone who knew a workspace or document id could read its live
 * traffic, and {@code /app/doc/{id}/edit} persists whatever content it is sent, so they
 * could overwrite another workspace's documents too.
 *
 * Denials are thrown as {@link MessagingException}, which Spring turns into a STOMP ERROR
 * frame. Identity is checked once on CONNECT, exactly as before (an already-open connection
 * is not re-validated when its token later expires).
 */
@Component
public class StompAuthChannelInterceptor implements ChannelInterceptor {

    private final JwtUtil jwtUtil;
    private final StompAccessPolicy policy;

    public StompAuthChannelInterceptor(JwtUtil jwtUtil,
                                       DocRepository docRepository,
                                       WorkspaceRepository workspaceRepository,
                                       TeamMemberRepository teamMemberRepository) {
        this.jwtUtil = jwtUtil;
        this.policy = new StompAccessPolicy(new StompAccessPolicy.Directory() {
            @Override
            public Optional<String> workspaceOfDoc(String docId) {
                return docRepository.findById(docId).map(Doc::getWorkspaceId);
            }

            // Same rule WorkspaceFilter applies to the X-Workspace-Id header on HTTP requests:
            // the workspace's owner, or anyone with a team-member record in it.
            @Override
            public boolean isMember(String email, String workspaceId) {
                boolean isOwner = workspaceRepository.findById(workspaceId)
                        .map(ws -> email.equals(ws.getOwnerEmail()))
                        .orElse(false);
                return isOwner || teamMemberRepository.existsByEmailAndOrganizationId(email, workspaceId);
            }
        });
    }

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor =
                MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
        if (accessor == null || accessor.getCommand() == null) {
            return message;                                   // heartbeats and other non-STOMP-command frames
        }

        StompCommand command = accessor.getCommand();
        if (StompCommand.CONNECT.equals(command)) {
            String email = emailFromToken(accessor.getFirstNativeHeader("Authorization"));
            if (email == null) {
                throw new MessagingException("Authentication required");
            }
            accessor.setUser(new UsernamePasswordAuthenticationToken(email, null, List.of()));
        } else if (StompCommand.SUBSCRIBE.equals(command)) {
            if (!policy.canSubscribe(emailOf(accessor), accessor.getDestination())) {
                throw new MessagingException("Access denied");
            }
        } else if (StompCommand.SEND.equals(command)) {
            if (!policy.canSend(emailOf(accessor), accessor.getDestination())) {
                throw new MessagingException("Access denied");
            }
        }
        return message;
    }

    /** The email inside a valid {@code Bearer <jwt>} header, or null. */
    private String emailFromToken(String authHeader) {
        if (authHeader == null || !authHeader.startsWith("Bearer ")) return null;
        String token = authHeader.substring(7);
        return jwtUtil.isValid(token) ? jwtUtil.extractEmail(token) : null;
    }

    private static String emailOf(StompHeaderAccessor accessor) {
        Principal user = accessor.getUser();
        return user == null ? null : user.getName();
    }
}

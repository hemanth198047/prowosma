package com.prowosma.backend.config;

import com.prowosma.backend.model.User;
import com.prowosma.backend.model.WorkspaceConfig;
import com.prowosma.backend.repository.UserRepository;
import com.prowosma.backend.repository.WorkspaceConfigRepository;
import com.prowosma.backend.repository.WorkspaceRepository;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;

/**
 * JwtFilter — validates the JWT, and (when the token carries a session id)
 * validates that session is still real: not revoked, and not idle-timed-out.
 *
 * Tokens issued before session-id support existed have no "sid" claim and
 * skip these extra checks (falling back to plain signature+expiry
 * validation only) so nobody already logged in gets logged out by this
 * change — they'll naturally pick up a sid on their next login.
 */
@Component
@RequiredArgsConstructor
public class JwtFilter extends OncePerRequestFilter {

    private final JwtUtil jwtUtil;
    private final UserRepository userRepository;
    private final WorkspaceRepository workspaceRepository;
    private final WorkspaceConfigRepository workspaceConfigRepository;

    // Avoid writing lastSeenAt on literally every request - only update if
    // it's been at least this long since the last recorded activity.
    private static final long ACTIVITY_UPDATE_THROTTLE_SECONDS = 60;

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {

        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) {
            String token = header.substring(7);
            if (jwtUtil.isValid(token)) {
                String email = jwtUtil.extractEmail(token);
                String sessionId = jwtUtil.extractSessionId(token);

                boolean sessionOk = sessionId == null || validateAndTouchSession(email, sessionId);

                if (sessionOk) {
                    var auth = new UsernamePasswordAuthenticationToken(
                            email, null, List.of());
                    auth.setDetails(new WebAuthenticationDetailsSource()
                            .buildDetails(request));
                    SecurityContextHolder.getContext().setAuthentication(auth);
                }
                // If the session isn't valid (revoked or idle-timed-out),
                // deliberately leave SecurityContextHolder unauthenticated -
                // downstream filters/controllers treat this exactly like a
                // missing/invalid token (401 on protected endpoints), no
                // separate error path needed.
            }
        }
        chain.doFilter(request, response);
    }

    /**
     * Returns true if this session id still exists in the user's live
     * session list and hasn't exceeded the workspace's idle timeout (if
     * one is configured). Updates the session's lastSeenAt as a side
     * effect when it's valid (throttled to avoid a write on every request).
     */
    private boolean validateAndTouchSession(String email, String sessionId) {
        Optional<User> userOpt = userRepository.findByEmail(email);
        if (userOpt.isEmpty()) return false;
        User user = userOpt.get();
        if (user.getLoginSessions() == null) return false;

        User.LoginSession session = user.getLoginSessions().stream()
                .filter(s -> sessionId.equals(s.getId()))
                .findFirst()
                .orElse(null);
        if (session == null) return false; // revoked, or evicted by the concurrency cap

        int timeoutMinutes = sessionTimeoutMinutesFor(email);
        if (timeoutMinutes > 0) {
            LocalDateTime lastSeen = session.getLastSeenAt() != null ? session.getLastSeenAt() : session.getCreatedAt();
            if (ChronoUnit.MINUTES.between(lastSeen, LocalDateTime.now()) >= timeoutMinutes) {
                // Idle too long - evict this specific session and reject.
                user.getLoginSessions().remove(session);
                userRepository.save(user);
                return false;
            }
        }

        LocalDateTime lastSeen = session.getLastSeenAt();
        if (lastSeen == null || ChronoUnit.SECONDS.between(lastSeen, LocalDateTime.now()) >= ACTIVITY_UPDATE_THROTTLE_SECONDS) {
            session.setLastSeenAt(LocalDateTime.now());
            userRepository.save(user);
        }
        return true;
    }

    /** Same "owned workspace" convention used for password expiry and the concurrency cap - see PasswordPolicyService/AuthService for the reasoning. 0 = disabled. */
    private int sessionTimeoutMinutesFor(String email) {
        var owned = workspaceRepository.findByOwnerEmail(email);
        if (owned.isEmpty()) return 0;
        return workspaceConfigRepository.findByWorkspaceId(owned.get(0).getId())
                .map(WorkspaceConfig::getSessionTimeoutMinutes)
                .orElse(0);
    }
}

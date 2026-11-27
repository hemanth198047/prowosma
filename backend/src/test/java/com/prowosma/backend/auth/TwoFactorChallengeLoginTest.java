package com.prowosma.backend.auth;

import com.prowosma.backend.config.JwtUtil;
import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.controller.SecurityController;
import com.prowosma.backend.model.User;
import com.prowosma.backend.repository.UserRepository;
import com.prowosma.backend.repository.WorkspaceRepository;
import com.prowosma.backend.service.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalLong;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Two-step sign-in: the challenge from the password step lets a mistyped code be retried, and a backup code works too. */
class TwoFactorChallengeLoginTest {
    UserRepository users = mock(UserRepository.class);
    PasswordEncoder encoder = mock(PasswordEncoder.class);
    TwoFactorService twoFactor = mock(TwoFactorService.class);
    JwtUtil jwt = new JwtUtil();
    AuthService auth;
    User sam;

    @BeforeEach
    void setUp() {
        ReflectionTestUtils.setField(jwt, "secret", "a-test-secret-that-is-long-enough-for-hs256-0123456789");
        ReflectionTestUtils.setField(jwt, "expiration", 86_400_000L);
        ReflectionTestUtils.setField(jwt, "rememberExpiration", 2_592_000_000L);
        auth = new AuthService(users, mock(WorkspaceRepository.class), encoder, jwt, mock(WorkspaceContext.class), mock(ActivityLogService.class),
                mock(PasswordPolicyService.class), twoFactor, mock(SecurityController.class));
        sam = new User();
        sam.setId("u1"); sam.setName("Sam"); sam.setEmail("sam@acme.com"); sam.setPassword("HASH"); sam.setTwoFactorEnabled(true); sam.setTwoFactorSecret("S");
        when(users.findByEmail("sam@acme.com")).thenReturn(Optional.of(sam));
        when(users.findByEmail(argThat(a -> !"sam@acme.com".equals(a)))).thenReturn(Optional.empty());
        when(users.findByEmailIgnoreCase(any())).thenReturn(Optional.empty());
        when(users.findByEmailIgnoreCase("Sam@Acme.com")).thenReturn(Optional.of(sam));
        when(encoder.matches("right", "HASH")).thenReturn(true);
        when(twoFactor.matchStep("S", "123456")).thenReturn(OptionalLong.of(7));
        when(twoFactor.matchStep(eq("S"), argThat(c -> !"123456".equals(c)))).thenReturn(OptionalLong.empty());
    }

    @Test
    void thePasswordStepHandsBackAChallengeNotASession() {
        Map<String, Object> out = auth.login("sam@acme.com", "right", "ip", "ua", true);
        assertThat(out).doesNotContainKey("token").containsEntry("requiresTwoFactor", true).containsEntry("twoFactorRequired", true).containsEntry("email", "sam@acme.com");
        String challenge = (String) out.get("twoFactorToken");
        assertThat(jwt.extractTwoFactorChallengeEmail(challenge)).isEqualTo("sam@acme.com");
        assertThat(jwt.twoFactorChallengeRemember(challenge)).isTrue();
        assertThat(jwt.isValid(challenge)).isFalse();     // useless as a session
    }

    @Test
    void aWrongCodeCanBeRetriedWithTheSameChallenge() {
        String challenge = (String) auth.login("sam@acme.com", "right", "ip", "ua", false).get("twoFactorToken");
        assertThatThrownBy(() -> auth.completeTwoFactorLoginWithChallenge(challenge, "000000", "ip", "ua")).isInstanceOf(AuthService.InvalidCredentialsException.class);
        verify(twoFactor).recordFailure(sam);
        Map<String, Object> ok = auth.completeTwoFactorLoginWithChallenge(challenge, "123456", "ip", "ua");
        assertThat(ok).containsKey("token");
    }

    @Test
    void anExpiredOrForgedChallengeSendsThePersonBackToThePasswordScreen() {
        assertThatThrownBy(() -> auth.completeTwoFactorLoginWithChallenge("garbage", "123456", "ip", "ua"))
                .isInstanceOf(AuthService.InvalidCredentialsException.class).hasMessageContaining("expired");
        assertThatThrownBy(() -> auth.completeTwoFactorLoginWithChallenge(null, "123456", "ip", "ua")).isInstanceOf(AuthService.InvalidCredentialsException.class);
        // A real session token is not a challenge.
        String session = jwt.generateToken("sam@acme.com");
        assertThatThrownBy(() -> auth.completeTwoFactorLoginWithChallenge(session, "123456", "ip", "ua")).hasMessageContaining("expired");
    }

    @Test
    void theLockoutStillStopsGuessing() {
        String challenge = (String) auth.login("sam@acme.com", "right", "ip", "ua", false).get("twoFactorToken");
        doThrow(new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.TOO_MANY_REQUESTS, "Too many incorrect codes."))
                .when(twoFactor).requireNotLocked(sam);
        assertThatThrownBy(() -> auth.completeTwoFactorLoginWithChallenge(challenge, "123456", "ip", "ua"))
                .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
    }

    @Test
    void theOlderEmailBasedStepStillWorksForAPageOpenedBeforeTheUpdate() {
        auth.login("sam@acme.com", "right", "ip", "ua", false);          // opens the "pending" window the old screen relies on
        assertThat(auth.completeTwoFactorLogin("Sam@Acme.com ", "123456", "ip", "ua", false)).containsKey("token");
    }
}

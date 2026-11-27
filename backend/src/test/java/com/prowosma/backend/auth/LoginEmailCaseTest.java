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

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Signing in must not depend on capital letters or stray spaces in the e-mail address (phones and autofill add both). */
class LoginEmailCaseTest {
    UserRepository users = mock(UserRepository.class);
    WorkspaceRepository workspaces = mock(WorkspaceRepository.class);
    PasswordEncoder encoder = mock(PasswordEncoder.class);
    JwtUtil jwt = mock(JwtUtil.class);
    AuthService auth;
    User stored;

    @BeforeEach
    void setUp() {
        auth = new AuthService(users, workspaces, encoder, jwt, mock(WorkspaceContext.class), mock(ActivityLogService.class),
                mock(PasswordPolicyService.class), mock(TwoFactorService.class), mock(SecurityController.class));
        stored = new User();
        stored.setId("u1"); stored.setName("Sam"); stored.setEmail("sam@acme.com"); stored.setPassword("HASH");
        when(users.findByEmail(any())).thenReturn(Optional.empty());
        when(users.findByEmailIgnoreCase(any())).thenReturn(Optional.empty());
        when(users.findByEmail("sam@acme.com")).thenReturn(Optional.of(stored));
        when(users.findByEmailIgnoreCase("Sam@Acme.com")).thenReturn(Optional.of(stored));
        when(encoder.matches("right", "HASH")).thenReturn(true);
        when(workspaces.findByOwnerEmail(any())).thenReturn(List.of());
        when(jwt.generateToken(anyString(), any(), anyBoolean())).thenReturn("JWT");
        when(jwt.generateToken(anyString())).thenReturn("JWT");
    }

    @Test
    void theAddressAsStoredStillWorks() {
        Map<String, Object> out = auth.login("sam@acme.com", "right", "1.2.3.4", "ua", false);
        assertThat(out).containsEntry("token", "JWT");
    }

    @Test
    void capitalLettersAndSpacesDoNotMatter_andTheSessionIsKeyedByTheStoredAddress() {
        Map<String, Object> out = auth.login("  Sam@Acme.com ", "right", "1.2.3.4", "ua", false);
        assertThat(out).containsEntry("token", "JWT");
        verify(jwt).generateToken(eq("sam@acme.com"), any(), eq(false));   // never the way it was typed
    }

    @Test
    void aWrongPasswordOrUnknownAddressIsStillRefused() {
        assertThatThrownBy(() -> auth.login("Sam@Acme.com", "wrong", "1.2.3.4", "ua", false)).isInstanceOf(AuthService.InvalidCredentialsException.class);
        assertThatThrownBy(() -> auth.login("nobody@acme.com", "right", "1.2.3.4", "ua", false)).isInstanceOf(AuthService.InvalidCredentialsException.class);
        assertThatThrownBy(() -> auth.login(null, "right", "1.2.3.4", "ua", false)).isInstanceOf(AuthService.InvalidCredentialsException.class);
        assertThatThrownBy(() -> auth.login("   ", "right", "1.2.3.4", "ua", false)).isInstanceOf(AuthService.InvalidCredentialsException.class);
    }

    @Test
    void registeringAnAddressThatDiffersOnlyInCaseIsSeenAsAlreadyRegistered() {
        assertThatThrownBy(() -> auth.register("Sam", "Sam@Acme.com", "Password1!", "1.2.3.4", "ua"))
                .isInstanceOf(AuthService.EmailAlreadyRegisteredException.class);
    }
}

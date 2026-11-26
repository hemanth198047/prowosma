package com.prowosma.backend.meetings;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.controller.MeetingController;
import com.prowosma.backend.model.Meeting;
import com.prowosma.backend.repository.MeetingRepository;
import com.prowosma.backend.service.MeetingNotifier;
import com.prowosma.backend.service.OwnershipService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDateTime;
import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class MeetingResendControllerTest {
    @Mock MeetingRepository repo;
    @Mock WorkspaceContext workspace;
    @Mock OwnershipService ownership;
    @Mock MeetingNotifier notifier;
    @InjectMocks MeetingController controller;

    Authentication boss = new UsernamePasswordAuthenticationToken("boss@x.com", "n/a");
    Meeting m;

    @BeforeEach
    void setUp() {
        m = new Meeting();
        m.setId("m1"); m.setWorkspaceId("ws1"); m.setTitle("Review"); m.setStatus("SCHEDULED"); m.setCreatedBy("boss@x.com");
        m.setAttendees(new ArrayList<>(List.of("ann@x.com", "Bob@x.com", "boss@x.com", "bad")));
        lenient().when(repo.findById("m1")).thenReturn(Optional.of(m));
        lenient().when(workspace.getWorkspaceId()).thenReturn("ws1");
        lenient().when(ownership.canModify(any(), any())).thenReturn(true);
        lenient().when(notifier.resend(any(), any(), any())).thenAnswer(i -> {
            Map<String, Boolean> r = new LinkedHashMap<>();
            for (Object a : (Collection<?>) i.getArgument(1)) r.put((String) a, !"bob@x.com".equals(a));
            return r;
        });
    }

    @Test
    @SuppressWarnings("unchecked")
    void sendsToEveryAttendeeExceptTheOrganizer_andReportsWhoFailed() {
        Map<String, Object> r = controller.resendInvites("m1", null, boss);
        assertThat((List<String>) r.get("sent")).containsExactly("ann@x.com");
        assertThat((List<String>) r.get("failed")).containsExactly("bob@x.com");
        verify(repo).save(argThat(x -> x.getInvitesResentAt() != null));
    }

    @Test
    void canBeNarrowedToPeopleActuallyOnTheMeeting() {
        controller.resendInvites("m1", Map.of("emails", List.of("ann@x.com", "stranger@x.com")), boss);
        verify(notifier).resend(any(), eq(new LinkedHashSet<>(List.of("ann@x.com"))), eq("boss@x.com"));
    }

    @Test
    void refusesSomeoneWhoMayNotChangeTheMeeting_andAMeetingOfAnotherWorkspace() {
        when(ownership.canModify(any(), any())).thenReturn(false);
        assertThatThrownBy(() -> controller.resendInvites("m1", null, boss)).isInstanceOfSatisfying(ResponseStatusException.class, e -> assertThat(e.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN));
        m.setWorkspaceId("other");
        assertThatThrownBy(() -> controller.resendInvites("m1", null, boss)).isInstanceOfSatisfying(ResponseStatusException.class, e -> assertThat(e.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND));
        verifyNoInteractions(notifier);
    }

    @Test
    void refusesFinishedMeetings_repeatsWithinAMinute_andNobodyToInvite() {
        m.setStatus("COMPLETED");
        assertThatThrownBy(() -> controller.resendInvites("m1", null, boss)).isInstanceOfSatisfying(ResponseStatusException.class, e -> assertThat(e.getStatusCode()).isEqualTo(HttpStatus.CONFLICT));
        m.setStatus("SCHEDULED"); m.setInvitesResentAt(LocalDateTime.now().minusSeconds(20));
        assertThatThrownBy(() -> controller.resendInvites("m1", null, boss)).isInstanceOfSatisfying(ResponseStatusException.class, e -> assertThat(e.getStatusCode()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS));
        m.setInvitesResentAt(null); m.setAttendees(new ArrayList<>(List.of("boss@x.com")));
        assertThatThrownBy(() -> controller.resendInvites("m1", null, boss)).isInstanceOfSatisfying(ResponseStatusException.class, e -> assertThat(e.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST));
        verifyNoInteractions(notifier);
    }
}

package com.prowosma.backend.meetings;

import com.prowosma.backend.model.Meeting;
import com.prowosma.backend.service.EmailService;
import com.prowosma.backend.service.MeetingNotifier;
import com.prowosma.backend.service.PersonalAlertService;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class MeetingNotifierTest {
    EmailService mail = mock(EmailService.class);
    PersonalAlertService alerts = mock(PersonalAlertService.class);
    MeetingNotifier notifier = new MeetingNotifier(mail, alerts);

    Meeting meeting() {
        Meeting m = new Meeting();
        m.setId("m1"); m.setTitle("Sprint review"); m.setCreatedBy("Boss@x.com");
        m.setMeetingDate(LocalDateTime.of(2026, 11, 26, 9, 30)); m.setDurationMins(30);
        m.setLocation("Room 2 https://meet.google.com/abc-defg-hij");
        m.setAttendees(List.of("ann@x.com", " BOB@x.com ", "not-an-email", "ann@x.com"));
        return m;
    }

    @Test
    void recipientsAreCleanedLowerCasedAndDistinct_andIncludeTheOrganizer() {
        assertThat(MeetingNotifier.recipients(meeting())).containsExactlyInAnyOrder("ann@x.com", "bob@x.com", "boss@x.com");
    }

    @Test
    void onlyNewPeopleNeedAnInvitation() {
        assertThat(MeetingNotifier.newlyAdded(List.of("ann@x.com"), List.of("Ann@x.com", "cy@x.com", "bad"))).containsExactly("cy@x.com");
        assertThat(MeetingNotifier.newlyAdded(null, null)).isEmpty();
    }

    @Test
    void inviteEmailsEachGuestExceptTheOrganizer() throws Exception {
        when(mail.sendHtmlEmail(any(), any(), any(), any())).thenReturn(true);
        int queued = notifier.invite(meeting(), List.of("ann@x.com", "boss@x.com"), "boss@x.com");
        assertThat(queued).isEqualTo(1);
        Thread.sleep(300);
        verify(mail, times(1)).sendHtmlEmail(eq("ann@x.com"), any(), eq("Invitation: Sprint review"), contains("/meetings/earlier?open=m1"));
        verify(mail, times(1)).sendHtmlEmail(eq("ann@x.com"), any(), any(), contains("Open in Prowosma"));
        verify(mail, never()).sendHtmlEmail(eq("boss@x.com"), any(), any(), any());
    }

    @Test
    void inviteCanBeSwitchedOff() {
        ReflectionTestUtils.setField(notifier, "inviteEmails", false);
        assertThat(notifier.invite(meeting(), List.of("ann@x.com"), "boss@x.com")).isZero();
        verifyNoInteractions(mail);
    }

    @Test
    void aFailingMailServerNeverBreaksTheCaller() throws Exception {
        when(mail.sendHtmlEmail(any(), any(), any(), any())).thenThrow(new RuntimeException("smtp down"));
        assertThat(notifier.invite(meeting(), List.of("ann@x.com"), "boss@x.com")).isEqualTo(1);
        Thread.sleep(200);
    }

    @Test
    void titlesAndLocationsCannotInjectMarkupOrHeaders() throws Exception {
        Meeting m = meeting();
        m.setTitle("Hi\r\nBcc: evil@x.com <script>alert(1)</script>");
        m.setLocation("<img src=x onerror=alert(1)> https://ok.example/a");
        when(mail.sendHtmlEmail(any(), any(), any(), any())).thenReturn(true);
        notifier.invite(m, List.of("ann@x.com"), "boss@x.com");
        Thread.sleep(300);
        var subject = org.mockito.ArgumentCaptor.forClass(String.class);
        var html = org.mockito.ArgumentCaptor.forClass(String.class);
        verify(mail).sendHtmlEmail(eq("ann@x.com"), any(), subject.capture(), html.capture());
        assertThat(subject.getValue()).doesNotContain("\r").doesNotContain("\n");
        assertThat(html.getValue()).doesNotContain("<script>").doesNotContain("<img").contains("<a href=\"https://ok.example/a\">");
    }

    @Test
    void remindSendsAPushAndAnEmail_andTheEmailCanBeSwitchedOff() throws Exception {
        notifier.remind(meeting(), "ann@x.com", 10);
        // the notification must open the page that understands ?open= (the assistant dashboard at /meetings ignores it)
        verify(alerts).tell(eq("ann@x.com"), eq("Meeting starting in 10 min"), eq("Sprint review"), eq("/meetings/earlier?open=m1"));
        Thread.sleep(300);
        verify(mail).sendHtmlEmail(eq("ann@x.com"), any(), contains("Starting in 10 min"), any());

        reset(mail, alerts);
        ReflectionTestUtils.setField(notifier, "reminderEmails", false);
        notifier.remind(meeting(), "ann@x.com", 0);
        verify(alerts).tell(eq("ann@x.com"), eq("Meeting starting now"), any(), any());
        Thread.sleep(200);
        verifyNoInteractions(mail);
    }

    @Test
    void resendWaitsForEachMailAndReportsWhoWasReached() {
        when(mail.sendHtmlEmail(eq("ann@x.com"), any(), contains("sent again"), any())).thenReturn(true);
        when(mail.sendHtmlEmail(eq("bob@x.com"), any(), any(), any())).thenReturn(false);          // e.g. on the bounce list
        when(mail.sendHtmlEmail(eq("cy@x.com"), any(), any(), any())).thenThrow(new RuntimeException("smtp down"));
        var result = notifier.resend(meeting(), List.of("ann@x.com", "bob@x.com", "cy@x.com"), "boss@x.com");
        assertThat(result).containsEntry("ann@x.com", true).containsEntry("bob@x.com", false).containsEntry("cy@x.com", false);
    }

    @Test
    void resendNeverMailsMoreThanTheLimitInOneGo() {
        when(mail.sendHtmlEmail(any(), any(), any(), any())).thenReturn(true);
        var many = java.util.stream.IntStream.range(0, 80).mapToObj(i -> "p" + i + "@x.com").toList();
        assertThat(notifier.resend(meeting(), many, "boss@x.com")).hasSize(MeetingNotifier.RESEND_LIMIT);
    }

    @Test
    void resendInviteForAssistantMeetingsCarriesTheJoinLinkAndEscapesTheTitle() {
        when(mail.sendHtmlEmail(any(), any(), any(), any())).thenReturn(true);
        var result = notifier.resendInvite("Test <b>Again</b>", java.time.Instant.parse("2026-11-26T13:30:00Z"), java.time.Instant.parse("2026-11-26T14:00:00Z"),
                "https://meet.google.com/abc-defg-hij", "/meetings/u1", List.of("ann@x.com"), "boss@x.com");
        assertThat(result).containsEntry("ann@x.com", true);
        var html = org.mockito.ArgumentCaptor.forClass(String.class);
        verify(mail).sendHtmlEmail(eq("ann@x.com"), any(), contains("sent again"), html.capture());
        assertThat(html.getValue()).contains("href=\"https://meet.google.com/abc-defg-hij\"").contains("30 min").contains("/meetings/u1").doesNotContain("<b>Again");
    }

    @Test
    void scheduledMeetingGuestsGetOurOwnInvitation_inTheOrganizersTimeZone_butNotTheOrganizer() throws Exception {
        when(mail.sendHtmlEmail(any(), any(), any(), any())).thenReturn(true);
        int queued = notifier.inviteScheduled("Kick-off", java.time.Instant.parse("2026-11-26T13:30:00Z"), java.time.Instant.parse("2026-11-26T14:00:00Z"),
                "Asia/Kolkata", "https://meet.google.com/abc-defg-hij", "/meetings/u1", List.of("Ann@Company.in", "ann@company.in", "boss@x.com", "bob@titan.example"), "Boss@x.com");
        assertThat(queued).isEqualTo(2);
        Thread.sleep(400);
        var html = org.mockito.ArgumentCaptor.forClass(String.class);
        verify(mail).sendHtmlEmail(eq("ann@company.in"), any(), eq("Invitation: Kick-off"), html.capture());
        verify(mail).sendHtmlEmail(eq("bob@titan.example"), any(), eq("Invitation: Kick-off"), anyString());
        verify(mail, never()).sendHtmlEmail(eq("boss@x.com"), any(), any(), any());
        assertThat(html.getValue()).contains("19:00 IST").contains("https://meet.google.com/abc-defg-hij").contains("30 min");
    }

    @Test
    void scheduledInvitationFallsBackToUtcForAnUnknownZone_andCanBeSwitchedOff() {
        when(mail.sendHtmlEmail(any(), any(), any(), any())).thenReturn(true);
        var res = notifier.resendInvite("T", java.time.Instant.parse("2026-11-26T13:30:00Z"), null, null, null, List.of("ann@x.com"), null);
        assertThat(res).containsEntry("ann@x.com", true);
        ReflectionTestUtils.setField(notifier, "inviteEmails", false);
        assertThat(notifier.inviteScheduled("T", null, null, "Not/AZone", null, null, List.of("ann@x.com"), "boss@x.com")).isZero();
    }

    @Test
    void onlyGmailAddressesCountAsGoogleMailboxes() {
        assertThat(MeetingNotifier.isGoogleMailbox("Ann@GMAIL.com")).isTrue();
        assertThat(MeetingNotifier.isGoogleMailbox("ann@googlemail.com")).isTrue();
        assertThat(MeetingNotifier.isGoogleMailbox("ann@company.in")).isFalse();
        assertThat(MeetingNotifier.isGoogleMailbox(null)).isFalse();
    }

    @Test
    void theTimeIsWrittenWhereTheOrganizerIs_withUtcAlongside_andFallsBackToUtc() {
        java.time.LocalDateTime t = java.time.LocalDateTime.of(2026, 11, 30, 9, 30);
        assertThat(MeetingNotifier.whenText(t, "Asia/Kolkata")).isEqualTo("Mon 30 Nov 2026, 15:00 IST (09:30 UTC)");
        assertThat(MeetingNotifier.whenText(t, "Asia/Calcutta")).as("the old name Chrome reports for Kolkata").isEqualTo("Mon 30 Nov 2026, 15:00 IST (09:30 UTC)");
        assertThat(MeetingNotifier.whenText(t, "America/New_York")).isEqualTo("Mon 30 Nov 2026, 04:30 EST (09:30 UTC)");
        assertThat(MeetingNotifier.whenText(java.time.LocalDateTime.of(2026, 7, 1, 9, 30), "America/New_York")).contains("05:30 EDT").contains("(09:30 UTC)");
        assertThat(MeetingNotifier.whenText(t, null)).isEqualTo("Mon 30 Nov 2026, 09:30 UTC");
        assertThat(MeetingNotifier.whenText(t, " ")).isEqualTo("Mon 30 Nov 2026, 09:30 UTC");
        assertThat(MeetingNotifier.whenText(t, "Mars/Olympus")).isEqualTo("Mon 30 Nov 2026, 09:30 UTC");
        assertThat(MeetingNotifier.whenText(t, "UTC")).isEqualTo("Mon 30 Nov 2026, 09:30 UTC");
        // a date line that crosses midnight in the organizer's zone shows the organizer's date, not UTC's
        assertThat(MeetingNotifier.whenText(java.time.LocalDateTime.of(2026, 11, 30, 20, 0), "Asia/Kolkata")).startsWith("Tue 1 Dec 2026, 01:30 IST");
    }

    @Test
    void invitationAndReminderEmailsCarryTheOrganizersTime() throws Exception {
        when(mail.sendHtmlEmail(any(), any(), any(), any())).thenReturn(true);
        Meeting m = meeting();
        m.setMeetingDate(java.time.LocalDateTime.of(2026, 11, 30, 9, 30));
        m.setTimezone("Asia/Kolkata");
        notifier.invite(m, List.of("ann@x.com"), "boss@x.com");
        Thread.sleep(300);
        verify(mail).sendHtmlEmail(eq("ann@x.com"), any(), any(), contains("15:00 IST (09:30 UTC)"));
        reset(mail);
        notifier.remind(m, "ann@x.com", 10);
        Thread.sleep(300);
        verify(mail).sendHtmlEmail(eq("ann@x.com"), any(), any(), contains("15:00 IST (09:30 UTC)"));
    }
}

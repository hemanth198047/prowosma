package com.prowosma.backend.uma.core;

import com.prowosma.backend.uma.model.UmaMeeting;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/** Who may open a meeting: the person who made it, admins, people it was shared with, and now the people it was scheduled with. */
class UmaAccessAttendeeTest {
    final UmaAccess access = new UmaAccess(null, null, null);

    UmaMeeting meeting() {
        UmaMeeting m = new UmaMeeting();
        m.setCreatedBy("client@x.com");
        m.setAttendees(List.of("Me@X.com", " other@x.com "));
        return m;                                           // visibility defaults to PRIVATE
    }

    @Test
    void anInvitedPersonCanOpenAPrivateMeeting_whateverTheCase() {
        assertThat(access.canRead(meeting(), new UmaAccess.Caller("me@x.com", "MEMBER", false))).isTrue();
        assertThat(access.canRead(meeting(), new UmaAccess.Caller("other@x.com", "MEMBER", true))).isTrue();   // even with a restricted profile
    }

    @Test
    void anInvitedPersonCannotManageIt() {
        assertThat(access.canManage(meeting(), new UmaAccess.Caller("me@x.com", "MEMBER", false))).isFalse();
    }

    @Test
    void someoneNotInvitedStillCannotOpenAPrivateMeeting() {
        assertThat(access.canRead(meeting(), new UmaAccess.Caller("stranger@x.com", "MEMBER", false))).isFalse();
        assertThat(access.canRead(meeting(), new UmaAccess.Caller(null, "MEMBER", false))).isFalse();
    }

    @Test
    void theOrganizerAndAdminsAreUnchanged() {
        assertThat(access.canRead(meeting(), new UmaAccess.Caller("client@x.com", "MEMBER", false))).isTrue();
        assertThat(access.canRead(meeting(), new UmaAccess.Caller("boss@x.com", "ADMIN", false))).isTrue();
    }
}

package com.prowosma.backend.uma.core;

import com.prowosma.backend.integration.GoogleHttp;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class UmaCalendarResendTest {
    UmaGoogleHttp http = mock(UmaGoogleHttp.class);
    UmaGoogleAuth auth = mock(UmaGoogleAuth.class);
    UmaCalendar calendar = new UmaCalendar(http, auth);

    UmaCalendarResendTest() throws Exception {
        when(auth.active("o", "boss@x.com")).thenReturn(true);
        when(auth.hasScope(eq("o"), eq("boss@x.com"), any())).thenReturn(true);
        when(auth.accessToken("o", "boss@x.com")).thenReturn("tok");
    }

    @Test
    void addsOnlyThePeopleMissingFromTheEvent_keepingTheOthersAsTheyWere() throws Exception {
        when(http.send(eq("GET"), contains("/events/ev1"), any(), any())).thenReturn(new GoogleHttp.Result(200,
                "{\"id\":\"ev1\",\"attendees\":[{\"email\":\"Ann@x.com\",\"responseStatus\":\"accepted\"}]}"));
        when(http.send(eq("PATCH"), any(), any(), any())).thenReturn(new GoogleHttp.Result(200, "{}"));

        List<String> added = calendar.addMissingAttendees("o", "boss@x.com", "ev1", List.of("ann@x.com", "bob@x.com", "BOB@x.com"));

        assertThat(added).containsExactly("bob@x.com");
        var body = org.mockito.ArgumentCaptor.forClass(String.class);
        var url = org.mockito.ArgumentCaptor.forClass(String.class);
        verify(http).send(eq("PATCH"), url.capture(), any(), body.capture());
        assertThat(url.getValue()).contains("sendUpdates=all");
        assertThat(body.getValue()).contains("accepted").contains("bob@x.com");
    }

    @Test
    void doesNotTouchTheEventWhenEveryoneIsAlreadyOnIt() throws Exception {
        when(http.send(eq("GET"), any(), any(), any())).thenReturn(new GoogleHttp.Result(200, "{\"attendees\":[{\"email\":\"ann@x.com\"}]}"));
        assertThat(calendar.addMissingAttendees("o", "boss@x.com", "ev1", new ArrayList<>(List.of("ann@x.com")))).isEmpty();
        verify(http, never()).send(eq("PATCH"), any(), any(), any());
    }

    @Test
    void listsEverythingOnTheCalendar_timedAndAllDay_butNotCancelledOrDeclined() throws Exception {
        when(http.send(eq("GET"), contains("timeMin="), any(), any())).thenReturn(new GoogleHttp.Result(200, """
            {"items":[
              {"id":"a","summary":"Test Again","status":"confirmed","htmlLink":"https://calendar.google.com/e/a","hangoutLink":"https://meet.google.com/abc-defg-hij",
               "start":{"dateTime":"2026-11-26T19:00:00+05:30"},"end":{"dateTime":"2026-11-26T19:30:00+05:30"},
               "attendees":[{"email":"me@x.com","self":true,"responseStatus":"needsAction"}]},
              {"id":"b","summary":"Holiday","start":{"date":"2026-11-27"},"end":{"date":"2026-11-28"}},
              {"id":"c","summary":"Gone","status":"cancelled","start":{"dateTime":"2026-11-26T10:00:00Z"},"end":{"dateTime":"2026-11-26T11:00:00Z"}},
              {"id":"d","summary":"No thanks","start":{"dateTime":"2026-11-26T10:00:00Z"},"end":{"dateTime":"2026-11-26T11:00:00Z"},
               "attendees":[{"email":"me@x.com","self":true,"responseStatus":"declined"}]}
            ]}"""));
        var out = calendar.listEvents("o", "boss@x.com", java.time.Instant.parse("2026-11-23T00:00:00Z"), java.time.Instant.parse("2026-11-30T00:00:00Z"));
        assertThat(out).extracting(UmaCalendar.Entry::id).containsExactly("a", "b");
        assertThat(out.get(0).start()).isEqualTo(java.time.Instant.parse("2026-11-26T13:30:00Z"));
        assertThat(out.get(0).meetUrl()).isEqualTo("https://meet.google.com/abc-defg-hij");
        assertThat(out.get(0).myResponse()).isEqualTo("needsAction");
        assertThat(out.get(1).allDay()).isTrue();
        assertThat(out.get(1).startDate()).isEqualTo("2026-11-27");
    }
}

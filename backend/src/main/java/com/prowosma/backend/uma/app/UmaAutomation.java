package com.prowosma.backend.uma.app;

import com.prowosma.backend.uma.core.*;
import com.prowosma.backend.uma.model.UmaGoogleConnection;
import com.prowosma.backend.uma.model.UmaJob;
import com.prowosma.backend.uma.model.UmaMeeting;
import com.prowosma.backend.uma.model.UmaStatus;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

/**
 * Hands-off meetings: what happens by itself for a meeting with a time and a link.
 * <ul>
 *   <li>at the start time, the Fireflies notetaker is sent (if chosen) - retried for 20 minutes, since Fireflies only joins a running meeting;</li>
 *   <li>after the end, Google Meet's transcript is looked for (if the person connected Google) and Fireflies' transcript is fetched;</li>
 *   <li>people who switched on calendar import get their upcoming Google Meet meetings added automatically, following reschedules and cancellations.</li>
 * </ul>
 */
@Component
@Slf4j
public class UmaAutomation {
    static final Duration JOIN_PATIENCE = Duration.ofMinutes(20);
    /** While waiting for the first person (or for Fireflies to accept), look this often. */
    static final Duration JOIN_CHECK_EVERY = Duration.ofSeconds(10);
    public static final Duration FIRST_LOOK = Duration.ofMinutes(1);
    static final Duration CALENDAR_EVERY = Duration.ofMinutes(10);
    static final Duration CALENDAR_AHEAD = Duration.ofDays(7);

    private final UmaStore store;
    private final UmaJobQueue queue;
    private final UmaFireflies fireflies;
    private final UmaGoogleMeet googleMeet;
    private final UmaGoogleAuth googleAuth;
    private final UmaCalendar calendar;
    private final MongoTemplate mongo;
    private final UmaMicrosoftAuth microsoft;

    public UmaAutomation(UmaStore store, UmaJobQueue queue, UmaFireflies fireflies, UmaGoogleMeet googleMeet, UmaGoogleAuth googleAuth,
                         UmaCalendar calendar, MongoTemplate mongo, UmaMicrosoftAuth microsoft) {
        this.store = store; this.queue = queue; this.fireflies = fireflies; this.googleMeet = googleMeet; this.googleAuth = googleAuth;
        this.calendar = calendar; this.mongo = mongo; this.microsoft = microsoft;
    }

    /** (Re)plans the automatic steps for a meeting from its time, link and choices. Safe to call again after a change. */
    public String plan(UmaMeeting m) {
        if (m.getStatus() != UmaStatus.CREATED || m.getMeetingUrl() == null) return null;
        String org = m.getOrganizationId(), by = m.getCreatedBy();
        Instant start = m.getMeetingAt() == null ? Instant.now() : m.getMeetingAt();
        StringBuilder note = new StringBuilder();
        if (m.isAutoFireflies() && fireflies.key(org).isPresent()) {
            queue.enqueueAt(org, m.getId(), UmaPipeline.FIREFLIES_JOIN, by, start.isBefore(Instant.now()) ? Instant.now() : start);
            note.append("Fireflies' notetaker will join when it starts. ");
        }
        if (UmaGoogleMeet.meetingCode(m.getMeetingUrl()) != null && googleMeet.connected(org, by)) {
            UmaMeeting.GoogleLink g = m.getGoogle() == null ? new UmaMeeting.GoogleLink() : m.getGoogle();
            g.setRequestedBy(by);
            m.setGoogle(g);
            // Start looking soon after the start: Google says "in progress" until the meeting really ends, which is often earlier than planned.
            Instant check = start.plus(Duration.ofMinutes(1));
            queue.enqueueAt(org, m.getId(), UmaPipeline.FETCH_GOOGLE, by, check.isBefore(Instant.now()) ? Instant.now() : check);
            note.append("Google Meet's transcript is read when it ends. ");
        }
        if (UmaTeams.isTeamsLink(m.getMeetingUrl()) && microsoft.active(org, by)) {
            // Teams doesn't say when a meeting ends: look for its transcript from a few minutes after the start.
            Instant check = start.plus(UmaTeams.FIRST_LOOK);
            queue.enqueueAt(org, m.getId(), UmaPipeline.FETCH_TEAMS, by, check.isBefore(Instant.now()) ? Instant.now() : check);
            note.append("Teams' transcript is read after the meeting (transcription must be on in the meeting). ");
        }
        String text = note.length() == 0 ? "After the meeting, add its recording or transcript here." : note.toString().trim();
        m.setStatusDetail(text);
        store.save(m);
        return text;
    }

    /** Job: send the Fireflies notetaker at the start time. */
    void firefliesJoin(UmaJob job, UmaMeeting m) {
        String org = m.getOrganizationId();
        if (m.getStatus() != UmaStatus.CREATED || !m.isAutoFireflies() || m.getMeetingUrl() == null) { queue.succeed(job); return; }
        if (fireflies.key(org).isEmpty()) {
            note(m, "Fireflies isn't connected any more, so the notetaker wasn't sent.");
            queue.dead(job, "NO_FIREFLIES");
            return;
        }
        Instant start = m.getMeetingAt() == null ? m.getCreatedAt() : m.getMeetingAt();
        // Google Meet: send it the moment the first person is in the call (they can admit it), not at a fixed time.
        java.util.Optional<Boolean> someone = googleMeet.someoneInTheCall(m);
        if (someone.isPresent() && !someone.get()) {
            if (Instant.now().isBefore(start.plus(JOIN_PATIENCE))) {
                if (!"Fireflies' notetaker joins as soon as the first person is in the meeting.".equals(m.getStatusDetail()))
                    note(m, "Fireflies' notetaker joins as soon as the first person is in the meeting.");
                queue.pollAgain(job, JOIN_CHECK_EVERY);
                return;
            }
            note(m, "Nobody joined the meeting within " + JOIN_PATIENCE.toMinutes() + " minutes of its start, so Fireflies wasn't sent. "
                    + "If the meeting is happening, use \"Send Fireflies now\" on this page.");
            queue.dead(job, "NOBODY_JOINED");
            return;
        }
        try {
            fireflies.sendNotetaker(org, m.getMeetingUrl(), m.getTitle());
        } catch (UmaException e) {
            boolean early = "FIREFLIES_BAD_REQUEST".equals(e.getCode()) || e.getStatus() == HttpStatus.SERVICE_UNAVAILABLE
                    || e.getStatus() == HttpStatus.TOO_MANY_REQUESTS;
            if (early && Instant.now().isBefore(start.plus(JOIN_PATIENCE))) {
                note(m, "Waiting for the meeting to start before Fireflies joins…");
                queue.pollAgain(job, JOIN_CHECK_EVERY);
                return;
            }
            note(m, "Fireflies' notetaker couldn't join: " + e.getMessage());
            queue.dead(job, e.getCode());
            store.audit(org, m.getId(), "system", "FIREFLIES_AUTO_JOIN_FAILED", e.getCode());
            return;
        }
        UmaMeeting.FirefliesLink f = m.getFireflies() == null ? new UmaMeeting.FirefliesLink() : m.getFireflies();
        f.setNotetakerSentAt(Instant.now()); f.setNotetakerSentBy("automatic"); f.setChecks(0);
        m.setFireflies(f);
        note(m, "Fireflies' notetaker was sent to the meeting. The transcript is fetched automatically after it ends.");
        queue.succeed(job);
        // Look a few minutes after joining and then regularly: meetings often end before their planned end.
        queue.enqueueAt(org, m.getId(), UmaPipeline.FETCH_FIREFLIES, m.getCreatedBy(), Instant.now().plus(FIRST_LOOK));
        store.audit(org, m.getId(), "system", "FIREFLIES_NOTETAKER_SENT", "automatic");
    }

    static final java.util.Set<String> CAPTURE_JOBS = java.util.Set.of(UmaPipeline.FIREFLIES_JOIN, UmaPipeline.FETCH_FIREFLIES, UmaPipeline.FETCH_GOOGLE, UmaPipeline.FETCH_TEAMS);

    /** Capture steps still waiting for this meeting (automatic Fireflies join, Fireflies or Google transcript checks). */
    public List<UmaJob> pendingCapture(UmaMeeting m) {
        return queue.forMeeting(m.getOrganizationId(), m.getId()).stream()
                .filter(j -> CAPTURE_JOBS.contains(j.getType()) && ("QUEUED".equals(j.getStatus()) || "RUNNING".equals(j.getStatus()))).toList();
    }

    /** Another way of getting this meeting's transcript is still on its way (so one route giving up must not fail the meeting). */
    public boolean otherCapturePending(UmaMeeting m, UmaJob except) {
        return pendingCapture(m).stream().anyMatch(j -> !j.getId().equals(except.getId()));
    }

    /** "Check now": run the waiting transcript checks straight away. */
    public int checkNow(UmaMeeting m) {
        int n = 0;
        for (UmaJob j : pendingCapture(m)) {
            if (UmaPipeline.FIREFLIES_JOIN.equals(j.getType())) continue;          // joining stays tied to the start time
            queue.enqueueAt(m.getOrganizationId(), m.getId(), j.getType(), j.getRequestedBy(), Instant.now());
            n++;
        }
        return n;
    }

    private void note(UmaMeeting m, String text) {
        m.setStatusDetail(text);
        store.save(m);
    }

    /** Adds and updates people's upcoming Google Meet meetings from their calendars (those who switched it on). Runs every few minutes. */
    void syncCalendars() {
        Instant due = Instant.now().minus(CALENDAR_EVERY);
        List<UmaGoogleConnection> people = mongo.find(new Query(Criteria.where("autoImportCalendar").is(true).and("status").is("ACTIVE")
                .orOperator(Criteria.where("lastCalendarSyncAt").is(null), Criteria.where("lastCalendarSyncAt").lt(due))).limit(50), UmaGoogleConnection.class);
        for (UmaGoogleConnection c : people) {
            try {
                int added = syncOne(c);
                c.setLastCalendarSyncNote(added == 0 ? "Up to date." : added + " meeting(s) added.");
            } catch (UmaException e) {
                c.setLastCalendarSyncNote(e.getMessage());
            } catch (RuntimeException e) {
                log.warn("uma calendar sync failed for a connection: {}", e.getClass().getSimpleName());
                c.setLastCalendarSyncNote("The calendar couldn't be read this time.");
            }
            c.setLastCalendarSyncAt(Instant.now());
            googleAuth.save(c);
        }
    }

    public int syncOne(UmaGoogleConnection c) {
        String org = c.getOrganizationId(), who = c.getUserEmail();
        if (!c.getScopes().contains(UmaGoogleAuth.CALENDAR_SCOPE)) throw new UmaException(HttpStatus.CONFLICT, "GOOGLE_NO_CALENDAR",
                "Calendar access wasn't granted - connect Google again and allow Calendar.");
        int added = 0;
        Instant now = Instant.now();
        for (UmaCalendar.Event e : calendar.upcomingMeet(org, who, now.minus(Duration.ofHours(1)), now.plus(CALENDAR_AHEAD))) {
            UmaMeeting existing = mongo.findOne(new Query(Criteria.where("organizationId").is(org).and("calendarEventId").is(e.id())), UmaMeeting.class);
            if (existing != null) {
                if (existing.getStatus() != UmaStatus.CREATED) continue;
                if ("cancelled".equals(e.status())) {
                    queue.cancel(org, existing.getId());
                    store.transition(org, existing.getId(), UmaStatus.CANCELLED, "calendar", "The meeting was cancelled in Google Calendar.", "calendar cancelled");
                    continue;
                }
                boolean moved = !e.start().equals(existing.getMeetingAt()) || (e.end() != null && !e.end().equals(existing.getMeetingEndAt()))
                        || !e.meetUrl().equals(existing.getMeetingUrl());
                if (!existing.getSharedWith().contains(who) && !who.equalsIgnoreCase(existing.getCreatedBy())) {
                    existing.getSharedWith().add(who);                          // another attendee in this workspace: let them see it too
                    store.save(existing);
                }
                if (moved && who.equalsIgnoreCase(existing.getCreatedBy())) {
                    existing.setMeetingAt(e.start()); existing.setMeetingEndAt(e.end()); existing.setMeetingUrl(e.meetUrl());
                    if (e.title() != null) existing.setTitle(e.title());
                    store.save(existing);
                    plan(existing);
                }
                continue;
            }
            if ("cancelled".equals(e.status())) continue;
            UmaMeeting m = new UmaMeeting();
            m.setOrganizationId(org);
            m.setTitle(e.title() == null || e.title().isBlank() ? "Google Meet meeting" : (e.title().length() > 200 ? e.title().substring(0, 200) : e.title()));
            m.setSource("MEETING_LINK");
            m.setProvider("GOOGLE_MEET");
            m.setMeetingUrl(e.meetUrl());
            m.setMeetingAt(e.start());
            m.setMeetingEndAt(e.end());
            m.setCalendarEventId(e.id());
            m.setCalendarLink(e.htmlLink());
            m.setAttendees(e.attendees().stream().limit(200).toList());
            m.setCreatedBy(who);
            m.setAutoFireflies(c.isAutoFireflies());
            try { m = store.save(m); }
            catch (org.springframework.dao.DuplicateKeyException race) { continue; }        // another person's sync added it first
            store.audit(org, m.getId(), "calendar", "MEETING_IMPORTED_FROM_CALENDAR", null);
            plan(m);
            added++;
        }
        return added;
    }
}

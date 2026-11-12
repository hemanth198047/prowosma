package com.prowosma.backend.service;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.Meeting;
import com.prowosma.backend.model.TeamMember;
import com.prowosma.backend.repository.MeetingRepository;
import com.prowosma.backend.repository.TeamMemberRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.*;

/**
 * Free/busy for the scheduling assistant: when each person is already in a meeting.
 * Only times are returned, never titles or attendees, so it shows nothing more than
 * Outlook's default "free/busy" sharing. Times are UTC, like meetingDate.
 */
@Service
@RequiredArgsConstructor
public class AvailabilityService {

    static final int MAX_PEOPLE = 50;
    static final long MAX_RANGE_DAYS = 14;
    private static final int DEFAULT_MINS = 30;

    private final MeetingRepository meetingRepository;
    private final TeamMemberRepository memberRepository;
    private final WorkspaceContext workspaceContext;

    /** One busy interval. */
    public record Busy(LocalDateTime start, LocalDateTime end) { }

    public List<Map<String, Object>> availability(List<String> emails, LocalDateTime from, LocalDateTime to, String excludeMeetingId) {
        String org = workspaceContext.getWorkspaceId();
        if (org == null || org.isBlank()) throw bad("No workspace selected.");
        if (from == null || to == null || !to.isAfter(from)) throw bad("Invalid from/to range");
        if (Duration.between(from, to).toDays() > MAX_RANGE_DAYS) throw bad("Range may span at most " + MAX_RANGE_DAYS + " days");

        List<String> wanted = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (String e : emails == null ? List.<String>of() : emails) {
            if (e == null || e.isBlank()) continue;
            String k = e.trim().toLowerCase();
            if (seen.add(k)) wanted.add(e.trim());
        }
        if (wanted.size() > MAX_PEOPLE) throw bad("Check at most " + MAX_PEOPLE + " people at a time.");

        // Meetings can start before the range and still overlap it; meetings are at most a day long in practice.
        List<Meeting> meetings = meetingRepository.findByWorkspaceIdAndMeetingDateBetweenOrderByMeetingDateAsc(
                org, from.minusDays(1), to);
        Map<String, List<Busy>> busy = busyByEmail(meetings, wanted, from, to, excludeMeetingId);

        Map<String, TeamMember> members = new HashMap<>();
        for (TeamMember m : memberRepository.findByOrganizationId(org))
            if (m.getEmail() != null) members.put(m.getEmail().toLowerCase(), m);

        List<Map<String, Object>> out = new ArrayList<>();
        for (String email : wanted) {
            TeamMember m = members.get(email.toLowerCase());
            Map<String, Object> o = new LinkedHashMap<>();
            o.put("email", email);
            o.put("inWorkspace", m != null);
            o.put("name", m == null ? null : m.getName());
            o.put("timeZone", m == null ? null : m.getTimeZone());
            o.put("availability", m == null ? null : m.getAvailability());
            List<Map<String, String>> blocks = new ArrayList<>();
            for (Busy b : busy.getOrDefault(email.toLowerCase(), List.of()))
                blocks.add(Map.of("start", b.start() + "Z", "end", b.end() + "Z"));
            o.put("busy", blocks);
            out.add(o);
        }
        return out;
    }

    /**
     * Busy intervals per lower-cased email, clipped to [from, to) and merged where they overlap.
     * A person is busy in a meeting they organised (createdBy) or are invited to (attendees).
     * Cancelled meetings and {@code excludeMeetingId} (the meeting being edited) don't count.
     */
    static Map<String, List<Busy>> busyByEmail(List<Meeting> meetings, List<String> emails,
                                               LocalDateTime from, LocalDateTime to, String excludeMeetingId) {
        Set<String> wanted = new HashSet<>();
        for (String e : emails) if (e != null) wanted.add(e.trim().toLowerCase());
        Map<String, List<Busy>> raw = new HashMap<>();
        for (Meeting m : meetings == null ? List.<Meeting>of() : meetings) {
            if (m == null || m.getMeetingDate() == null) continue;
            if ("CANCELLED".equalsIgnoreCase(m.getStatus())) continue;
            if (excludeMeetingId != null && excludeMeetingId.equals(m.getId())) continue;
            LocalDateTime s = m.getMeetingDate();
            int mins = m.getDurationMins() != null && m.getDurationMins() > 0 ? m.getDurationMins() : DEFAULT_MINS;
            LocalDateTime e = s.plusMinutes(mins);
            if (!e.isAfter(from) || !s.isBefore(to)) continue;
            Busy clipped = new Busy(s.isBefore(from) ? from : s, e.isAfter(to) ? to : e);
            Set<String> people = new HashSet<>();
            if (m.getCreatedBy() != null) people.add(m.getCreatedBy().trim().toLowerCase());
            if (m.getAttendees() != null) for (String a : m.getAttendees()) if (a != null) people.add(a.trim().toLowerCase());
            people.retainAll(wanted);
            for (String p : people) raw.computeIfAbsent(p, k -> new ArrayList<>()).add(clipped);
        }
        Map<String, List<Busy>> out = new HashMap<>();
        raw.forEach((k, list) -> out.put(k, merge(list)));
        return out;
    }

    static List<Busy> merge(List<Busy> list) {
        List<Busy> sorted = new ArrayList<>(list);
        sorted.sort(Comparator.comparing(Busy::start));
        List<Busy> out = new ArrayList<>();
        for (Busy b : sorted) {
            if (!out.isEmpty() && !b.start().isAfter(out.get(out.size() - 1).end())) {
                Busy last = out.remove(out.size() - 1);
                out.add(new Busy(last.start(), b.end().isAfter(last.end()) ? b.end() : last.end()));
            } else out.add(b);
        }
        return out;
    }

    private static ResponseStatusException bad(String msg) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, msg);
    }
}

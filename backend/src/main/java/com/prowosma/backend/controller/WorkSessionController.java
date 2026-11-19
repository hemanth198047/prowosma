package com.prowosma.backend.controller;

import com.prowosma.backend.attendance.app.AttendanceService;
import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.WorkSession;
import com.prowosma.backend.service.WorkSessionService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;

/** Start / stop working on a project, and how long each person spent on it. */
@RestController
@RequestMapping("/api/work-sessions")
@RequiredArgsConstructor
public class WorkSessionController {
    private final WorkSessionService service;
    private final WorkspaceContext ws;
    private final AttendanceService attendance;

    private String org() {
        String o = ws.getWorkspaceId();
        if (o == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Choose a workspace.");
        return o;
    }

    @GetMapping("/me")
    public Map<String, Object> me(Authentication auth) {
        return service.me(org(), auth.getName(), attendance.zone(org()), Instant.now());
    }

    @PostMapping("/start")
    public WorkSession start(@RequestBody Map<String, String> body, Authentication auth) {
        return service.start(org(), auth.getName(), body.get("projectId"), body.get("note"), Instant.now());
    }

    @PostMapping("/stop")
    public Map<String, Object> stop(@RequestBody(required = false) Map<String, String> body, Authentication auth) {
        WorkSession s = service.stop(org(), auth.getName(), body == null ? null : body.get("note"), Instant.now(), "SELF");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("stopped", s);
        out.putAll(service.me(org(), auth.getName(), attendance.zone(org()), Instant.now()));
        return out;
    }

    /** Range: from/to as dates (yyyy-MM-dd, inclusive) in the workspace's time zone, or days=N back from today (0 = all time). */
    private Instant[] range(String from, String to, Integer days) {
        ZoneId zone = attendance.zone(org());
        LocalDate today = LocalDate.now(zone);
        try {
            if (from != null && !from.isBlank()) {
                LocalDate f = LocalDate.parse(from), t = to == null || to.isBlank() ? today : LocalDate.parse(to);
                if (t.isBefore(f)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "The end date is before the start date.");
                return new Instant[]{f.atStartOfDay(zone).toInstant(), t.plusDays(1).atStartOfDay(zone).toInstant()};
            }
        } catch (java.time.format.DateTimeParseException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Dates look like 2026-11-19.");
        }
        int d = days == null ? 30 : Math.max(0, Math.min(days, 3650));
        Instant start = d == 0 ? Instant.EPOCH : today.minusDays(d - 1L).atStartOfDay(zone).toInstant();
        return new Instant[]{start, today.plusDays(1).atStartOfDay(zone).toInstant()};
    }

    @GetMapping("/project/{projectId}")
    public Map<String, Object> project(@PathVariable String projectId, @RequestParam(required = false) String from,
                                       @RequestParam(required = false) String to, @RequestParam(required = false) Integer days, Authentication auth) {
        Instant[] r = range(from, to, days);
        return service.forProject(org(), auth.getName(), projectId, r[0], r[1], Instant.now());
    }

    @GetMapping(value = "/export.csv", produces = "text/csv")
    public ResponseEntity<String> export(@RequestParam(required = false) String projectId, @RequestParam(required = false) String from,
                                         @RequestParam(required = false) String to, @RequestParam(required = false) Integer days, Authentication auth) {
        Instant[] r = range(from, to, days);
        ZoneId zone = attendance.zone(org());
        DateTimeFormatter f = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");
        StringBuilder sb = new StringBuilder("Project,Person,Email,Started,Stopped,Minutes,Hours,Note,How it ended\n");
        Instant now = Instant.now();
        for (WorkSession s : service.export(org(), auth.getName(), projectId, r[0], r[1])) {
            long m = s.isRunning() ? Duration.between(s.getStartedAt(), now).toMinutes() : s.getMinutes();
            sb.append(csv(s.getProjectName())).append(',').append(csv(s.getName())).append(',').append(csv(s.getEmail())).append(',')
              .append(f.format(s.getStartedAt().atZone(zone))).append(',').append(s.isRunning() ? "running" : f.format(s.getEndedAt().atZone(zone))).append(',')
              .append(m).append(',').append(String.format(Locale.ROOT, "%.2f", m / 60.0)).append(',').append(csv(s.getNote())).append(',')
              .append(csv(s.isRunning() ? "" : s.getEndedBy())).append('\n');
        }
        return ResponseEntity.ok().header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"project-time.csv\"")
                .contentType(MediaType.parseMediaType("text/csv")).body(sb.toString());
    }

    /** Quotes a CSV cell, and stops spreadsheet formulas (a cell starting with = + - @). */
    public static String csv(String v) {
        if (v == null) return "";
        String s = v.replace("\r", " ").replace("\n", " ");
        if (!s.isEmpty() && "=+-@".indexOf(s.charAt(0)) >= 0) s = "'" + s;
        return "\"" + s.replace("\"", "\"\"") + "\"";
    }

    @DeleteMapping("/{id}")
    public Map<String, String> delete(@PathVariable String id, Authentication auth) {
        service.delete(org(), auth.getName(), id);
        return Map.of("message", "Removed");
    }

    /** Hourly: close sessions somebody forgot to stop (they count as 12 hours, marked AUTO so a manager can fix them). */
    @Scheduled(fixedDelayString = "${app.work-sessions.sweep-ms:3600000}", initialDelayString = "${app.work-sessions.sweep-initial-ms:120000}")
    public void closeForgotten() {
        try { service.closeForgotten(Instant.now()); } catch (RuntimeException ignored) { /* next hour */ }
    }
}

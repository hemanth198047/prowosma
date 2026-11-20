package com.prowosma.backend.attendance.web;

import com.prowosma.backend.attendance.app.AttendanceExport;
import com.prowosma.backend.attendance.app.AttendanceFeature;
import com.prowosma.backend.attendance.app.AttendanceReports;
import com.prowosma.backend.attendance.app.AttendanceService;
import com.prowosma.backend.attendance.app.AttendanceService.Caller;
import com.prowosma.backend.attendance.model.*;
import com.prowosma.backend.config.WorkspaceContext;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Attendance: clock in/out, breaks, corrections, leave, overtime (everyone, for themselves, under /me),
 * approvals (managers for their direct reports, admins and HR for everyone) and rules, floor view and payroll export (admins and HR).
 * Every endpoint except /status answers 404 while the {@code attendance} feature flag is off.
 */
@RestController
@RequestMapping("/api/attendance")
@Tag(name = "Attendance", description = "Clock in/out, breaks, shifts, corrections, leave, overtime and payroll export")
public class AttendanceController {
    private final AttendanceService service;
    private final AttendanceFeature feature;
    private final WorkspaceContext workspace;
    private final AttendanceReports reports;

    public AttendanceController(AttendanceService service, AttendanceFeature feature, WorkspaceContext workspace, AttendanceReports reports) {
        this.service = service; this.feature = feature; this.workspace = workspace; this.reports = reports;
    }

    private Caller who(Authentication auth) {
        String org = workspace.getWorkspaceId();
        feature.require(org);
        if (auth == null) throw AttendanceException.forbidden("Sign in first.");
        return service.caller(org, auth.getName());
    }

    /** Client IP as the proxy saw it: the first X-Forwarded-For entry, else the connection's address. */
    static String ip(HttpServletRequest req) {
        String fwd = req.getHeader("X-Forwarded-For");
        String ip = fwd != null && !fwd.isBlank() ? fwd.split(",")[0].trim() : req.getRemoteAddr();
        return ip == null ? null : ip.length() > 64 ? ip.substring(0, 64) : ip;
    }

    @GetMapping("/status")
    public Map<String, Object> status() {
        return Map.of("enabled", feature.isOn(workspace.getWorkspaceId()));
    }

    // ── me ──────────────────────────────────────────────────────────────

    @GetMapping("/me")
    public Map<String, Object> me(Authentication auth) { return service.me(who(auth)); }

    @PostMapping("/me/clock-in")
    public Map<String, Object> clockIn(Authentication auth, @RequestBody(required = false) AttendanceService.PunchInput in, HttpServletRequest req) {
        return service.clockIn(who(auth), in, ip(req));
    }

    public record OutInput(Double lat, Double lng, Double accuracy) {}

    @PostMapping("/me/clock-out")
    public Map<String, Object> clockOut(Authentication auth, @RequestBody(required = false) OutInput in, HttpServletRequest req) {
        return service.clockOut(who(auth), in == null ? null : in.lat(), in == null ? null : in.lng(), in == null ? null : in.accuracy(), ip(req));
    }

    public record BreakInput(String type, Boolean countAsWork) {}

    @PostMapping("/me/break/start")
    public Map<String, Object> breakStart(Authentication auth, @RequestBody BreakInput in) { return service.startBreak(who(auth), in.type()); }

    @PostMapping("/me/break/end")
    public Map<String, Object> breakEnd(Authentication auth, @RequestBody(required = false) BreakInput in) {
        return service.endBreak(who(auth), in != null && Boolean.TRUE.equals(in.countAsWork()));
    }

    public record IdleInput(Instant since) {}

    @PostMapping("/me/idle")
    public Map<String, Object> idle(Authentication auth, @RequestBody(required = false) IdleInput in) {
        return service.idle(who(auth), in == null ? null : in.since());
    }

    @GetMapping("/me/logs")
    public List<AttendanceLog> myLogs(Authentication auth, @RequestParam(required = false) String from, @RequestParam(required = false) String to) {
        return service.myLogs(who(auth), from, to);
    }

    @GetMapping("/me/requests")
    public List<AttendanceRequest> myRequests(Authentication auth) { return service.myRequests(who(auth)); }

    @PostMapping("/me/corrections")
    public ResponseEntity<AttendanceRequest> correction(Authentication auth, @RequestBody AttendanceService.CorrectionInput in) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.requestCorrection(who(auth), in));
    }

    @PostMapping("/me/leave")
    public ResponseEntity<AttendanceRequest> leave(Authentication auth, @RequestBody AttendanceService.LeaveInput in) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.requestLeave(who(auth), in));
    }

    @PostMapping("/me/requests/{id}/cancel")
    public AttendanceRequest cancel(Authentication auth, @PathVariable String id) { return service.cancel(who(auth), id); }

    public record NoteInput(String note) {}

    @PostMapping("/me/logs/{id}/overtime")
    public AttendanceLog claimOvertime(Authentication auth, @PathVariable String id, @RequestBody(required = false) NoteInput in) {
        return service.claimOvertime(who(auth), id, in == null ? null : in.note());
    }

    @GetMapping("/me/balances")
    public Map<String, Object> balances(Authentication auth) { return service.balances(who(auth)); }

    @GetMapping("/me/call-times")
    public List<AttendanceCallTime> myCallTimes(Authentication auth, @RequestParam(required = false) String from, @RequestParam(required = false) String to) {
        return service.callTimes(who(auth), from, to);
    }

    @GetMapping("/calendar")
    public Map<String, Object> calendar(Authentication auth, @RequestParam String from, @RequestParam String to) {
        return service.calendar(who(auth), from, to);
    }

    // ── approvals (managers, admins, HR) ────────────────────────────────

    @GetMapping("/approvals")
    public Map<String, Object> approvals(Authentication auth) { return service.approvals(who(auth)); }

    public record DecisionInput(Boolean approve, String note) {}

    @PostMapping("/approvals/requests/{id}")
    public AttendanceRequest decide(Authentication auth, @PathVariable String id, @RequestBody DecisionInput in) {
        return service.decide(who(auth), id, Boolean.TRUE.equals(in.approve()), in.note());
    }

    @PostMapping("/approvals/overtime/{logId}")
    public AttendanceLog decideOvertime(Authentication auth, @PathVariable String logId, @RequestBody DecisionInput in) {
        return service.decideOvertime(who(auth), logId, Boolean.TRUE.equals(in.approve()), in.note());
    }

    // ── reports (admins/HR everyone; managers their reports; others themselves) ──
    // Filters (all optional, each may repeat): workspace, person (or email), department, manager, status, workMode, project;
    // late=true, overtime=true, missedClockOut=true; q (name or email contains). See AttendanceReports.

    @GetMapping("/report")
    public List<Map<String, Object>> report(Authentication auth, @RequestParam MultiValueMap<String, String> q) {
        return reports.report(who(auth), filter(q));
    }

    @GetMapping("/report/options")
    public Map<String, Object> reportOptions(Authentication auth, @RequestParam MultiValueMap<String, String> q) {
        return reports.options(who(auth), values(q, "workspace"));
    }

    @GetMapping("/report/export")
    public ResponseEntity<byte[]> export(Authentication auth, @RequestParam MultiValueMap<String, String> q) {
        Caller c = who(auth);
        AttendanceReports.ReportFilter f = filter(q);
        for (Caller in : reports.callers(c, f.workspaces()))
            if (!in.admin()) throw AttendanceException.forbidden("Only workspace admins and HR can export attendance for payroll"
                    + (in == c ? "." : " (you aren't one in every chosen workspace)."));
        List<Map<String, Object>> rows = reports.report(c, f);
        String format = first(q, "format");
        String from = first(q, "from"), to = first(q, "to");
        boolean excel = "xlsx".equalsIgnoreCase(format);
        byte[] body = excel ? AttendanceExport.xlsx(rows, service.zone(c.org())) : AttendanceExport.csv(rows, service.zone(c.org()));
        String name = "attendance" + (from == null ? "" : "-" + from.replaceAll("[^0-9-]", "")) + (to == null ? "" : "-to-" + to.replaceAll("[^0-9-]", ""))
                + (excel ? ".xlsx" : ".csv");
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + name + "\"")
                .contentType(excel ? MediaType.parseMediaType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
                        : MediaType.parseMediaType("text/csv; charset=utf-8"))
                .body(body);
    }

    static AttendanceReports.ReportFilter filter(MultiValueMap<String, String> q) {
        List<String> people = new java.util.ArrayList<>(values(q, "person"));
        people.addAll(values(q, "email"));
        return new AttendanceReports.ReportFilter(first(q, "from"), first(q, "to"), values(q, "workspace"), people,
                values(q, "department"), values(q, "manager"), values(q, "status"), values(q, "workMode"), values(q, "project"),
                "true".equalsIgnoreCase(first(q, "late")), "true".equalsIgnoreCase(first(q, "overtime")),
                "true".equalsIgnoreCase(first(q, "missedClockOut")), first(q, "q"));
    }

    /** Every non-blank value of a parameter, as sent (a department name may contain commas, so values are never split). */
    static List<String> values(MultiValueMap<String, String> q, String key) {
        List<String> raw = q.getOrDefault(key, List.of());
        return raw.stream().filter(v -> v != null && !v.isBlank()).map(String::trim).limit(200).toList();
    }

    static String first(MultiValueMap<String, String> q, String key) {
        List<String> v = values(q, key);
        return v.isEmpty() ? null : v.get(0);
    }

    // ── admin / HR ──────────────────────────────────────────────────────

    @GetMapping("/floor")
    public Map<String, Object> floor(Authentication auth) { return service.floor(who(auth)); }

    @GetMapping("/settings")
    public Map<String, Object> settings(Authentication auth) {
        Caller c = who(auth);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("settings", service.settings(c.org()));
        out.put("effectiveTimezone", service.zone(c.org()).getId());
        out.put("shifts", service.shifts(c.org()));
        out.put("canManage", c.admin());
        return out;
    }

    @PutMapping("/settings")
    public AttendanceSettings saveSettings(Authentication auth, @RequestBody AttendanceSettings in) { return service.saveSettings(who(auth), in); }

    @PostMapping("/shifts")
    public ResponseEntity<AttendanceShift> addShift(Authentication auth, @RequestBody AttendanceShift in) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.saveShift(who(auth), null, in));
    }

    @PutMapping("/shifts/{id}")
    public AttendanceShift saveShift(Authentication auth, @PathVariable String id, @RequestBody AttendanceShift in) {
        return service.saveShift(who(auth), id, in);
    }

    @DeleteMapping("/shifts/{id}")
    public ResponseEntity<Void> deleteShift(Authentication auth, @PathVariable String id) {
        service.deleteShift(who(auth), id);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/call-times")
    public List<AttendanceCallTime> callTimes(Authentication auth, @RequestParam(required = false) String from, @RequestParam(required = false) String to) {
        return service.callTimes(who(auth), from, to);
    }

    @PostMapping("/call-times")
    public ResponseEntity<AttendanceCallTime> addCallTime(Authentication auth, @RequestBody AttendanceService.CallTimeInput in) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.saveCallTime(who(auth), in));
    }

    @DeleteMapping("/call-times/{id}")
    public ResponseEntity<Void> deleteCallTime(Authentication auth, @PathVariable String id) {
        service.deleteCallTime(who(auth), id);
        return ResponseEntity.noContent().build();
    }

    @ExceptionHandler(AttendanceException.class)
    public ResponseEntity<Map<String, Object>> refused(AttendanceException e) {
        return ResponseEntity.status(e.getStatus()).body(Map.of("code", e.getCode(), "message", e.getMessage()));
    }
}

package com.prowosma.backend.attendance.app;

import com.prowosma.backend.attendance.model.*;
import com.prowosma.backend.model.Project;
import com.prowosma.backend.model.Sprint;
import com.prowosma.backend.model.TeamMember;
import com.prowosma.backend.model.Workspace;
import com.prowosma.backend.repository.ProjectRepository;
import com.prowosma.backend.repository.SprintRepository;
import com.prowosma.backend.repository.TeamMemberRepository;
import com.prowosma.backend.repository.UserRepository;
import com.prowosma.backend.repository.WorkspaceRepository;
import com.prowosma.backend.service.VisibilityService;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.time.*;
import java.util.*;

import static com.prowosma.backend.attendance.app.AttendanceRules.*;

/**
 * Clocking in and out, breaks, idle pauses, corrections, leave, overtime and the admin/HR views.
 * Everything is scoped to one workspace. Members see and change only their own records; a manager approves their direct
 * reports' requests; workspace admins and the people listed as HR see and approve everything and set the rules.
 */
@Service
public class AttendanceService {
    private final MongoTemplate mongo;
    private final WorkspaceRepository workspaces;
    private final TeamMemberRepository members;
    private final UserRepository users;
    private final ProjectRepository projects;
    private final SprintRepository sprints;
    private final VisibilityService visibility;
    private final com.prowosma.backend.service.WorkSessionService workSessions;

    public AttendanceService(MongoTemplate mongo, WorkspaceRepository workspaces, TeamMemberRepository members, UserRepository users,
                             ProjectRepository projects, SprintRepository sprints, VisibilityService visibility,
                             com.prowosma.backend.service.WorkSessionService workSessions) {
        this.mongo = mongo; this.workspaces = workspaces; this.members = members; this.users = users;
        this.projects = projects; this.sprints = sprints; this.visibility = visibility; this.workSessions = workSessions;
    }

    // ── who is asking ───────────────────────────────────────────────────

    public record Caller(String org, String email, String name, String role, String memberId, boolean hr) {
        /** Admin or HR: sees everyone, approves anything, sets rules, exports. */
        public boolean admin() { return hr; }
    }

    public Caller caller(String org, String rawEmail) {
        boolean restricted;
        try { restricted = visibility.isRestricted(); } catch (RuntimeException outsideRequest) { restricted = false; }
        return caller(org, rawEmail, restricted);
    }

    /**
     * The same person's rights in ANOTHER workspace than the one the request is for (reports across workspaces):
     * that workspace's own access control decides whether an admin role counts. A lookup error restricts.
     */
    public Caller callerIn(String org, String rawEmail) {
        String email = rawEmail == null ? "" : rawEmail.toLowerCase(Locale.ROOT);
        return caller(org, rawEmail, visibility.scopeFor(email, org).isRestricted());
    }

    private Caller caller(String org, String rawEmail, boolean restricted) {
        String email = rawEmail == null ? "" : rawEmail.toLowerCase(Locale.ROOT);
        Workspace ws = workspaces.findById(org).orElseThrow(AttendanceException::notFound);
        TeamMember tm = members.findAllByEmailAndOrganizationId(rawEmail, org).stream().findFirst().orElse(null);
        String role = email.equalsIgnoreCase(ws.getOwnerEmail()) ? "OWNER" : tm == null ? "NONE" : tm.getRole();
        if ("NONE".equals(role)) throw AttendanceException.forbidden("You're not a member of this workspace.");
        boolean adminRole = ("OWNER".equals(role) || "ADMIN".equals(role)) && !restricted;
        boolean hr = adminRole || settings(org).getHrEmails().stream().anyMatch(e -> e.equalsIgnoreCase(email));
        String name = tm != null && tm.getName() != null ? tm.getName() : users.findByEmail(rawEmail).map(u -> u.getName()).orElse(email);
        return new Caller(org, email, name, role, tm == null ? null : tm.getId(), hr);
    }

    private void requireAdmin(Caller c) {
        if (!c.admin()) throw AttendanceException.forbidden("Only workspace admins and HR can do this.");
    }

    // ── settings, zone, shifts ──────────────────────────────────────────

    public AttendanceSettings settings(String org) {
        AttendanceSettings s = mongo.findOne(new Query(Criteria.where("organizationId").is(org)), AttendanceSettings.class);
        if (s != null) return s;
        s = new AttendanceSettings();
        s.setOrganizationId(org);
        return s;
    }

    public ZoneId zone(String org) {
        AttendanceSettings s = settings(org);
        if (s.getTimezone() != null && !s.getTimezone().isBlank()) return AttendanceRules.zone(s.getTimezone());
        return AttendanceRules.zone(workspaces.findById(org).map(Workspace::getTimezone).orElse("UTC"));
    }

    public LocalDate today(String org) { return LocalDate.now(zone(org)); }

    public List<AttendanceShift> shifts(String org) {
        return mongo.find(new Query(Criteria.where("organizationId").is(org)).with(Sort.by("name")), AttendanceShift.class);
    }

    /** The person's shift: one that names them, else the default shift, else a built-in 10:00-19:00 on the workspace's working days. */
    public AttendanceShift shiftFor(String org, String email) {
        List<AttendanceShift> all = shifts(org);
        for (AttendanceShift s : all) if (s.getMembers().stream().anyMatch(m -> m.equalsIgnoreCase(email))) return s;
        for (AttendanceShift s : all) if (s.isDefaultShift()) return s;
        AttendanceShift builtIn = new AttendanceShift();
        builtIn.setName("Standard");
        builtIn.setOrganizationId(org);
        workspaces.findById(org).ifPresent(ws -> {
            if (ws.getWorkingDays() != null && !ws.getWorkingDays().isEmpty()) builtIn.setDays(new ArrayList<>(ws.getWorkingDays()));
        });
        return builtIn;
    }

    // ── my day ──────────────────────────────────────────────────────────

    private AttendanceLog active(String org, String email) {
        return mongo.findOne(new Query(Criteria.where("organizationId").is(org).and("email").is(email).and("state").in("WORKING", "ON_BREAK"))
                .with(Sort.by(Sort.Direction.DESC, "date")), AttendanceLog.class);
    }

    private AttendanceLog logFor(String org, String email, String date) {
        return mongo.findOne(new Query(Criteria.where("organizationId").is(org).and("email").is(email).and("date").is(date)), AttendanceLog.class);
    }

    private AttendanceLog newLog(Caller c, String email, String name, LocalDate d) {
        AttendanceLog log = new AttendanceLog();
        log.setOrganizationId(c.org());
        log.setEmail(email);
        log.setName(name);
        log.setDate(d.toString());
        ZoneId zone = zone(c.org());
        plan(log, d, zone, shiftFor(c.org(), email), workspaces.findById(c.org()).orElse(null));
        applyCallTime(log, c.org(), email, d);
        return log;
    }

    /** A call time naming this person on this date replaces the shift start (and its buffer replaces the grace). */
    private void applyCallTime(AttendanceLog log, String org, String email, LocalDate d) {
        List<AttendanceCallTime> calls = mongo.find(new Query(Criteria.where("organizationId").is(org).and("date").is(d.toString())), AttendanceCallTime.class);
        calls.stream().filter(ct -> ct.getCrew().stream().anyMatch(e -> e.equalsIgnoreCase(email)))
                .min(Comparator.comparing(AttendanceCallTime::getCallAt))
                .ifPresentOrElse(ct -> {
                    log.setCallTimeId(ct.getId());
                    log.setExpectedStart(ct.getCallAt());
                    log.setGraceMinutes(ct.getBufferMinutes());
                    if (log.getProjectId() == null) { log.setProjectId(ct.getProjectId()); log.setProjectName(ct.getProjectName()); }
                }, () -> log.setCallTimeId(null));
    }

    private AttendanceLog save(AttendanceLog log, Caller c) {
        recompute(log, settings(c.org()), Instant.now());
        return mongo.save(log);
    }

    /** Everything the clock widget needs: today's log (or the open one from yesterday), the shift, the rules and the next call time. */
    public Map<String, Object> me(Caller c) {
        AttendanceSettings s = settings(c.org());
        LocalDate today = today(c.org());
        AttendanceLog log = active(c.org(), c.email());
        if (log == null) log = logFor(c.org(), c.email(), today.toString());
        if (log != null) recompute(log, s, Instant.now());
        AttendanceShift shift = shiftFor(c.org(), c.email());
        AttendanceLog plan = log != null ? log : newLog(c, c.email(), c.name(), today);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("log", log);
        out.put("state", log == null ? "OFF" : log.getState());
        out.put("date", today.toString());
        out.put("timezone", zone(c.org()).getId());
        out.put("shift", Map.of("name", shift.getName(), "start", shift.getStart(), "end", shift.getEnd(), "days", shift.getDays(),
                "graceMinutes", shift.getGraceMinutes()));
        Map<String, Object> todayPlan = new LinkedHashMap<>();
        todayPlan.put("dayType", plan.getDayType());
        todayPlan.put("holidayName", plan.getHolidayName());
        todayPlan.put("expectedStart", plan.getExpectedStart());
        todayPlan.put("expectedEnd", plan.getExpectedEnd());
        todayPlan.put("graceMinutes", plan.getGraceMinutes());
        todayPlan.put("callTimeId", plan.getCallTimeId());
        if (plan.getCallTimeId() != null) {
            AttendanceCallTime ct = mongo.findById(plan.getCallTimeId(), AttendanceCallTime.class);
            if (ct != null) todayPlan.put("callTime", ct);
        }
        todayPlan.put("onLeave", leaveOn(c.org(), c.email(), today) != null);
        out.put("today", todayPlan);
        out.put("rules", Map.of("askWorkMode", s.isAskWorkMode(), "locationMode", s.getLocationMode(), "idleMinutes", s.getIdleMinutes(),
                "idleAction", s.getIdleAction(), "endOfDayReminderMinutes", s.getEndOfDayReminderMinutes(),
                "workModes", WORK_MODES, "breakTypes", BREAK_TYPES));
        out.put("canManage", c.admin());
        out.put("isManager", c.memberId() != null && !directReports(c).isEmpty());
        return out;
    }

    public record PunchInput(String workMode, String projectId, String sprintId, String note, Double lat, Double lng, Double accuracy) {}

    public Map<String, Object> clockIn(Caller c, PunchInput in, String ip) {
        AttendanceSettings s = settings(c.org());
        AttendanceLog open = active(c.org(), c.email());
        if (open != null) {
            String when = open.getDate().equals(today(c.org()).toString()) ? "" : " since " + open.getDate();
            throw AttendanceException.conflict("ALREADY_CLOCKED_IN", "You're already clocked in" + when + ". Clock out first.");
        }
        String mode = upper(in == null ? null : in.workMode());
        if (mode != null && !mode.isBlank() && !WORK_MODES.contains(mode))
            throw AttendanceException.bad("BAD_WORK_MODE", "Choose In office / studio, Remote / WFH or On location / shoot.");
        if ((mode == null || mode.isBlank()) && s.isAskWorkMode())
            throw AttendanceException.bad("WORK_MODE_NEEDED", "Choose where you're working today.");
        AttendanceLog.Geo geo = geo(in == null ? null : in.lat(), in == null ? null : in.lng(), in == null ? null : in.accuracy(), s);
        if ("REQUIRED_ON_LOCATION".equals(s.getLocationMode()) && "ON_LOCATION".equals(mode) && geo == null)
            throw AttendanceException.bad("LOCATION_NEEDED", "Allow location so your on-location clock-in can be recorded.");

        LocalDate d = today(c.org());
        AttendanceLog log = logFor(c.org(), c.email(), d.toString());
        if (log == null) log = newLog(c, c.email(), c.name(), d);
        if (mode != null && !mode.isBlank()) log.setWorkMode(mode);
        if (in != null && in.projectId() != null && !in.projectId().isBlank()) {
            Project p = projects.findById(in.projectId()).filter(x -> c.org().equals(x.getOrganizationId()))
                    .orElseThrow(() -> AttendanceException.bad("BAD_PROJECT", "That project isn't in this workspace."));
            log.setProjectId(p.getId()); log.setProjectName(p.getName());
        }
        if (in != null && in.sprintId() != null && !in.sprintId().isBlank()) {
            Sprint sp = sprints.findById(in.sprintId()).filter(x -> c.org().equals(x.getOrganizationId()))
                    .orElseThrow(() -> AttendanceException.bad("BAD_SPRINT", "That sprint isn't in this workspace."));
            log.setSprintId(sp.getId()); log.setSprintName(sp.getName());
        }
        if (in != null && in.note() != null && !in.note().isBlank()) log.setNote(clip(in.note(), 500));
        AttendanceLog.Session session = new AttendanceLog.Session();
        session.setIn(Instant.now());
        session.setInIp(ip);
        session.setInGeo(geo);
        log.getSessions().add(session);
        log.setState("WORKING");
        try { save(log, c); }
        catch (DuplicateKeyException race) { throw AttendanceException.conflict("ALREADY_CLOCKED_IN", "You're already clocked in."); }
        return me(c);
    }

    public Map<String, Object> clockOut(Caller c, Double lat, Double lng, Double accuracy, String ip) {
        AttendanceLog log = active(c.org(), c.email());
        if (log == null) throw AttendanceException.conflict("NOT_CLOCKED_IN", "You aren't clocked in.");
        Instant now = Instant.now();
        AttendanceLog.Break b = log.openBreak();
        if (b != null) b.setEnd(now);
        AttendanceLog.Session session = log.openSession();
        if (session != null) {
            session.setOut(now);
            session.setOutIp(ip);
            session.setOutGeo(geo(lat, lng, accuracy, settings(c.org())));
        }
        log.setState("OFF");
        save(log, c);
        workSessions.stop(c.org(), c.email(), null, now, "CLOCKED_OUT");     // clocking out of the day also stops the project timer
        return me(c);
    }

    public Map<String, Object> startBreak(Caller c, String type) {
        String t = upper(type);
        if (t == null || !BREAK_TYPES.contains(t)) throw AttendanceException.bad("BAD_BREAK", "Choose Lunch, Tea / coffee or Other.");
        AttendanceLog log = active(c.org(), c.email());
        if (log == null) throw AttendanceException.conflict("NOT_CLOCKED_IN", "Clock in before taking a break.");
        if ("ON_BREAK".equals(log.getState())) throw AttendanceException.conflict("ALREADY_ON_BREAK", "You're already on a break.");
        AttendanceLog.Break b = new AttendanceLog.Break();
        b.setType(t);
        b.setStart(Instant.now());
        log.getBreaks().add(b);
        log.setState("ON_BREAK");
        save(log, c);
        return me(c);
    }

    /** Ends the break. {@code countAsWork} drops an automatic idle pause entirely (the person says they were working). */
    public Map<String, Object> endBreak(Caller c, boolean countAsWork) {
        AttendanceLog log = active(c.org(), c.email());
        if (log == null || !"ON_BREAK".equals(log.getState())) throw AttendanceException.conflict("NOT_ON_BREAK", "You aren't on a break.");
        AttendanceLog.Break b = log.openBreak();
        if (b != null) {
            if (countAsWork && b.isAuto()) log.getBreaks().remove(b);
            else b.setEnd(Instant.now());
        }
        log.setState("WORKING");
        save(log, c);
        return me(c);
    }

    /** The browser saw no activity since {@code since}. With "pause" rules this starts an automatic break from then. */
    public Map<String, Object> idle(Caller c, Instant since) {
        AttendanceSettings s = settings(c.org());
        AttendanceLog log = active(c.org(), c.email());
        if (log == null || !"WORKING".equals(log.getState()) || !"PAUSE".equals(s.getIdleAction()) || s.getIdleMinutes() <= 0) return me(c);
        Instant now = Instant.now();
        AttendanceLog.Session session = log.openSession();
        Instant start = since == null || since.isAfter(now) ? now : since;
        if (session != null && start.isBefore(session.getIn())) start = session.getIn();
        for (AttendanceLog.Break prev : log.getBreaks()) if (prev.getEnd() != null && start.isBefore(prev.getEnd())) start = prev.getEnd();
        AttendanceLog.Break b = new AttendanceLog.Break();
        b.setType("IDLE");
        b.setStart(start);
        b.setAuto(true);
        log.getBreaks().add(b);
        log.setState("ON_BREAK");
        save(log, c);
        return me(c);
    }

    public List<AttendanceLog> myLogs(Caller c, String from, String to) {
        return logs(c.org(), c.email(), from, to);
    }

    private List<AttendanceLog> logs(String org, String email, String from, String to) {
        LocalDate f = from == null || from.isBlank() ? today(org).minusDays(30) : date(from);
        LocalDate t = to == null || to.isBlank() ? today(org) : date(to);
        if (t.isBefore(f)) throw AttendanceException.bad("BAD_RANGE", "The end date is before the start date.");
        if (f.plusDays(370).isBefore(t)) throw AttendanceException.bad("BAD_RANGE", "Choose a range of a year or less.");
        Criteria cr = Criteria.where("organizationId").is(org).and("date").gte(f.toString()).lte(t.toString());
        if (email != null) cr = cr.and("email").is(email);
        List<AttendanceLog> list = mongo.find(new Query(cr).with(Sort.by(Sort.Direction.DESC, "date").and(Sort.by("name"))), AttendanceLog.class);
        AttendanceSettings s = settings(org);
        Instant now = Instant.now();
        list.forEach(l -> recompute(l, s, now));
        return list;
    }

    // ── requests: corrections and leave ─────────────────────────────────

    public record CorrectionInput(String date, String clockIn, String clockOut, String reason) {}

    public AttendanceRequest requestCorrection(Caller c, CorrectionInput in) {
        LocalDate d = date(in.date());
        LocalDate today = today(c.org());
        if (d.isAfter(today)) throw AttendanceException.bad("FUTURE_DATE", "You can only correct today or earlier.");
        if (d.isBefore(today.minusDays(60))) throw AttendanceException.bad("TOO_OLD", "Corrections can go back 60 days. Ask HR for older ones.");
        boolean hasIn = in.clockIn() != null && !in.clockIn().isBlank(), hasOut = in.clockOut() != null && !in.clockOut().isBlank();
        if (!hasIn && !hasOut) throw AttendanceException.bad("NOTHING_TO_CORRECT", "Give the clock-in time, the clock-out time, or both.");
        if (hasIn) time(in.clockIn());
        if (hasOut) time(in.clockOut());
        if (in.reason() == null || in.reason().isBlank()) throw AttendanceException.bad("REASON_NEEDED", "Say why the punch was missed.");
        AttendanceRequest r = new AttendanceRequest();
        r.setOrganizationId(c.org());
        r.setKind("REGULARIZATION");
        r.setEmail(c.email()); r.setName(c.name());
        r.setDate(d.toString());
        r.setClockIn(hasIn ? time(in.clockIn()).toString() : null);
        r.setClockOut(hasOut ? time(in.clockOut()).toString() : null);
        r.setReason(clip(in.reason(), 500));
        r.setApproverEmail(managerEmail(c));
        return mongo.save(r);
    }

    public record LeaveInput(String fromDate, String toDate, String leaveType, Boolean halfDay, String reason) {}

    public AttendanceRequest requestLeave(Caller c, LeaveInput in) {
        LocalDate f = date(in.fromDate()), t = in.toDate() == null || in.toDate().isBlank() ? f : date(in.toDate());
        if (t.isBefore(f)) throw AttendanceException.bad("BAD_RANGE", "The last day is before the first day.");
        if (f.plusDays(60).isBefore(t)) throw AttendanceException.bad("BAD_RANGE", "Request at most 60 days at a time.");
        if (Boolean.TRUE.equals(in.halfDay()) && !f.equals(t)) throw AttendanceException.bad("HALF_DAY_RANGE", "A half day is a single date.");
        String type = upper(in.leaveType());
        if (type == null || !LEAVE_TYPES.contains(type)) throw AttendanceException.bad("BAD_LEAVE_TYPE", "Choose a leave type.");
        double days = Boolean.TRUE.equals(in.halfDay()) ? 0.5 : workingDays(c.org(), c.email(), f, t);
        if (days == 0) throw AttendanceException.bad("NO_WORKING_DAYS", "Those dates are all weekends or holidays - no leave is needed.");
        boolean overlaps = mongo.exists(new Query(Criteria.where("organizationId").is(c.org()).and("email").is(c.email()).and("kind").is("LEAVE")
                .and("status").in("PENDING", "APPROVED").and("fromDate").lte(t.toString()).and("toDate").gte(f.toString())), AttendanceRequest.class);
        if (overlaps) throw AttendanceException.conflict("LEAVE_OVERLAPS", "You already have leave requested on some of those dates.");
        if (!"UNPAID".equals(type)) {
            double left = balanceLeft(c.org(), c.email(), type, f.getYear());
            if (days > left) throw AttendanceException.conflict("NOT_ENOUGH_BALANCE",
                    "You have " + fmt(left) + " day(s) of " + type.toLowerCase(Locale.ROOT).replace('_', '-') + " left, and this needs " + fmt(days) + ".");
        }
        AttendanceRequest r = new AttendanceRequest();
        r.setOrganizationId(c.org());
        r.setKind("LEAVE");
        r.setEmail(c.email()); r.setName(c.name());
        r.setFromDate(f.toString()); r.setToDate(t.toString());
        r.setLeaveType(type); r.setHalfDay(Boolean.TRUE.equals(in.halfDay())); r.setDays(days);
        r.setReason(clip(in.reason(), 500));
        r.setApproverEmail(managerEmail(c));
        return mongo.save(r);
    }

    public List<AttendanceRequest> myRequests(Caller c) {
        return mongo.find(new Query(Criteria.where("organizationId").is(c.org()).and("email").is(c.email()))
                .with(Sort.by(Sort.Direction.DESC, "createdAt")).limit(200), AttendanceRequest.class);
    }

    public AttendanceRequest cancel(Caller c, String id) {
        AttendanceRequest r = mongo.findById(id, AttendanceRequest.class);
        if (r == null || !c.org().equals(r.getOrganizationId()) || !c.email().equals(r.getEmail())) throw AttendanceException.notFound();
        if (!"PENDING".equals(r.getStatus())) throw AttendanceException.conflict("NOT_PENDING", "Only a request still waiting for approval can be cancelled.");
        r.setStatus("CANCELLED");
        return mongo.save(r);
    }

    public AttendanceLog claimOvertime(Caller c, String logId, String note) {
        AttendanceLog log = mongo.findById(logId, AttendanceLog.class);
        if (log == null || !c.org().equals(log.getOrganizationId()) || !c.email().equals(log.getEmail())) throw AttendanceException.notFound();
        if (!"OFF".equals(log.getState())) throw AttendanceException.conflict("STILL_CLOCKED_IN", "Clock out first, then claim the overtime.");
        recompute(log, settings(c.org()), Instant.now());
        if (log.getOvertimeMinutes() <= 0) throw AttendanceException.conflict("NO_OVERTIME", "There's no overtime on this day.");
        if ("PENDING".equals(log.getOvertimeStatus()) || "APPROVED".equals(log.getOvertimeStatus()))
            throw AttendanceException.conflict("ALREADY_CLAIMED", "This overtime has already been claimed.");
        log.setOvertimeStatus("PENDING");
        log.setOvertimeNote(clip(note, 500));
        return mongo.save(log);
    }

    /** Leave left per type this year, and comp-off earned and used. */
    public Map<String, Object> balances(Caller c) {
        int year = today(c.org()).getYear();
        Map<String, Object> out = new LinkedHashMap<>();
        for (String type : LEAVE_TYPES) {
            if ("UNPAID".equals(type)) continue;
            double total = "COMP_OFF".equals(type) ? compOffEarned(c.org(), c.email()) : settings(c.org()).getLeaveQuota().getOrDefault(type, 0.0);
            double used = leaveUsed(c.org(), c.email(), type, "COMP_OFF".equals(type) ? null : year, "APPROVED");
            double pending = leaveUsed(c.org(), c.email(), type, "COMP_OFF".equals(type) ? null : year, "PENDING");
            out.put(type, Map.of("total", total, "used", used, "pending", pending, "left", Math.max(0, total - used - pending)));
        }
        return out;
    }

    private double balanceLeft(String org, String email, String type, int year) {
        double total = "COMP_OFF".equals(type) ? compOffEarned(org, email) : settings(org).getLeaveQuota().getOrDefault(type, 0.0);
        Integer y = "COMP_OFF".equals(type) ? null : year;
        return total - leaveUsed(org, email, type, y, "APPROVED") - leaveUsed(org, email, type, y, "PENDING");
    }

    private double compOffEarned(String org, String email) {
        return mongo.find(new Query(Criteria.where("organizationId").is(org).and("email").is(email).and("compOffEarned").gt(0)), AttendanceLog.class)
                .stream().mapToDouble(AttendanceLog::getCompOffEarned).sum();
    }

    private double leaveUsed(String org, String email, String type, Integer year, String status) {
        Criteria cr = Criteria.where("organizationId").is(org).and("email").is(email).and("kind").is("LEAVE").and("leaveType").is(type).and("status").is(status);
        if (year != null) cr = cr.and("fromDate").gte(year + "-01-01").lte(year + "-12-31");
        return mongo.find(new Query(cr), AttendanceRequest.class).stream().mapToDouble(AttendanceRequest::getDays).sum();
    }

    /** Working days in a range for this person: shift days that aren't holidays. */
    private double workingDays(String org, String email, LocalDate f, LocalDate t) {
        AttendanceShift shift = shiftFor(org, email);
        Workspace ws = workspaces.findById(org).orElse(null);
        double n = 0;
        for (LocalDate d = f; !d.isAfter(t); d = d.plusDays(1))
            if (shift.getDays().contains(day(d)) && holiday(ws, d) == null) n++;
        return n;
    }

    private AttendanceRequest leaveOn(String org, String email, LocalDate d) {
        return mongo.findOne(new Query(Criteria.where("organizationId").is(org).and("email").is(email).and("kind").is("LEAVE").and("status").is("APPROVED")
                .and("fromDate").lte(d.toString()).and("toDate").gte(d.toString())), AttendanceRequest.class);
    }

    // ── approvals ───────────────────────────────────────────────────────

    private String managerEmail(Caller c) {
        TeamMember me = c.memberId() == null ? null : members.findById(c.memberId()).orElse(null);
        if (me == null || me.getManagerId() == null) return null;
        return members.findById(me.getManagerId()).filter(m -> c.org().equals(m.getOrganizationId()))
                .map(m -> m.getEmail() == null ? null : m.getEmail().toLowerCase(Locale.ROOT)).orElse(null);
    }

    private Set<String> directReports(Caller c) {
        if (c.memberId() == null) return Set.of();
        Set<String> out = new HashSet<>();
        for (TeamMember m : members.findByOrganizationId(c.org()))
            if (c.memberId().equals(m.getManagerId()) && m.getEmail() != null) out.add(m.getEmail().toLowerCase(Locale.ROOT));
        return out;
    }

    private boolean canApprove(Caller c, String ownerEmail) {
        if (c.email().equalsIgnoreCase(ownerEmail)) return false;           // nobody approves their own request
        return c.admin() || directReports(c).contains(ownerEmail.toLowerCase(Locale.ROOT));
    }

    /** Requests and overtime claims this person can approve. */
    public Map<String, Object> approvals(Caller c) {
        Set<String> reports = c.admin() ? null : directReports(c);
        if (reports != null && reports.isEmpty()) return Map.of("requests", List.of(), "overtime", List.of());
        Criteria cr = Criteria.where("organizationId").is(c.org()).and("status").is("PENDING");
        if (reports != null) cr = cr.and("email").in(reports);
        List<AttendanceRequest> reqs = mongo.find(new Query(cr).with(Sort.by("createdAt")).limit(500), AttendanceRequest.class)
                .stream().filter(r -> !c.email().equals(r.getEmail())).toList();
        Criteria ot = Criteria.where("organizationId").is(c.org()).and("overtimeStatus").is("PENDING");
        if (reports != null) ot = ot.and("email").in(reports);
        List<AttendanceLog> overtime = mongo.find(new Query(ot).with(Sort.by("date")).limit(500), AttendanceLog.class)
                .stream().filter(l -> !c.email().equals(l.getEmail())).toList();
        return Map.of("requests", reqs, "overtime", overtime);
    }

    public AttendanceRequest decide(Caller c, String id, boolean approve, String note) {
        AttendanceRequest r = mongo.findById(id, AttendanceRequest.class);
        if (r == null || !c.org().equals(r.getOrganizationId())) throw AttendanceException.notFound();
        if (!canApprove(c, r.getEmail())) throw AttendanceException.forbidden("Only their manager, an admin or HR can decide this request.");
        if (!"PENDING".equals(r.getStatus())) throw AttendanceException.conflict("NOT_PENDING", "This request has already been decided.");
        if (approve && "REGULARIZATION".equals(r.getKind())) applyCorrection(c, r);
        r.setStatus(approve ? "APPROVED" : "REJECTED");
        r.setReviewedBy(c.email());
        r.setReviewedAt(Instant.now());
        r.setReviewNote(clip(note, 500));
        return mongo.save(r);
    }

    /** Writes an approved correction into the person's day. */
    private void applyCorrection(Caller approver, AttendanceRequest r) {
        LocalDate d = date(r.getDate());
        ZoneId zone = zone(r.getOrganizationId());
        AttendanceLog log = logFor(r.getOrganizationId(), r.getEmail(), r.getDate());
        if (log == null) log = newLog(approver, r.getEmail(), r.getName(), d);
        Instant in = r.getClockIn() == null ? null : d.atTime(time(r.getClockIn())).atZone(zone).toInstant();
        Instant out = null;
        if (r.getClockOut() != null) {
            LocalTime o = time(r.getClockOut());
            LocalDate outDay = r.getClockIn() != null && !o.isAfter(time(r.getClockIn())) ? d.plusDays(1) : d;   // overnight
            out = outDay.atTime(o).atZone(zone).toInstant();
        }
        if (in != null && out != null) {
            AttendanceLog.Session s = new AttendanceLog.Session();
            s.setIn(in); s.setOut(out); s.setSource("REGULARIZED");
            final Instant fi = in, fo = out;
            log.getBreaks().removeIf(b -> b.getStart().isBefore(fi) || (b.getEnd() != null && b.getEnd().isAfter(fo)));
            log.setSessions(new ArrayList<>(List.of(s)));
            log.setState("OFF");
        } else if (in != null) {
            if (log.getSessions().isEmpty()) throw AttendanceException.conflict("NEEDS_BOTH",
                    "There's no punch on that day, so both clock-in and clock-out are needed.");
            AttendanceLog.Session first = log.getSessions().stream().min(Comparator.comparing(AttendanceLog.Session::getIn)).get();
            first.setIn(in); first.setSource("REGULARIZED");
        } else {
            AttendanceLog.Session last = log.getSessions().stream().max(Comparator.comparing(AttendanceLog.Session::getIn)).orElse(null);
            if (last == null) throw AttendanceException.conflict("NEEDS_BOTH", "There's no punch on that day, so both clock-in and clock-out are needed.");
            if (!out.isAfter(last.getIn())) out = out.plus(Duration.ofDays(1));
            last.setOut(out); last.setSource("REGULARIZED");
            AttendanceLog.Break b = log.openBreak();
            if (b != null) b.setEnd(out.isAfter(b.getStart()) ? out : b.getStart());
            log.setState("OFF");
        }
        log.setAutoClosed(false);
        recompute(log, settings(r.getOrganizationId()), Instant.now());
        mongo.save(log);
    }

    public AttendanceLog decideOvertime(Caller c, String logId, boolean approve, String note) {
        AttendanceLog log = mongo.findById(logId, AttendanceLog.class);
        if (log == null || !c.org().equals(log.getOrganizationId())) throw AttendanceException.notFound();
        if (!canApprove(c, log.getEmail())) throw AttendanceException.forbidden("Only their manager, an admin or HR can decide this overtime.");
        if (!"PENDING".equals(log.getOvertimeStatus())) throw AttendanceException.conflict("NOT_PENDING", "This overtime has already been decided.");
        AttendanceSettings s = settings(c.org());
        recompute(log, s, Instant.now());
        log.setOvertimeStatus(approve ? "APPROVED" : "REJECTED");
        log.setOvertimeReviewedBy(c.email());
        log.setOvertimeReviewedAt(Instant.now());
        log.setCompOffEarned(approve ? compOffFor(log, s) : 0);
        if (note != null && !note.isBlank()) log.setOvertimeNote(clip((log.getOvertimeNote() == null ? "" : log.getOvertimeNote() + " | ") + "Reviewer: " + note, 1000));
        return mongo.save(log);
    }

    // ── admin / HR ──────────────────────────────────────────────────────

    public record Person(String email, String name, String title, String department) {}

    /** Whose attendance this caller may see: admin/HR everyone; a manager their direct reports and themselves; anyone else themselves. */
    public List<Person> visiblePeople(Caller c) {
        List<Person> who = people(c.org());
        if (c.admin()) return who;
        Set<String> allowed = new HashSet<>(directReports(c));
        allowed.add(c.email());
        return who.stream().filter(p -> allowed.contains(p.email())).toList();
    }

    private List<Person> people(String org) {
        Map<String, Person> out = new LinkedHashMap<>();
        workspaces.findById(org).ifPresent(ws -> {
            if (ws.getOwnerEmail() != null) {
                String e = ws.getOwnerEmail().toLowerCase(Locale.ROOT);
                out.put(e, new Person(e, users.findByEmail(ws.getOwnerEmail()).map(u -> u.getName()).orElse(e), null, null));
            }
        });
        for (TeamMember m : members.findByOrganizationId(org)) {
            if (m.getEmail() == null) continue;
            String e = m.getEmail().toLowerCase(Locale.ROOT);
            out.put(e, new Person(e, m.getName() == null ? e : m.getName(), m.getTitle(), m.getDepartment()));
        }
        return new ArrayList<>(out.values());
    }

    /** Who is in right now: everyone in the workspace with today's state. Refreshed by the screen every 30 seconds. */
    public Map<String, Object> floor(Caller c) {
        requireAdmin(c);
        LocalDate today = today(c.org());
        AttendanceSettings s = settings(c.org());
        Instant now = Instant.now();
        Map<String, AttendanceLog> byEmail = new HashMap<>();
        for (AttendanceLog l : mongo.find(new Query(Criteria.where("organizationId").is(c.org()).and("date").is(today.toString())), AttendanceLog.class))
            byEmail.put(l.getEmail(), l);
        for (AttendanceLog l : mongo.find(new Query(Criteria.where("organizationId").is(c.org()).and("state").in("WORKING", "ON_BREAK")), AttendanceLog.class))
            byEmail.putIfAbsent(l.getEmail(), l);                       // still clocked in from yesterday
        Map<String, AttendanceRequest> leave = new HashMap<>();
        for (AttendanceRequest r : mongo.find(new Query(Criteria.where("organizationId").is(c.org()).and("kind").is("LEAVE").and("status").is("APPROVED")
                .and("fromDate").lte(today.toString()).and("toDate").gte(today.toString())), AttendanceRequest.class)) leave.put(r.getEmail(), r);
        Workspace ws = workspaces.findById(c.org()).orElse(null);
        String holiday = holiday(ws, today);
        List<Map<String, Object>> rows = new ArrayList<>();
        Map<String, Integer> counts = new LinkedHashMap<>();
        for (String k : List.of("WORKING", "ON_BREAK", "DONE", "NOT_IN", "LATE_NOT_IN", "ON_LEAVE", "DAY_OFF")) counts.put(k, 0);
        int late = 0;
        for (Person p : people(c.org())) {
            AttendanceLog l = byEmail.get(p.email());
            if (l != null) recompute(l, s, now);
            String status;
            if (l != null && !"OFF".equals(l.getState())) status = l.getState();
            else if (l != null && !l.getSessions().isEmpty()) status = "DONE";
            else if (leave.containsKey(p.email())) status = "ON_LEAVE";
            else {
                AttendanceShift shift = shiftFor(c.org(), p.email());
                boolean workday = holiday == null && shift.getDays().contains(day(today));
                if (!workday) status = "DAY_OFF";
                else {
                    AttendanceLog plan = new AttendanceLog();
                    plan(plan, today, zone(c.org()), shift, ws);
                    applyCallTime(plan, c.org(), p.email(), today);
                    status = now.isAfter(plan.getExpectedStart().plus(Duration.ofMinutes(plan.getGraceMinutes()))) ? "LATE_NOT_IN" : "NOT_IN";
                }
            }
            counts.merge(status, 1, Integer::sum);
            if (l != null && l.isLate()) late++;
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("email", p.email()); row.put("name", p.name()); row.put("title", p.title()); row.put("department", p.department());
            row.put("status", status);
            if (l != null) {
                row.put("logId", l.getId());
                row.put("since", "WORKING".equals(l.getState()) && l.openSession() != null ? l.openSession().getIn()
                        : "ON_BREAK".equals(l.getState()) && l.openBreak() != null ? l.openBreak().getStart() : null);
                row.put("breakType", l.openBreak() == null ? null : l.openBreak().getType());
                row.put("firstIn", l.firstIn()); row.put("lastOut", l.lastOut());
                row.put("workMode", l.getWorkMode()); row.put("projectName", l.getProjectName());
                row.put("late", l.isLate()); row.put("lateMinutes", l.getLateMinutes());
                row.put("workedMinutes", l.getWorkedMinutes()); row.put("overtimeMinutes", l.getOvertimeMinutes());
                AttendanceLog.Session first = l.getSessions().isEmpty() ? null : l.getSessions().get(0);
                row.put("ip", first == null ? null : first.getInIp());
                row.put("geo", first == null ? null : first.getInGeo());
                row.put("autoClosed", l.isAutoClosed());
            }
            if (leave.containsKey(p.email())) row.put("leaveType", leave.get(p.email()).getLeaveType());
            rows.add(row);
        }
        rows.sort(Comparator.comparing((Map<String, Object> r) -> order((String) r.get("status"))).thenComparing(r -> String.valueOf(r.get("name")).toLowerCase(Locale.ROOT)));
        counts.put("LATE", late);
        return Map.of("date", today.toString(), "holiday", holiday == null ? "" : holiday, "counts", counts, "people", rows, "asOf", now);
    }

    private static int order(String status) {
        return switch (status) { case "WORKING" -> 0; case "ON_BREAK" -> 1; case "LATE_NOT_IN" -> 2; case "NOT_IN" -> 3; case "DONE" -> 4; case "ON_LEAVE" -> 5; default -> 6; };
    }

    /** A nudge for one person: CLOCK_IN_START (the day has begun), CLOCK_IN (their start time passed and they haven't clocked in) or CLOCK_OUT (well past their end, still in). */
    public record Reminder(String email, String kind, String date, String title, String body) {}

    /**
     * Who should be nudged right now. CLOCK_IN: a working day, no leave, nothing punched, and the start (shift or call time) plus its
     * grace has passed - for up to 3 hours. CLOCK_OUT: still clocked in, and the shift end plus the workspace's end-of-day reminder
     * minutes has passed - for up to 3 hours. The caller sends each one once.
     */
    public List<Reminder> reminders(String org, Instant now) {
        List<Reminder> out = new ArrayList<>();
        AttendanceSettings s = settings(org);
        ZoneId zone = zone(org);
        LocalDate today = LocalDate.ofInstant(now, zone);
        Workspace ws = workspaces.findById(org).orElse(null);
        boolean holidayToday = holiday(ws, today) != null;
        Duration window = Duration.ofHours(3);
        for (Person p : people(org)) {
            AttendanceShift shift = shiftFor(org, p.email());
            AttendanceLog active = active(org, p.email());
            if (active != null && "WORKING".equals(active.getState())) {
                AttendanceLog plan = new AttendanceLog();
                LocalDate d = LocalDate.parse(active.getDate());
                plan(plan, d, zone, shift, ws);
                if (plan.getExpectedEnd() != null) {
                    Instant due = plan.getExpectedEnd().plus(Duration.ofMinutes(Math.max(0, s.getEndOfDayReminderMinutes())));
                    if (now.isAfter(due) && now.isBefore(due.plus(window)))
                        out.add(new Reminder(p.email(), "CLOCK_OUT", active.getDate(), "Still clocked in",
                                "Your day was due to end at " + plan.getExpectedEnd().atZone(zone).toLocalTime() + ". Clock out if you've finished."));
                }
                continue;
            }
            if (holidayToday || !shift.getDays().contains(day(today)) || leaveOn(org, p.email(), today) != null) continue;
            AttendanceLog log = logFor(org, p.email(), today.toString());
            if (log != null && (!log.getSessions().isEmpty() || !"OFF".equals(log.getState()))) continue;   // already punched today
            AttendanceLog plan = new AttendanceLog();
            plan(plan, today, zone, shift, ws);
            applyCallTime(plan, org, p.email(), today);
            if (plan.getExpectedStart() == null) continue;
            Instant due = plan.getExpectedStart().plus(Duration.ofMinutes(plan.getGraceMinutes()));
            // A friendly nudge when the day begins (before they count as late), then the "you haven't clocked in" one once the grace has passed.
            if (!now.isBefore(plan.getExpectedStart()) && now.isBefore(due))
                out.add(new Reminder(p.email(), "CLOCK_IN_START", today.toString(), "Time to clock in",
                        "Your day starts at " + plan.getExpectedStart().atZone(zone).toLocalTime() + ". Open Prowosma and clock in."));
            if (now.isAfter(due) && now.isBefore(due.plus(window)))
                out.add(new Reminder(p.email(), "CLOCK_IN", today.toString(), "You haven't clocked in",
                        "Your day started at " + plan.getExpectedStart().atZone(zone).toLocalTime() + ". Open Prowosma to clock in."));
        }
        return out;
    }

    /** How many people are clocked in right now (for the dashboard's "online" number). */
    public long clockedInCount(String org) {
        return mongo.count(new Query(Criteria.where("organizationId").is(org).and("state").in("WORKING", "ON_BREAK")), AttendanceLog.class);
    }

    /**
     * One row per person per day in the range, including days nobody punched: ABSENT (a past working day with no punch and no
     * approved leave), LEAVE, HOLIDAY, WEEKEND. Admin/HR see everyone; a manager sees their direct reports; anyone else only themselves.
     */
    public List<Map<String, Object>> report(Caller c, String from, String to, String onlyEmail) {
        LocalDate f = from == null || from.isBlank() ? today(c.org()).withDayOfMonth(1) : date(from);
        LocalDate t = to == null || to.isBlank() ? today(c.org()) : date(to);
        if (t.isBefore(f)) throw AttendanceException.bad("BAD_RANGE", "The end date is before the start date.");
        if (f.plusDays(92).isBefore(t)) throw AttendanceException.bad("BAD_RANGE", "Choose a range of three months or less.");
        List<Person> who = visiblePeople(c);
        if (onlyEmail != null && !onlyEmail.isBlank()) who = who.stream().filter(p -> p.email().equalsIgnoreCase(onlyEmail.trim())).toList();
        Set<String> emails = new HashSet<>();
        who.forEach(p -> emails.add(p.email()));
        Map<String, AttendanceLog> logs = new HashMap<>();
        AttendanceSettings s = settings(c.org());
        Instant now = Instant.now();
        for (AttendanceLog l : mongo.find(new Query(Criteria.where("organizationId").is(c.org()).and("email").in(emails)
                .and("date").gte(f.toString()).lte(t.toString())), AttendanceLog.class)) {
            recompute(l, s, now);
            logs.put(l.getEmail() + "|" + l.getDate(), l);
        }
        List<AttendanceRequest> leaves = mongo.find(new Query(Criteria.where("organizationId").is(c.org()).and("kind").is("LEAVE").and("status").is("APPROVED")
                .and("email").in(emails).and("fromDate").lte(t.toString()).and("toDate").gte(f.toString())), AttendanceRequest.class);
        Workspace ws = workspaces.findById(c.org()).orElse(null);
        ZoneId zone = zone(c.org());
        LocalDate today = today(c.org());
        List<Map<String, Object>> rows = new ArrayList<>();
        for (Person p : who) {
            AttendanceShift shift = shiftFor(c.org(), p.email());
            for (LocalDate d = f; !d.isAfter(t); d = d.plusDays(1)) {
                AttendanceLog l = logs.get(p.email() + "|" + d);
                final LocalDate day = d;
                AttendanceRequest lv = leaves.stream().filter(r -> r.getEmail().equals(p.email())
                        && !day.isBefore(LocalDate.parse(r.getFromDate())) && !day.isAfter(LocalDate.parse(r.getToDate()))).findFirst().orElse(null);
                String hol = holiday(ws, d);
                boolean workday = hol == null && shift.getDays().contains(day(d));
                String status;
                if (l != null && !l.getSessions().isEmpty()) status = l.isLate() ? "LATE" : "PRESENT";
                else if (lv != null) status = lv.isHalfDay() ? "HALF_DAY_LEAVE" : "LEAVE";
                else if (hol != null) status = "HOLIDAY";
                else if (!workday) status = "WEEKEND";
                else if (d.isBefore(today)) status = "ABSENT";
                else if (d.isAfter(today)) status = "UPCOMING";
                else {
                    AttendanceLog plan = new AttendanceLog();
                    plan(plan, d, zone, shift, ws);
                    status = now.isAfter(plan.getExpectedEnd()) ? "ABSENT" : "NOT_YET_IN";
                }
                if ("UPCOMING".equals(status)) continue;
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("date", d.toString()); row.put("email", p.email()); row.put("name", p.name()); row.put("department", p.department());
                row.put("status", status);
                row.put("holiday", hol);
                row.put("leaveType", lv == null ? null : lv.getLeaveType());
                if (l != null) {
                    row.put("logId", l.getId());
                    row.put("firstIn", l.firstIn()); row.put("lastOut", l.lastOut());
                    row.put("workMode", l.getWorkMode()); row.put("project", l.getProjectName()); row.put("sprint", l.getSprintName());
                    row.put("workedMinutes", l.getWorkedMinutes()); row.put("breakMinutes", l.getBreakMinutes());
                    row.put("lateMinutes", l.getLateMinutes()); row.put("overtimeMinutes", l.getOvertimeMinutes());
                    row.put("overtimeStatus", l.getOvertimeStatus()); row.put("compOffEarned", l.getCompOffEarned());
                    row.put("autoClosed", l.isAutoClosed()); row.put("state", l.getState());
                    row.put("ip", l.getSessions().get(0).getInIp());
                    AttendanceLog.Geo g = l.getSessions().get(0).getInGeo();
                    row.put("location", g == null ? null : g.getLat() + "," + g.getLng());
                }
                rows.add(row);
            }
        }
        rows.sort(Comparator.comparing((Map<String, Object> r) -> (String) r.get("date")).reversed()
                .thenComparing(r -> String.valueOf(r.get("name")).toLowerCase(Locale.ROOT)));
        return rows;
    }

    public AttendanceSettings saveSettings(Caller c, AttendanceSettings in) {
        requireAdmin(c);
        AttendanceSettings s = settings(c.org());
        if (in.getTimezone() != null && !in.getTimezone().isBlank()) {
            try { ZoneId.of(in.getTimezone().trim()); }
            catch (DateTimeException e) { throw AttendanceException.bad("BAD_TIMEZONE", "That time zone isn't recognised (use one like Asia/Kolkata)."); }
            s.setTimezone(in.getTimezone().trim());
        } else s.setTimezone(null);
        s.setAskWorkMode(in.isAskWorkMode());
        String lm = upper(in.getLocationMode());
        if (!List.of("OFF", "OPTIONAL", "REQUIRED_ON_LOCATION").contains(lm)) throw AttendanceException.bad("BAD_LOCATION_MODE", "Unknown location setting.");
        s.setLocationMode(lm);
        s.setIdleMinutes(range(in.getIdleMinutes(), 0, 240, "Idle minutes"));
        String ia = upper(in.getIdleAction());
        if (!List.of("REMIND", "PAUSE").contains(ia)) throw AttendanceException.bad("BAD_IDLE_ACTION", "Idle action must be remind or pause.");
        s.setIdleAction(ia);
        s.setEndOfDayReminderMinutes(range(in.getEndOfDayReminderMinutes(), 0, 600, "End-of-day reminder"));
        s.setAutoClockOutHours(range(in.getAutoClockOutHours(), 4, 24, "Automatic clock-out"));
        s.setOvertimeAfterMinutes(range(in.getOvertimeAfterMinutes(), 60, 1440, "Overtime after"));
        s.setWeekendHolidayOvertime(in.isWeekendHolidayOvertime());
        s.setCompOffEnabled(in.isCompOffEnabled());
        if (in.getLeaveQuota() != null) {
            Map<String, Double> q = new LinkedHashMap<>();
            in.getLeaveQuota().forEach((k, v) -> {
                String t = upper(k);
                if (t != null && LEAVE_TYPES.contains(t) && !"COMP_OFF".equals(t) && !"UNPAID".equals(t) && v != null && v >= 0 && v <= 365) q.put(t, v);
            });
            s.setLeaveQuota(q);
        }
        if (in.getHrEmails() != null)
            s.setHrEmails(in.getHrEmails().stream().filter(Objects::nonNull).map(e -> e.trim().toLowerCase(Locale.ROOT)).filter(e -> e.contains("@")).distinct().limit(50).toList());
        return mongo.save(s);
    }

    public AttendanceShift saveShift(Caller c, String id, AttendanceShift in) {
        requireAdmin(c);
        AttendanceShift s = id == null ? new AttendanceShift() : mongo.findById(id, AttendanceShift.class);
        if (s == null || (id != null && !c.org().equals(s.getOrganizationId()))) throw AttendanceException.notFound();
        s.setOrganizationId(c.org());
        if (in.getName() == null || in.getName().isBlank()) throw AttendanceException.bad("NAME_NEEDED", "Give the shift a name.");
        s.setName(clip(in.getName().trim(), 80));
        LocalTime st = time(in.getStart()), en = time(in.getEnd());
        if (st.equals(en)) throw AttendanceException.bad("BAD_SHIFT", "The shift's start and end can't be the same.");
        s.setStart(st.toString()); s.setEnd(en.toString());
        List<String> days = in.getDays() == null ? List.of() : in.getDays().stream().map(AttendanceRules::upper)
                .filter(d -> List.of("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN").contains(d)).distinct().toList();
        if (days.isEmpty()) throw AttendanceException.bad("NO_DAYS", "Choose at least one working day.");
        s.setDays(new ArrayList<>(days));
        s.setGraceMinutes(range(in.getGraceMinutes(), 0, 240, "Grace period"));
        s.setMembers(in.getMembers() == null ? new ArrayList<>() : new ArrayList<>(in.getMembers().stream().filter(Objects::nonNull)
                .map(e -> e.trim().toLowerCase(Locale.ROOT)).filter(e -> e.contains("@")).distinct().toList()));
        s.setDefaultShift(in.isDefaultShift());
        AttendanceShift saved = mongo.save(s);
        for (AttendanceShift other : shifts(c.org())) {
            if (other.getId().equals(saved.getId())) continue;
            boolean changed = false;
            if (saved.isDefaultShift() && other.isDefaultShift()) { other.setDefaultShift(false); changed = true; }   // one default
            if (other.getMembers().removeAll(saved.getMembers())) changed = true;                                  // one shift per person
            if (changed) mongo.save(other);
        }
        return saved;
    }

    public void deleteShift(Caller c, String id) {
        requireAdmin(c);
        AttendanceShift s = mongo.findById(id, AttendanceShift.class);
        if (s == null || !c.org().equals(s.getOrganizationId())) throw AttendanceException.notFound();
        mongo.remove(s);
    }

    public record CallTimeInput(String projectId, String date, String callTime, Integer bufferMinutes, String location, String note, List<String> crew) {}

    public AttendanceCallTime saveCallTime(Caller c, CallTimeInput in) {
        requireAdmin(c);
        AttendanceCallTime ct = new AttendanceCallTime();
        ct.setOrganizationId(c.org());
        if (in.projectId() != null && !in.projectId().isBlank()) {
            Project p = projects.findById(in.projectId()).filter(x -> c.org().equals(x.getOrganizationId()))
                    .orElseThrow(() -> AttendanceException.bad("BAD_PROJECT", "That project isn't in this workspace."));
            ct.setProjectId(p.getId()); ct.setProjectName(p.getName());
        }
        LocalDate d = date(in.date());
        LocalTime t = time(in.callTime());
        ct.setDate(d.toString());
        ct.setCallTime(t.toString());
        ct.setCallAt(d.atTime(t).atZone(zone(c.org())).toInstant());
        ct.setBufferMinutes(range(in.bufferMinutes() == null ? 15 : in.bufferMinutes(), 0, 240, "Buffer"));
        ct.setLocation(clip(in.location(), 200));
        ct.setNote(clip(in.note(), 500));
        List<String> crew = in.crew() == null ? List.of() : in.crew().stream().filter(Objects::nonNull).map(e -> e.trim().toLowerCase(Locale.ROOT))
                .filter(e -> e.contains("@")).distinct().toList();
        if (crew.isEmpty()) throw AttendanceException.bad("NO_CREW", "Choose who the call time is for.");
        ct.setCrew(new ArrayList<>(crew));
        ct.setCreatedBy(c.email());
        ct = mongo.save(ct);
        refreshPlans(c, d, crew);
        return ct;
    }

    public List<AttendanceCallTime> callTimes(Caller c, String from, String to) {
        LocalDate f = from == null || from.isBlank() ? today(c.org()).minusDays(7) : date(from);
        LocalDate t = to == null || to.isBlank() ? today(c.org()).plusDays(60) : date(to);
        Criteria cr = Criteria.where("organizationId").is(c.org()).and("date").gte(f.toString()).lte(t.toString());
        if (!c.admin()) cr = cr.and("crew").is(c.email());
        return mongo.find(new Query(cr).with(Sort.by("callAt")), AttendanceCallTime.class);
    }

    public void deleteCallTime(Caller c, String id) {
        requireAdmin(c);
        AttendanceCallTime ct = mongo.findById(id, AttendanceCallTime.class);
        if (ct == null || !c.org().equals(ct.getOrganizationId())) throw AttendanceException.notFound();
        mongo.remove(ct);
        refreshPlans(c, LocalDate.parse(ct.getDate()), ct.getCrew());
    }

    /** People who already clocked in on that date get their expected start re-read (a call time added or removed later). */
    private void refreshPlans(Caller c, LocalDate d, List<String> crew) {
        for (AttendanceLog l : mongo.find(new Query(Criteria.where("organizationId").is(c.org()).and("date").is(d.toString()).and("email").in(crew)), AttendanceLog.class)) {
            plan(l, d, zone(c.org()), shiftFor(c.org(), l.getEmail()), workspaces.findById(c.org()).orElse(null));
            applyCallTime(l, c.org(), l.getEmail(), d);
            save(l, c);
        }
    }

    /** Holidays and approved leave in a range, for the calendar. Leave reasons are never shown. */
    public Map<String, Object> calendar(Caller c, String from, String to) {
        LocalDate f = date(from), t = date(to);
        if (t.isBefore(f) || f.plusDays(100).isBefore(t)) throw AttendanceException.bad("BAD_RANGE", "Choose a range of 100 days or less.");
        Workspace ws = workspaces.findById(c.org()).orElse(null);
        List<Map<String, Object>> holidays = new ArrayList<>();
        for (LocalDate d = f; !d.isAfter(t); d = d.plusDays(1)) {
            String h = holiday(ws, d);
            if (h != null) holidays.add(Map.of("date", d.toString(), "name", h));
        }
        List<Map<String, Object>> leave = new ArrayList<>();
        for (AttendanceRequest r : mongo.find(new Query(Criteria.where("organizationId").is(c.org()).and("kind").is("LEAVE").and("status").is("APPROVED")
                .and("fromDate").lte(t.toString()).and("toDate").gte(f.toString())), AttendanceRequest.class)) {
            leave.add(Map.of("email", r.getEmail(), "name", r.getName() == null ? r.getEmail() : r.getName(), "fromDate", r.getFromDate(),
                    "toDate", r.getToDate(), "halfDay", r.isHalfDay(), "leaveType", r.getLeaveType()));
        }
        return Map.of("holidays", holidays, "leave", leave);
    }

    // ── housekeeping ────────────────────────────────────────────────────

    /** Closes sessions nobody clocked out of after the workspace's limit, and flags the day for a correction. */
    public int autoClose(Instant now) {
        int n = 0;
        for (AttendanceLog l : mongo.find(new Query(Criteria.where("state").in("WORKING", "ON_BREAK")).limit(1000), AttendanceLog.class)) {
            AttendanceSettings s = settings(l.getOrganizationId());
            AttendanceLog.Session open = l.openSession();
            if (open == null) { l.setState("OFF"); mongo.save(l); continue; }
            Instant limit = open.getIn().plus(Duration.ofHours(s.getAutoClockOutHours()));
            if (now.isBefore(limit)) continue;
            Instant end = l.getExpectedEnd() != null && l.getExpectedEnd().isAfter(open.getIn()) && l.getExpectedEnd().isBefore(limit) ? l.getExpectedEnd() : limit;
            AttendanceLog.Break b = l.openBreak();
            if (b != null) b.setEnd(end.isAfter(b.getStart()) ? end : b.getStart());
            open.setOut(end);
            open.setSource("AUTO_CLOSED");
            l.setAutoClosed(true);
            l.setState("OFF");
            recompute(l, s, now);
            mongo.save(l);
            n++;
        }
        return n;
    }

    // ── helpers ─────────────────────────────────────────────────────────

    private static AttendanceLog.Geo geo(Double lat, Double lng, Double accuracy, AttendanceSettings s) {
        if ("OFF".equals(s.getLocationMode()) || lat == null || lng == null) return null;
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180 || lat.isNaN() || lng.isNaN()) throw AttendanceException.bad("BAD_LOCATION", "That location isn't valid.");
        AttendanceLog.Geo g = new AttendanceLog.Geo();
        g.setLat(Math.round(lat * 1e5) / 1e5);                         // about one metre; enough to tell office from site
        g.setLng(Math.round(lng * 1e5) / 1e5);
        g.setAccuracy(accuracy == null || accuracy.isNaN() ? null : (double) Math.round(Math.max(0, accuracy)));
        return g;
    }

    private static int range(int v, int min, int max, String what) {
        if (v < min || v > max) throw AttendanceException.bad("OUT_OF_RANGE", what + " must be between " + min + " and " + max + ".");
        return v;
    }

    static String clip(String s, int max) {
        if (s == null) return null;
        String t = s.strip();
        return t.length() > max ? t.substring(0, max) : t;
    }

    private static String fmt(double d) { return d == Math.floor(d) ? String.valueOf((long) d) : String.valueOf(d); }
}

package com.prowosma.backend.service;

import com.prowosma.backend.model.Project;
import com.prowosma.backend.model.TeamMember;
import com.prowosma.backend.model.WorkSession;
import com.prowosma.backend.repository.ProjectRepository;
import com.prowosma.backend.repository.TeamMemberRepository;
import com.prowosma.backend.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.*;
import java.util.*;

/**
 * "Start working" / "Stop" on a project. One running session per person: starting on another project stops the first.
 * The people who manage a project (and workspace admins) see everyone's time on it; everyone else sees their own.
 */
@Service
@RequiredArgsConstructor
public class WorkSessionService {
    /** A session left running longer than this is closed at this length (someone forgot to stop). */
    public static final Duration MAX_SESSION = Duration.ofHours(12);

    private final MongoTemplate mongo;
    private final ProjectRepository projects;
    private final TeamMemberRepository members;
    private final UserRepository users;
    private final VisibilityService visibility;
    private final com.prowosma.backend.repository.WorkspaceRepository workspaces;

    /**
     * Who sees everyone's time on a project: the workspace owner, workspace admins, the project's creator, and - for people with
     * department-scoped access - those who manage the project. Everyone else sees only their own time.
     */
    boolean seesEveryone(Project p, String email) {
        if (p == null || email == null) return false;
        String org = p.getOrganizationId();
        if (workspaces.findById(org).map(w -> email.equalsIgnoreCase(w.getOwnerEmail())).orElse(false)) return true;
        if (members.findByOrganizationId(org).stream().anyMatch(t -> email.equalsIgnoreCase(t.getEmail()) && "ADMIN".equalsIgnoreCase(t.getRole()))) return true;
        if (email.equalsIgnoreCase(p.getCreatedBy())) return true;
        return visibility.isRestricted() && visibility.canManageProject(p);
    }

    @jakarta.annotation.PostConstruct
    void indexes() {
        var ops = mongo.indexOps(WorkSession.class);
        ops.ensureIndex(new org.springframework.data.mongodb.core.index.Index().on("openKey", Sort.Direction.ASC).unique().sparse());
        ops.ensureIndex(new org.springframework.data.mongodb.core.index.Index().on("organizationId", Sort.Direction.ASC).on("projectId", Sort.Direction.ASC).on("startedAt", Sort.Direction.DESC));
        ops.ensureIndex(new org.springframework.data.mongodb.core.index.Index().on("organizationId", Sort.Direction.ASC).on("email", Sort.Direction.ASC).on("startedAt", Sort.Direction.DESC));
    }

    private static String low(String e) { return e == null ? null : e.trim().toLowerCase(Locale.ROOT); }
    private static String key(String org, String email) { return org + "|" + low(email); }

    public WorkSession running(String org, String email) {
        return mongo.findOne(new Query(Criteria.where("openKey").is(key(org, email))), WorkSession.class);
    }

    private Project visibleProject(String org, String projectId) {
        Project p = projectId == null ? null : projects.findById(projectId).orElse(null);
        if (p == null || !org.equals(p.getOrganizationId()) || !visibility.canSeeProject(p))
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Project not found");
        return p;
    }

    private String nameOf(String org, String email) {
        return members.findByOrganizationId(org).stream().filter(t -> email.equalsIgnoreCase(t.getEmail())).map(TeamMember::getName).filter(Objects::nonNull)
                .findFirst().orElseGet(() -> users.findByEmail(email).map(u -> u.getName()).orElse(email));
    }

    /** Starts work on a project, stopping whatever was running (on any project). Starting the one already running changes nothing. */
    public WorkSession start(String org, String rawEmail, String projectId, String note, Instant now) {
        String email = low(rawEmail);
        Project p = visibleProject(org, projectId);
        if (p.isArchived()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "This project is archived.");
        WorkSession cur = running(org, email);
        if (cur != null && cur.getProjectId().equals(p.getId())) return cur;
        if (cur != null) close(cur, now, "SWITCHED");
        WorkSession s = new WorkSession();
        s.setOrganizationId(org); s.setProjectId(p.getId()); s.setProjectName(p.getName());
        s.setEmail(email); s.setName(nameOf(org, email));
        s.setStartedAt(now); s.setNote(clean(note)); s.setOpenKey(key(org, email));
        try { return mongo.insert(s); }
        catch (DuplicateKeyException e) { return running(org, email); }       // two clicks at once: keep the one that won
    }

    /** Stops the running session, if any. */
    public WorkSession stop(String org, String rawEmail, String note, Instant now, String why) {
        WorkSession cur = running(org, low(rawEmail));
        if (cur == null) return null;
        if (note != null && !note.isBlank()) cur.setNote(clean(note));
        return close(cur, now, why);
    }

    private WorkSession close(WorkSession s, Instant now, String why) {
        Instant end = now.isAfter(s.getStartedAt().plus(MAX_SESSION)) ? s.getStartedAt().plus(MAX_SESSION) : now;
        if (end.isBefore(s.getStartedAt())) end = s.getStartedAt();
        s.setEndedAt(end);
        s.setMinutes(Duration.between(s.getStartedAt(), end).toMinutes());
        s.setEndedBy(why);
        s.setOpenKey(null);
        return mongo.save(s);
    }

    /** Closes sessions left running past the limit. Returns how many. */
    public int closeForgotten(Instant now) {
        List<WorkSession> old = mongo.find(new Query(Criteria.where("openKey").ne(null).and("startedAt").lt(now.minus(MAX_SESSION))), WorkSession.class);
        old.forEach(s -> close(s, now, "AUTO"));
        return old.size();
    }

    private static String clean(String note) {
        if (note == null) return null;
        String n = note.strip();
        return n.isEmpty() ? null : n.length() > 300 ? n.substring(0, 300) : n;
    }

    private static long minutesOf(WorkSession s, Instant now) {
        return s.isRunning() ? Duration.between(s.getStartedAt(), now).toMinutes() : s.getMinutes();
    }

    /** My running session and how long I've worked today (in the workspace's time zone). */
    public Map<String, Object> me(String org, String rawEmail, ZoneId zone, Instant now) {
        String email = low(rawEmail);
        Instant dayStart = LocalDate.ofInstant(now, zone).atStartOfDay(zone).toInstant();
        long today = mongo.find(new Query(Criteria.where("organizationId").is(org).and("email").is(email).and("startedAt").gte(dayStart)), WorkSession.class)
                .stream().mapToLong(s -> minutesOf(s, now)).sum();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("running", running(org, email));
        out.put("todayMinutes", today);
        return out;
    }

    /**
     * Time on one project between two instants: per person (minutes, sessions, last worked) and the sessions themselves.
     * People who manage the project see everyone; others only themselves.
     */
    public Map<String, Object> forProject(String org, String rawEmail, String projectId, Instant from, Instant to, Instant now) {
        Project p = visibleProject(org, projectId);
        boolean all = seesEveryone(p, low(rawEmail));
        Criteria c = Criteria.where("organizationId").is(org).and("projectId").is(p.getId()).and("startedAt").gte(from).lt(to);
        if (!all) c = c.and("email").is(low(rawEmail));
        List<WorkSession> list = mongo.find(new Query(c).with(Sort.by(Sort.Direction.DESC, "startedAt")).limit(2000), WorkSession.class);
        Map<String, Map<String, Object>> people = new LinkedHashMap<>();
        long total = 0;
        for (WorkSession s : list) {
            long m = minutesOf(s, now);
            total += m;
            Map<String, Object> row = people.computeIfAbsent(s.getEmail(), e -> {
                Map<String, Object> r = new LinkedHashMap<>();
                r.put("email", e); r.put("name", s.getName()); r.put("minutes", 0L); r.put("sessions", 0); r.put("lastWorked", s.getStartedAt());
                r.put("workingNow", false);
                return r;
            });
            row.put("minutes", (Long) row.get("minutes") + m);
            row.put("sessions", (Integer) row.get("sessions") + 1);
            if (s.isRunning()) row.put("workingNow", true);
        }
        List<Map<String, Object>> rows = new ArrayList<>(people.values());
        rows.sort((a, b) -> Long.compare((Long) b.get("minutes"), (Long) a.get("minutes")));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("projectId", p.getId()); out.put("projectName", p.getName());
        out.put("everyone", all); out.put("totalMinutes", total); out.put("people", rows);
        out.put("sessions", list.size() > 200 ? list.subList(0, 200) : list);
        return out;
    }

    /** Every session in a range, for the CSV export: managers of a project see all of its sessions; everyone sees their own. */
    public List<WorkSession> export(String org, String rawEmail, String projectId, Instant from, Instant to) {
        Criteria c = Criteria.where("organizationId").is(org).and("startedAt").gte(from).lt(to);
        if (projectId != null && !projectId.isBlank()) c = c.and("projectId").is(visibleProject(org, projectId).getId());
        List<WorkSession> list = mongo.find(new Query(c).with(Sort.by("startedAt")).limit(20000), WorkSession.class);
        String me = low(rawEmail);
        Map<String, Boolean> manages = new HashMap<>();
        return list.stream().filter(s -> me.equals(s.getEmail()) || manages.computeIfAbsent(s.getProjectId(),
                id -> projects.findById(id).map(p -> seesEveryone(p, me)).orElse(false))).toList();
    }

    /** A manager removes a mistaken session (e.g. someone forgot to stop overnight). */
    public void delete(String org, String rawEmail, String id) {
        WorkSession s = mongo.findById(id, WorkSession.class);
        if (s == null || !org.equals(s.getOrganizationId())) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Not found");
        Project p = projects.findById(s.getProjectId()).orElse(null);
        if (!seesEveryone(p, low(rawEmail))) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Only the project's managers can remove time.");
        mongo.remove(s);
    }
}

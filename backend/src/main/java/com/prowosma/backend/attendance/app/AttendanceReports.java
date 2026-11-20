package com.prowosma.backend.attendance.app;

import com.prowosma.backend.attendance.app.AttendanceService.Caller;
import com.prowosma.backend.attendance.app.AttendanceService.Person;
import com.prowosma.backend.attendance.model.AttendanceException;
import com.prowosma.backend.model.TeamMember;
import com.prowosma.backend.model.UserGroup;
import com.prowosma.backend.model.Workspace;
import com.prowosma.backend.repository.TeamMemberRepository;
import com.prowosma.backend.repository.UserGroupRepository;
import com.prowosma.backend.repository.WorkspaceRepository;
import org.springframework.stereotype.Service;

import java.util.*;

/**
 * The attendance details report with filters: workspace(s), department, person, manager, status, work mode, project,
 * late / overtime / missed clock-out, and a name search.
 *
 * Every workspace keeps its own rules: admin/HR see everyone there, a manager their direct reports, anyone else only
 * themselves (see {@link AttendanceService#visiblePeople}). Another workspace is only included when the person is a
 * member of it and attendance is turned on there; its access control is read for that workspace.
 *
 * A department is either the "Department" on a person's profile or a department group they belong to (Access control).
 */
@Service
public class AttendanceReports {

    public static final List<String> STATUSES = List.of("PRESENT", "LATE", "ABSENT", "NOT_YET_IN", "LEAVE", "HALF_DAY_LEAVE", "HOLIDAY", "WEEKEND");

    public record ReportFilter(String from, String to, List<String> workspaces, List<String> people, List<String> departments,
                               List<String> managers, List<String> statuses, List<String> workModes, List<String> projects,
                               boolean lateOnly, boolean overtimeOnly, boolean missedClockOutOnly, String search) {}

    private final AttendanceService service;
    private final AttendanceFeature feature;
    private final WorkspaceRepository workspaces;
    private final TeamMemberRepository members;
    private final UserGroupRepository groups;

    public AttendanceReports(AttendanceService service, AttendanceFeature feature, WorkspaceRepository workspaces,
                             TeamMemberRepository members, UserGroupRepository groups) {
        this.service = service; this.feature = feature; this.workspaces = workspaces; this.members = members; this.groups = groups;
    }

    /** The caller in each requested workspace (default: the current one). Unknown ids, non-members and workspaces without attendance are refused. */
    public List<Caller> callers(Caller current, List<String> requested) {
        List<String> ids = requested == null || requested.isEmpty() ? List.of(current.org()) : new ArrayList<>(new LinkedHashSet<>(requested));
        if (ids.size() > 20) throw AttendanceException.bad("TOO_MANY_WORKSPACES", "Choose 20 workspaces or fewer.");
        List<Caller> out = new ArrayList<>();
        for (String org : ids) {
            if (org.equals(current.org())) { out.add(current); continue; }
            if (!feature.isOn(org)) throw AttendanceException.forbidden("Attendance isn't turned on in one of the chosen workspaces.");
            out.add(service.callerIn(org, current.email()));      // throws 403 for a workspace they aren't in
        }
        return out;
    }

    public List<Map<String, Object>> report(Caller current, ReportFilter f) {
        List<Map<String, Object>> rows = new ArrayList<>();
        for (Caller c : callers(current, f.workspaces())) {
            Directory dir = directory(c.org());
            String wsName = workspaces.findById(c.org()).map(Workspace::getName).orElse(c.org());
            for (Map<String, Object> r : service.report(c, f.from(), f.to(), null)) {
                String email = String.valueOf(r.get("email"));
                r.put("workspaceId", c.org());
                r.put("workspace", wsName);
                r.put("departments", dir.departments(email));
                TeamMember mgr = dir.managerOf(email);
                r.put("managerEmail", mgr == null ? null : lower(mgr.getEmail()));
                r.put("managerName", mgr == null ? null : mgr.getName());
                if (matches(r, f)) rows.add(r);
            }
        }
        rows.sort(Comparator.comparing((Map<String, Object> r) -> (String) r.get("date")).reversed()
                .thenComparing(r -> String.valueOf(r.get("name")).toLowerCase(Locale.ROOT))
                .thenComparing(r -> String.valueOf(r.get("workspace"))));
        return rows;
    }

    static boolean matches(Map<String, Object> r, ReportFilter f) {
        if (!in(f.people(), lower((String) r.get("email")))) return false;
        if (!in(f.statuses(), (String) r.get("status"))) return false;
        if (!in(f.workModes(), (String) r.get("workMode"))) return false;
        if (!in(f.projects(), (String) r.get("project"))) return false;
        if (!in(f.managers(), (String) r.get("managerEmail"))) return false;
        if (f.departments() != null && !f.departments().isEmpty()) {
            @SuppressWarnings("unchecked") List<String> deps = (List<String>) r.getOrDefault("departments", List.of());
            Set<String> want = new HashSet<>();
            f.departments().forEach(d -> want.add(d.toLowerCase(Locale.ROOT)));
            if (deps.stream().noneMatch(d -> want.contains(d.toLowerCase(Locale.ROOT)))) return false;
        }
        if (f.lateOnly() && !(num(r.get("lateMinutes")) > 0 || "LATE".equals(r.get("status")))) return false;
        if (f.overtimeOnly() && !(num(r.get("overtimeMinutes")) > 0)) return false;
        if (f.missedClockOutOnly() && !Boolean.TRUE.equals(r.get("autoClosed"))) return false;
        if (f.search() != null && !f.search().isBlank()) {
            String q = f.search().trim().toLowerCase(Locale.ROOT);
            String hay = (r.get("name") + " " + r.get("email")).toLowerCase(Locale.ROOT);
            if (!hay.contains(q)) return false;
        }
        return true;
    }

    /** What the filters can offer this person: their workspaces with attendance on, and people / departments / managers they may see. */
    public Map<String, Object> options(Caller current, List<String> requested) {
        List<Map<String, Object>> wsList = new ArrayList<>();
        Set<String> ids = new LinkedHashSet<>();
        ids.add(current.org());
        members.findAllByEmail(current.email()).forEach(m -> { if (m.getOrganizationId() != null) ids.add(m.getOrganizationId()); });
        workspaces.findByOwnerEmailIgnoreCase(current.email()).forEach(w -> ids.add(w.getId()));
        for (String org : ids) {
            if (!feature.isOn(org)) continue;
            Caller c;
            try { c = org.equals(current.org()) ? current : service.callerIn(org, current.email()); } catch (RuntimeException notMember) { continue; }
            Workspace w = workspaces.findById(org).orElse(null);
            if (w == null) continue;
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", org); m.put("name", w.getName()); m.put("current", org.equals(current.org())); m.put("seesEveryone", c.admin());
            wsList.add(m);
        }
        Map<String, Map<String, Object>> people = new LinkedHashMap<>();
        Set<String> departments = new TreeSet<>(String.CASE_INSENSITIVE_ORDER);
        Map<String, String> managers = new TreeMap<>();
        for (Caller c : callers(current, requested)) {
            Directory dir = directory(c.org());
            for (Person p : service.visiblePeople(c)) {
                Map<String, Object> row = people.computeIfAbsent(p.email(), k -> {
                    Map<String, Object> n = new LinkedHashMap<>();
                    n.put("email", p.email()); n.put("name", p.name());
                    return n;
                });
                List<String> deps = dir.departments(p.email());
                departments.addAll(deps);
                row.put("departments", deps);
                TeamMember mgr = dir.managerOf(p.email());
                if (mgr != null && mgr.getEmail() != null) managers.put(lower(mgr.getEmail()), mgr.getName() == null ? mgr.getEmail() : mgr.getName());
            }
        }
        List<Map<String, Object>> peopleList = new ArrayList<>(people.values());
        peopleList.sort(Comparator.comparing(m -> String.valueOf(m.get("name")).toLowerCase(Locale.ROOT)));
        List<Map<String, Object>> mgrList = new ArrayList<>();
        managers.forEach((e, n) -> mgrList.add(Map.of("email", e, "name", n)));
        mgrList.sort(Comparator.comparing(m -> String.valueOf(m.get("name")).toLowerCase(Locale.ROOT)));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("workspaces", wsList);
        out.put("people", peopleList);
        out.put("departments", new ArrayList<>(departments));
        out.put("managers", mgrList);
        out.put("statuses", STATUSES);
        out.put("workModes", AttendanceRules.WORK_MODES);
        return out;
    }

    /** Departments and managers of one workspace, looked up once per report. */
    private Directory directory(String org) {
        List<TeamMember> all = members.findByOrganizationId(org);
        Map<String, TeamMember> byId = new HashMap<>(), byEmail = new HashMap<>();
        for (TeamMember m : all) {
            if (m.getId() != null) byId.put(m.getId(), m);
            if (m.getEmail() != null) byEmail.putIfAbsent(lower(m.getEmail()), m);
        }
        Map<String, List<String>> groupNames = new HashMap<>();
        for (UserGroup g : groups.findByOrganizationIdAndType(org, "DEPARTMENT")) {
            if (g.getName() == null || g.getName().isBlank() || g.getMemberEmails() == null) continue;
            for (String e : g.getMemberEmails()) if (e != null) groupNames.computeIfAbsent(lower(e), k -> new ArrayList<>()).add(g.getName().trim());
        }
        return new Directory(byId, byEmail, groupNames);
    }

    private record Directory(Map<String, TeamMember> byId, Map<String, TeamMember> byEmail, Map<String, List<String>> groupNames) {
        List<String> departments(String email) {
            Set<String> out = new LinkedHashSet<>();
            TeamMember m = byEmail.get(lower(email));
            if (m != null && m.getDepartment() != null && !m.getDepartment().isBlank()) out.add(m.getDepartment().trim());
            out.addAll(groupNames.getOrDefault(lower(email), List.of()));
            return new ArrayList<>(out);
        }
        TeamMember managerOf(String email) {
            TeamMember m = byEmail.get(lower(email));
            return m == null || m.getManagerId() == null ? null : byId.get(m.getManagerId());
        }
    }

    private static boolean in(List<String> wanted, String value) {
        if (wanted == null || wanted.isEmpty()) return true;
        if (value == null) return false;
        for (String w : wanted) if (w.equalsIgnoreCase(value)) return true;
        return false;
    }
    private static long num(Object o) { return o instanceof Number n ? n.longValue() : 0; }
    private static String lower(String s) { return s == null ? null : s.toLowerCase(Locale.ROOT); }
}

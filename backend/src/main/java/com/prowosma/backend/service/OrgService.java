package com.prowosma.backend.service;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.TeamMember;
import com.prowosma.backend.model.UserGroup;
import com.prowosma.backend.repository.TeamMemberRepository;
import com.prowosma.backend.repository.UserGroupRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.DateTimeException;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.*;
import java.util.regex.Pattern;

import static com.prowosma.backend.access.AccessConstants.GROUP_DEPARTMENT;

/**
 * Reporting lines and contact details behind the org chart and the people card.
 * Workspace admins set manager, job title and department; everyone may edit their own
 * phone, location, time zone and "about" text.
 */
@Service
@RequiredArgsConstructor
public class OrgService {

    private static final Pattern PHONE = Pattern.compile("^[0-9+()\\-. ]{3,40}$");

    private final TeamMemberRepository memberRepository;
    private final UserGroupRepository groupRepository;
    private final WorkspaceContext workspaceContext;
    private final ActivityLogService activityLogService;

    /** Everyone in the workspace with the fields the org chart and people card show. */
    public List<Map<String, Object>> orgChart() {
        String org = requireWorkspace();
        List<TeamMember> members = memberRepository.findByOrganizationId(org);
        Map<String, List<String>> deptsByEmail = new HashMap<>();
        for (UserGroup g : groupRepository.findByOrganizationIdAndType(org, GROUP_DEPARTMENT)) {
            if (g.getMemberEmails() == null) continue;
            for (String e : g.getMemberEmails())
                if (e != null) deptsByEmail.computeIfAbsent(e.toLowerCase(), k -> new ArrayList<>()).add(g.getName());
        }
        Set<String> ids = new HashSet<>();
        members.forEach(m -> ids.add(m.getId()));
        List<Map<String, Object>> out = new ArrayList<>();
        for (TeamMember m : members) {
            Map<String, Object> o = new LinkedHashMap<>();
            o.put("id", m.getId());
            o.put("name", m.getName());
            o.put("email", m.getEmail());
            o.put("role", m.getRole());
            o.put("title", m.getTitle());
            o.put("department", m.getDepartment());
            o.put("departments", m.getEmail() == null ? List.of() : deptsByEmail.getOrDefault(m.getEmail().toLowerCase(), List.of()));
            // A manager who has left the workspace no longer counts; the person shows at the top.
            o.put("managerId", m.getManagerId() != null && ids.contains(m.getManagerId()) ? m.getManagerId() : null);
            o.put("phone", m.getPhone());
            o.put("location", m.getLocation());
            o.put("timeZone", m.getTimeZone());
            o.put("bio", m.getBio());
            o.put("skills", m.getSkills());
            o.put("avatar", m.getAvatar());
            o.put("color", m.getColor());
            o.put("availability", m.getAvailability());
            out.add(o);
        }
        return out;
    }

    /** Admin edit. Body (all optional): managerId (null/"" = none), title, department, phone, location, timeZone. */
    public Map<String, Object> updateOrg(String memberId, Map<String, Object> body, String requester) {
        String org = requireWorkspace();
        TeamMember m = memberRepository.findById(memberId)
                .filter(x -> org.equals(x.getOrganizationId()))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Member not found"));
        String oldManager = m.getManagerId();
        if (body.containsKey("managerId")) {
            String managerId = text(body.get("managerId"), 64);
            if (managerId != null) {
                Map<String, String> managerOf = new HashMap<>();
                boolean exists = false;
                for (TeamMember x : memberRepository.findByOrganizationId(org)) {
                    managerOf.put(x.getId(), x.getManagerId());
                    if (x.getId().equals(managerId)) exists = true;
                }
                if (!exists) throw bad("That manager isn't in this workspace.");
                if (wouldCreateCycle(managerOf, memberId, managerId))
                    throw bad("That would make a loop in the reporting line — someone can't report to their own report.");
            }
            m.setManagerId(managerId);
        }
        if (body.containsKey("title")) m.setTitle(text(body.get("title"), 120));
        if (body.containsKey("department")) m.setDepartment(text(body.get("department"), 120));
        applyContact(m, body);
        m.setProfileUpdatedAt(LocalDateTime.now());
        memberRepository.save(m);
        if (!Objects.equals(oldManager, m.getManagerId())) {
            activityLogService.logFull("TEAM", m.getId(), m.getEmail(), "MANAGER_CHANGED",
                    oldManager, m.getManagerId(), null, null, null, null);
        }
        return find(memberId);
    }

    /** Self-service. Body (all optional): phone, location, timeZone, bio. */
    public Map<String, Object> updateMyContact(String email, Map<String, Object> body) {
        String org = requireWorkspace();
        TeamMember m = memberRepository.findByEmailAndOrganizationId(email, org)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "You aren't a member of this workspace."));
        applyContact(m, body);
        if (body.containsKey("bio")) m.setBio(text(body.get("bio"), 1000));
        m.setProfileUpdatedAt(LocalDateTime.now());
        memberRepository.save(m);
        return find(m.getId());
    }

    private void applyContact(TeamMember m, Map<String, Object> body) {
        if (body.containsKey("phone")) {
            String phone = text(body.get("phone"), 40);
            if (phone != null && !PHONE.matcher(phone).matches())
                throw bad("Phone numbers may use digits, spaces and + ( ) - . only.");
            m.setPhone(phone);
        }
        if (body.containsKey("location")) m.setLocation(text(body.get("location"), 120));
        if (body.containsKey("timeZone")) {
            String tz = text(body.get("timeZone"), 64);
            if (tz != null) {
                try { ZoneId.of(tz); } catch (DateTimeException e) { throw bad("Unknown time zone: " + tz); }
            }
            m.setTimeZone(tz);
        }
    }

    private Map<String, Object> find(String id) {
        return orgChart().stream().filter(x -> id.equals(x.get("id"))).findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Member not found"));
    }

    /**
     * True if making {@code newManagerId} the manager of {@code memberId} would loop: walking up from the
     * new manager reaches the member (or the member would manage themself).
     */
    static boolean wouldCreateCycle(Map<String, String> managerOf, String memberId, String newManagerId) {
        if (newManagerId == null) return false;
        Set<String> seen = new HashSet<>();
        String cur = newManagerId;
        while (cur != null && seen.add(cur)) {
            if (cur.equals(memberId)) return true;
            cur = managerOf.get(cur);
        }
        return false;
    }

    static String text(Object raw, int max) {
        if (raw == null) return null;
        String s = String.valueOf(raw).trim();
        if (s.isEmpty()) return null;
        return s.length() > max ? s.substring(0, max) : s;
    }

    private String requireWorkspace() {
        String org = workspaceContext.getWorkspaceId();
        if (org == null || org.isBlank()) throw bad("No workspace selected.");
        return org;
    }

    private static ResponseStatusException bad(String msg) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, msg);
    }
}

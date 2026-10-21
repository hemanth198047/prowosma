package com.prowosma.backend.service;

import com.prowosma.backend.access.AccessConstants;
import com.prowosma.backend.access.AccessValidation;
import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.*;
import com.prowosma.backend.repository.*;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

import static com.prowosma.backend.access.AccessConstants.*;

/**
 * Admin-side management of the department access model: settings, profiles, departments, who has
 * which profile, and a one-shot "organisation setup" that applies a whole structure from JSON.
 * Everything is workspace data — no company is hard-coded here.
 *
 * Only reachable under /api/admin/access/** (workspace owner / admin).
 */
@Service
@RequiredArgsConstructor
public class AccessAdminService {

    private final WorkspaceContext workspaceContext;
    private final WorkspaceConfigRepository configRepository;
    private final AccessProfileRepository profileRepository;
    private final UserGroupRepository groupRepository;
    private final TeamMemberRepository memberRepository;
    private final ProjectRepository projectRepository;
    private final WorkspaceRepository workspaceRepository;
    private final InvitationService invitationService;
    private final BillingService billingService;
    private final ActivityLogService activityLogService;
    private final RealtimeService realtimeService;
    private final DocRepository docRepository;

    private String org() {
        String id = workspaceContext.getWorkspaceId();
        if (id == null || id.isBlank()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "No workspace selected.");
        return id;
    }

    private static ResponseStatusException bad(String m) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, m); }
    private static ResponseStatusException conflict(String m) { return new ResponseStatusException(HttpStatus.CONFLICT, m); }
    private static ResponseStatusException notFound(String m) { return new ResponseStatusException(HttpStatus.NOT_FOUND, m); }

    // ── settings ────────────────────────────────────────────────────────────────

    private WorkspaceConfig config(String org) {
        return configRepository.findByWorkspaceId(org).orElseGet(() -> {
            WorkspaceConfig c = new WorkspaceConfig();
            c.setWorkspaceId(org);
            return c;
        });
    }

    public Map<String, Object> getSettings() {
        WorkspaceConfig c = config(org());
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("accessControlEnabled", c.isAccessControlEnabled());
        m.put("defaultAccessProfileId", c.getDefaultAccessProfileId());
        m.put("defaultProjectVisibility", c.getDefaultProjectVisibility());
        m.put("projectRoleSlots", c.getProjectRoleSlots());
        m.put("docAccessMode", normalizeDocMode(c.getDocAccessMode()));
        m.put("docAccessModes", ALL_DOC_MODES);
        m.put("scopes", ALL_MODES);
        m.put("visibilities", ALL_VISIBILITIES);
        m.put("capabilities", ALL_CAPABILITIES);
        return m;
    }

    public Map<String, Object> updateSettings(Map<String, Object> body) {
        String org = org();
        WorkspaceConfig c = config(org);
        List<String> warnings = new ArrayList<>();
        try {
            if (body.containsKey("projectRoleSlots")) {
                c.setProjectRoleSlots(toSlots(AccessValidation.roleSlots(listOfMaps(body.get("projectRoleSlots")))));
            }
            if (body.containsKey("defaultProjectVisibility")) {
                c.setDefaultProjectVisibility(AccessValidation.visibility(str(body.get("defaultProjectVisibility"))));
            }
            if (body.containsKey("docAccessMode")) c.setDocAccessMode(AccessValidation.docMode(str(body.get("docAccessMode"))));
        } catch (IllegalArgumentException e) { throw bad(e.getMessage()); }
        if (body.containsKey("defaultAccessProfileId")) {
            String pid = str(body.get("defaultAccessProfileId"));
            if (pid == null || pid.isBlank()) c.setDefaultAccessProfileId(null);
            else {
                profileRepository.findByIdAndOrganizationId(pid, org).orElseThrow(() -> bad("That access profile doesn't exist."));
                c.setDefaultAccessProfileId(pid);
            }
        }
        if (body.containsKey("accessControlEnabled")) c.setAccessControlEnabled(Boolean.TRUE.equals(body.get("accessControlEnabled")));
        if (c.isAccessControlEnabled()) {
            boolean anyProfileAssigned = memberRepository.findByOrganizationId(org).stream().anyMatch(m -> m.getAccessProfileId() != null && !m.getAccessProfileId().isBlank());
            if (c.getDefaultAccessProfileId() == null && !anyProfileAssigned)
                warnings.add("No one has an access profile yet and there is no default profile, so nobody is restricted. Assign profiles (or choose a default) to start separating departments.");
            warnings.add("In this release, restricted members can use Projects, Tasks and the Team list. Dashboards, reports, search, docs, meetings and other areas stay closed to them until they are scoped.");
        }
        c.setUpdatedAt(LocalDateTime.now());
        configRepository.save(c);
        realtimeService.accessControlChanged(org);
        Map<String, Object> out = getSettings();
        out.put("warnings", warnings);
        return out;
    }

    private static List<WorkspaceConfig.RoleSlot> toSlots(List<Map<String, String>> raw) {
        return raw.stream().map(m -> { var s = new WorkspaceConfig.RoleSlot(); s.setKey(m.get("key")); s.setLabel(m.get("label")); return s; }).collect(Collectors.toList());
    }

    // ── documents made before access control ────────────────────────────────────

    /**
     * Documents created before access control have no audience, so only their creator (and people they were shared
     * with) can see them once restrictions start. This gives all of them an audience in one step.
     * @return how many documents were updated
     */
    public Map<String, Object> assignLegacyDocs(String audience, List<String> departmentIds) {
        String org = org();
        String aud;
        try { aud = AccessValidation.audience(audience); } catch (IllegalArgumentException e) { throw bad(e.getMessage()); }
        Set<String> known = groupRepository.findByOrganizationIdAndType(org, GROUP_DEPARTMENT).stream().map(UserGroup::getId).collect(Collectors.toSet());
        List<String> depts = new ArrayList<>();
        if (AUD_DEPARTMENTS.equals(aud)) {
            for (String d : departmentIds == null ? List.<String>of() : departmentIds) if (known.contains(d) && !depts.contains(d)) depts.add(d);
            if (depts.isEmpty()) throw bad("Choose at least one department.");
        }
        int n = 0;
        for (Doc d : docRepository.findByWorkspaceIdAndDeletedFalse(org)) {
            if (d.getAudience() != null && !d.getAudience().isBlank()) continue;
            d.setAudience(aud);
            d.setDepartmentIds(new ArrayList<>(depts));
            d.setUpdatedAt(LocalDateTime.now());
            docRepository.save(d);
            n++;
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("updated", n);
        out.put("audience", aud);
        return out;
    }

    // ── profiles ────────────────────────────────────────────────────────────────

    public List<AccessProfile> listProfiles() { return profileRepository.findByOrganizationId(org()); }

    public AccessProfile createProfile(Map<String, Object> body, String by) {
        String org = org();
        AccessProfile p = new AccessProfile();
        p.setOrganizationId(org);
        p.setCreatedBy(by);
        fillProfile(p, body, org);
        return profileRepository.save(p);
    }

    public AccessProfile updateProfile(String id, Map<String, Object> body) {
        String org = org();
        AccessProfile p = profileRepository.findByIdAndOrganizationId(id, org).orElseThrow(() -> notFound("Access profile not found"));
        fillProfile(p, body, org);
        p.setUpdatedAt(LocalDateTime.now());
        return profileRepository.save(p);
    }

    private void fillProfile(AccessProfile p, Map<String, Object> body, String org) {
        try {
            String name = AccessValidation.name(str(body.get("name")), "Profile");
            profileRepository.findFirstByOrganizationIdAndNameIgnoreCase(org, name)
                    .filter(other -> !other.getId().equals(p.getId())).ifPresent(o -> { throw bad("A profile named '" + name + "' already exists."); });
            String scope = AccessValidation.scope(body.containsKey("scope") ? str(body.get("scope")) : p.getScope());
            p.setName(name);
            p.setDescription(str(body.get("description")));
            p.setScope(scope);
            p.setDepartmentAdmin(AccessValidation.departmentAdmin(Boolean.TRUE.equals(body.get("departmentAdmin")), scope));
            p.setCapabilities(AccessValidation.capabilities(body.get("capabilities") instanceof Collection<?> c ? c : List.of()));
        } catch (IllegalArgumentException e) { throw bad(e.getMessage()); }
    }

    public void deleteProfile(String id) {
        String org = org();
        AccessProfile p = profileRepository.findByIdAndOrganizationId(id, org).orElseThrow(() -> notFound("Access profile not found"));
        if (id.equals(config(org).getDefaultAccessProfileId())) throw conflict("This is the workspace's default profile. Choose another default first.");
        long users = memberRepository.findByOrganizationId(org).stream().filter(m -> id.equals(m.getAccessProfileId())).count();
        if (users > 0) throw conflict(users + " member(s) still use this profile. Move them to another profile first.");
        profileRepository.delete(p);
    }

    // ── departments ─────────────────────────────────────────────────────────────

    public List<UserGroup> listDepartments() { return groupRepository.findByOrganizationIdAndType(org(), GROUP_DEPARTMENT); }

    public UserGroup createDepartment(Map<String, Object> body, String by) {
        String org = org();
        String name;
        try { name = AccessValidation.name(str(body.get("name")), "Department"); } catch (IllegalArgumentException e) { throw bad(e.getMessage()); }
        if (departmentByName(org, name).isPresent()) throw bad("A department named '" + name + "' already exists.");
        UserGroup g = new UserGroup();
        g.setOrganizationId(org);
        g.setType(GROUP_DEPARTMENT);
        g.setName(name);
        g.setDescription(str(body.get("description")));
        if (str(body.get("color")) != null) g.setColor(str(body.get("color")));
        g.setCreatedBy(by);
        return groupRepository.save(g);
    }

    public UserGroup updateDepartment(String id, Map<String, Object> body) {
        UserGroup g = department(id);
        if (body.containsKey("name")) {
            String name;
            try { name = AccessValidation.name(str(body.get("name")), "Department"); } catch (IllegalArgumentException e) { throw bad(e.getMessage()); }
            departmentByName(g.getOrganizationId(), name).filter(o -> !o.getId().equals(id)).ifPresent(o -> { throw bad("A department named '" + name + "' already exists."); });
            g.setName(name);
        }
        if (body.containsKey("description")) g.setDescription(str(body.get("description")));
        if (body.containsKey("color") && str(body.get("color")) != null) g.setColor(str(body.get("color")));
        g.setUpdatedAt(LocalDateTime.now());
        return groupRepository.save(g);
    }

    /** Replaces the department's members. Only people already in the workspace can be added. */
    public UserGroup setDepartmentMembers(String id, List<String> emails) {
        UserGroup g = department(id);
        Map<String, String> known = workspaceEmails(g.getOrganizationId());
        List<String> out = new ArrayList<>();
        for (String e : emails == null ? List.<String>of() : emails) {
            if (e == null || e.isBlank()) continue;
            String canon = known.get(norm(e));
            if (canon == null) throw bad("Not a member of this workspace: " + e);
            if (!out.contains(canon)) out.add(canon);
        }
        g.setMemberEmails(out);
        g.setUpdatedAt(LocalDateTime.now());
        return groupRepository.save(g);
    }

    public void deleteDepartment(String id) {
        UserGroup g = department(id);
        long used = projectRepository.findByOrganizationId(g.getOrganizationId()).stream()
                .filter(p -> p.getDepartmentIds() != null && p.getDepartmentIds().contains(id)).count();
        if (used > 0) throw conflict(used + " project(s) belong to this department. Move them to another department first.");
        groupRepository.delete(g);
    }

    private UserGroup department(String id) {
        UserGroup g = groupRepository.findById(id).orElseThrow(() -> notFound("Department not found"));
        if (!org().equals(g.getOrganizationId()) || !GROUP_DEPARTMENT.equals(g.getType())) throw notFound("Department not found");
        return g;
    }

    private Optional<UserGroup> departmentByName(String org, String name) {
        return groupRepository.findByOrganizationIdAndType(org, GROUP_DEPARTMENT).stream().filter(g -> g.getName() != null && g.getName().equalsIgnoreCase(name)).findFirst();
    }

    // ── members ─────────────────────────────────────────────────────────────────

    public List<Map<String, Object>> listMembers() {
        String org = org();
        List<UserGroup> depts = groupRepository.findByOrganizationIdAndType(org, GROUP_DEPARTMENT);
        return memberRepository.findByOrganizationId(org).stream().map(m -> {
            Map<String, Object> o = new LinkedHashMap<>();
            o.put("id", m.getId());
            o.put("name", m.getName());
            o.put("email", m.getEmail());
            o.put("role", m.getRole());
            o.put("designation", m.getTitle());
            o.put("accessProfileId", m.getAccessProfileId());
            o.put("departmentIds", depts.stream().filter(d -> hasEmail(d, m.getEmail())).map(UserGroup::getId).collect(Collectors.toList()));
            return o;
        }).collect(Collectors.toList());
    }

    /** Body (all optional): accessProfileId (null clears), designation, departmentIds (replaces the person's departments). */
    public Map<String, Object> updateMember(String memberId, Map<String, Object> body) {
        String org = org();
        TeamMember m = memberRepository.findById(memberId).orElseThrow(() -> notFound("Member not found"));
        if (!org.equals(m.getOrganizationId())) throw notFound("Member not found");
        if (body.containsKey("accessProfileId")) {
            String pid = str(body.get("accessProfileId"));
            if (pid == null || pid.isBlank()) m.setAccessProfileId(null);
            else {
                profileRepository.findByIdAndOrganizationId(pid, org).orElseThrow(() -> bad("That access profile doesn't exist."));
                m.setAccessProfileId(pid);
            }
        }
        if (body.containsKey("designation")) m.setTitle(str(body.get("designation")));
        memberRepository.save(m);
        if (body.get("departmentIds") instanceof Collection<?> ids) {
            Set<String> wanted = ids.stream().map(x -> String.valueOf(x)).collect(Collectors.toSet());
            for (UserGroup d : groupRepository.findByOrganizationIdAndType(org, GROUP_DEPARTMENT)) {
                boolean in = hasEmail(d, m.getEmail());
                if (wanted.contains(d.getId()) && !in) { addEmail(d, m.getEmail()); groupRepository.save(d); }
                else if (!wanted.contains(d.getId()) && in) { d.getMemberEmails().removeIf(e -> e != null && e.equalsIgnoreCase(m.getEmail())); d.setUpdatedAt(LocalDateTime.now()); groupRepository.save(d); }
            }
        }
        return listMembers().stream().filter(x -> memberId.equals(x.get("id"))).findFirst().orElseThrow();
    }

    // ── organisation setup (apply a whole structure from JSON) ──────────────────

    /**
     * Applies a structure like:
     * <pre>{ "profiles":[{name,scope,departmentAdmin,capabilities,description}], "departments":[{name,color}],
     *   "roleSlots":[{key,label}], "defaultProfile":"name", "defaultProjectVisibility":"DEPARTMENTS",
     *   "members":[{email,name,role,designation,profile,departments:[names]}], "enableAccessControl":false }</pre>
     * Safe to run repeatedly: things are matched by name / email and updated, not duplicated. With
     * {@code dryRun} nothing is written. People not yet in the workspace are only invited when
     * {@code sendInvitations} is true; otherwise they are listed so an admin can confirm their emails first.
     */
    public Map<String, Object> orgSetup(Map<String, Object> plan, boolean dryRun, boolean sendInvitations, String requester) {
        String org = org();
        List<String> actions = new ArrayList<>();
        List<String> warnings = new ArrayList<>();
        boolean write = !dryRun;

        // 1. profiles
        Map<String, String> profileIds = new HashMap<>();
        for (AccessProfile existing : profileRepository.findByOrganizationId(org)) profileIds.put(norm(existing.getName()), existing.getId());
        for (Map<String, Object> spec : listOfMaps(plan.get("profiles"))) {
            String name = str(spec.get("name"));
            if (name == null) throw bad("Every profile needs a name.");
            String id = profileIds.get(norm(name));
            if (id == null) {
                actions.add("Create access profile '" + name + "'");
                if (write) { profileIds.put(norm(name), createProfile(spec, requester).getId()); }
                else profileIds.put(norm(name), "(new)");
            } else {
                actions.add("Update access profile '" + name + "'");
                if (write) updateProfile(id, spec); else validateProfileSpec(spec);
            }
        }

        // 2. departments
        Map<String, String> deptIds = new HashMap<>();
        for (UserGroup d : groupRepository.findByOrganizationIdAndType(org, GROUP_DEPARTMENT)) deptIds.put(norm(d.getName()), d.getId());
        for (Map<String, Object> spec : listOfMaps(plan.get("departments"))) {
            String name = str(spec.get("name"));
            if (name == null) throw bad("Every department needs a name.");
            if (!deptIds.containsKey(norm(name))) {
                actions.add("Create department '" + name + "'");
                if (write) deptIds.put(norm(name), createDepartment(spec, requester).getId()); else deptIds.put(norm(name), "(new)");
            }
        }

        // 3. project roles + defaults
        WorkspaceConfig cfg = config(org);
        if (plan.containsKey("roleSlots")) {
            try { cfg.setProjectRoleSlots(toSlots(AccessValidation.roleSlots(listOfMaps(plan.get("roleSlots"))))); }
            catch (IllegalArgumentException e) { throw bad(e.getMessage()); }
            actions.add("Set project roles: " + cfg.getProjectRoleSlots().stream().map(WorkspaceConfig.RoleSlot::getLabel).collect(Collectors.joining(", ")));
        }
        if (str(plan.get("defaultProjectVisibility")) != null) {
            try { cfg.setDefaultProjectVisibility(AccessValidation.visibility(str(plan.get("defaultProjectVisibility")))); }
            catch (IllegalArgumentException e) { throw bad(e.getMessage()); }
            actions.add("New projects default to " + cfg.getDefaultProjectVisibility());
        }
        if (str(plan.get("docAccessMode")) != null) {
            try { cfg.setDocAccessMode(AccessValidation.docMode(str(plan.get("docAccessMode")))); }
            catch (IllegalArgumentException e) { throw bad(e.getMessage()); }
            actions.add("Documents are shared: " + cfg.getDocAccessMode());
        }
        if (str(plan.get("defaultProfile")) != null) {
            String id = profileIds.get(norm(str(plan.get("defaultProfile"))));
            if (id == null) throw bad("defaultProfile '" + plan.get("defaultProfile") + "' is not one of the profiles.");
            if (!"(new)".equals(id)) cfg.setDefaultAccessProfileId(id);
            actions.add("Members with no profile get '" + plan.get("defaultProfile") + "'");
        }

        // 4. members
        Map<String, TeamMember> existing = new HashMap<>();
        memberRepository.findByOrganizationId(org).forEach(m -> existing.put(norm(m.getEmail()), m));
        Map<String, String> wsEmails = workspaceEmails(org);
        Map<String, List<String>> deptMembersToAdd = new LinkedHashMap<>();
        for (Map<String, Object> spec : listOfMaps(plan.get("members"))) {
            String email = str(spec.get("email"));
            String label = email != null ? email : String.valueOf(spec.get("name"));
            if (email == null || !email.contains("@")) { warnings.add("Skipped a person without a valid email: " + label); continue; }
            String profileName = str(spec.get("profile"));
            String profileId = profileName == null ? null : profileIds.get(norm(profileName));
            if (profileName != null && profileId == null) throw bad("Profile '" + profileName + "' (for " + email + ") is not defined.");
            List<String> deptsOfPerson = new ArrayList<>();
            for (Object dn : spec.get("departments") instanceof Collection<?> c ? c : List.of()) {
                String id = deptIds.get(norm(String.valueOf(dn)));
                if (id == null) throw bad("Department '" + dn + "' (for " + email + ") is not defined.");
                deptsOfPerson.add(id);
            }
            String designation = str(spec.get("designation"));
            String role = str(spec.get("role")) == null ? "MEMBER" : str(spec.get("role")).toUpperCase(Locale.ROOT);
            if (!role.equals("MEMBER") && !role.equals("VIEWER")) throw bad("Organisation setup only creates MEMBER or VIEWER roles (" + email + "). Make admins by hand.");

            TeamMember m = existing.get(norm(email));
            boolean isOwner = wsEmails.containsKey(norm(email)) && m == null;   // workspace owner without a TeamMember row
            if (isOwner) { actions.add(email + " is the workspace owner: unrestricted, nothing to set"); continue; }
            if (m != null && !"OWNER".equals(m.getRole())) {
                actions.add("Update " + email + (profileName != null ? " → profile '" + profileName + "'" : "") + (designation != null ? ", " + designation : ""));
                if (write) {
                    if (profileId != null) m.setAccessProfileId(profileId);
                    if (designation != null) m.setTitle(designation);
                    memberRepository.save(m);
                }
            } else if (m == null) {
                if (sendInvitations) {
                    actions.add("Invite " + email + (profileName != null ? " with profile '" + profileName + "'" : ""));
                    if (write) {
                        billingService.assertSeatAvailable(org);
                        invitationService.invite(org, email, role, requester, profileId, designation, deptsOfPerson);
                    }
                } else {
                    warnings.add(email + " isn't in the workspace yet and was not invited. Confirm their work email, then run this again with 'send invitations'.");
                }
            }
            for (String did : deptsOfPerson) deptMembersToAdd.computeIfAbsent(did, k -> new ArrayList<>()).add(email);
        }
        for (var e : deptMembersToAdd.entrySet()) {
            if ("(new)".equals(e.getKey())) { actions.add("Add " + e.getValue().size() + " people to a new department"); continue; }
            UserGroup g = groupRepository.findById(e.getKey()).orElse(null);
            if (g == null) continue;
            int added = 0;
            for (String email : e.getValue()) if (!hasEmail(g, email)) { added++; if (write) addEmail(g, email); }
            if (added > 0) actions.add("Add " + added + " people to department '" + g.getName() + "'");
            if (write && added > 0) groupRepository.save(g);
        }

        // 5. switch on (last, so a half-finished setup never restricts anyone)
        if (plan.containsKey("enableAccessControl")) {
            cfg.setAccessControlEnabled(Boolean.TRUE.equals(plan.get("enableAccessControl")));
            actions.add(cfg.isAccessControlEnabled() ? "Switch access control ON" : "Switch access control OFF");
        }
        if (write) {
            cfg.setUpdatedAt(LocalDateTime.now());
            configRepository.save(cfg);
            realtimeService.accessControlChanged(org);
            activityLogService.logFull("WORKSPACE", org, "Organisation setup", "ACCESS_SETUP_APPLIED", null, String.valueOf(actions.size()),
                    requester, org, null, null);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("dryRun", dryRun);
        out.put("actions", actions);
        out.put("warnings", warnings);
        return out;
    }

    private void validateProfileSpec(Map<String, Object> spec) {
        try {
            AccessValidation.name(str(spec.get("name")), "Profile");
            if (spec.containsKey("scope")) AccessValidation.scope(str(spec.get("scope")));
            AccessValidation.capabilities(spec.get("capabilities") instanceof Collection<?> c ? c : List.of());
        } catch (IllegalArgumentException e) { throw bad(e.getMessage()); }
    }

    // ── helpers ─────────────────────────────────────────────────────────────────

    private Map<String, String> workspaceEmails(String org) {
        Map<String, String> m = new HashMap<>();
        memberRepository.findByOrganizationId(org).forEach(t -> { if (t.getEmail() != null) m.put(norm(t.getEmail()), t.getEmail()); });
        workspaceRepository.findById(org).ifPresent(w -> { if (w.getOwnerEmail() != null) m.put(norm(w.getOwnerEmail()), w.getOwnerEmail()); });
        return m;
    }

    private static boolean hasEmail(UserGroup g, String email) {
        return g.getMemberEmails() != null && email != null && g.getMemberEmails().stream().anyMatch(e -> e != null && e.equalsIgnoreCase(email));
    }

    private static void addEmail(UserGroup g, String email) {
        if (g.getMemberEmails() == null) g.setMemberEmails(new ArrayList<>());
        g.getMemberEmails().add(email);
        g.setUpdatedAt(LocalDateTime.now());
    }

    private static String str(Object o) { return o == null ? null : (String.valueOf(o).isBlank() ? null : String.valueOf(o).trim()); }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> listOfMaps(Object o) {
        if (!(o instanceof Collection<?> c)) return new ArrayList<>();
        List<Map<String, Object>> out = new ArrayList<>();
        for (Object x : c) { if (x instanceof Map<?, ?> m) out.add((Map<String, Object>) m); else throw bad("Expected a list of objects."); }
        return out;
    }
}
